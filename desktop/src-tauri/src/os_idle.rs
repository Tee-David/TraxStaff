// OS-level idle time. Used as a fallback so idle detection keeps working even
// if the rdev input hook dies (see capture.rs).
//
// `None` means "no opinion" — the platform could not answer. Callers must not
// read it as "not idle"; capture.rs takes the *smaller* of this and the rdev
// figure, so a None simply leaves rdev in charge.

#[cfg(windows)]
mod imp {
    use windows::Win32::System::SystemInformation::GetTickCount;
    use windows::Win32::UI::Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO};

    pub fn idle_seconds() -> Option<i64> {
        unsafe {
            let mut lii = LASTINPUTINFO {
                cbSize: std::mem::size_of::<LASTINPUTINFO>() as u32,
                dwTime: 0,
            };
            if GetLastInputInfo(&mut lii).as_bool() {
                let now = GetTickCount();
                let idle_ms = now.wrapping_sub(lii.dwTime);
                Some((idle_ms / 1000) as i64)
            } else {
                None
            }
        }
    }
}

#[cfg(target_os = "linux")]
mod imp {
    //! There is no single idle API on Linux. We ask, in order:
    //!
    //! 1. `org.freedesktop.ScreenSaver` — the cross-desktop interface, answered
    //!    by KDE and by X11 sessions generally. Returns **seconds**.
    //! 2. `org.gnome.Mutter.IdleMonitor` — GNOME, including Wayland, where the
    //!    compositor is the only thing that can see input at all. Returns
    //!    **milliseconds**.
    //!
    //! Queried through `gdbus`, which ships with glib — a hard dependency of GTK
    //! and therefore present wherever either service is. Shelling out avoids
    //! pulling a D-Bus crate in for two method calls.

    use std::process::Command;
    use std::sync::Mutex;
    use std::time::{Duration, Instant};

    // capture.rs calls this once a second while tracking. Spawning gdbus that
    // often would burn far more CPU than the answer is worth, and idle
    // thresholds are measured in minutes, so a few seconds of staleness is
    // invisible. Also caches "nobody answered", so a desktop with neither
    // service costs one pair of failed spawns every interval, not every tick.
    const CACHE_FOR: Duration = Duration::from_secs(5);
    static CACHE: Mutex<Option<(Instant, Option<i64>)>> = Mutex::new(None);

    pub fn idle_seconds() -> Option<i64> {
        if let Ok(guard) = CACHE.lock() {
            if let Some((at, cached)) = *guard {
                if at.elapsed() < CACHE_FOR {
                    return cached;
                }
            }
        }
        let fresh = query();
        if let Ok(mut guard) = CACHE.lock() {
            *guard = Some((Instant::now(), fresh));
        }
        fresh
    }

    fn query() -> Option<i64> {
        screensaver_secs().or_else(mutter_secs)
    }

    fn screensaver_secs() -> Option<i64> {
        call(
            "org.freedesktop.ScreenSaver",
            "/org/freedesktop/ScreenSaver",
            "org.freedesktop.ScreenSaver.GetSessionIdleTime",
        )
        .map(|n| n as i64)
    }

    fn mutter_secs() -> Option<i64> {
        call(
            "org.gnome.Mutter.IdleMonitor",
            "/org/gnome/Mutter/IdleMonitor/Core",
            "org.gnome.Mutter.IdleMonitor.GetIdletime",
        )
        .map(|ms| (ms / 1000) as i64)
    }

    /// One `gdbus` call, returning the single unsigned integer in the reply.
    /// `None` for anything unexpected: no gdbus, no such service, an error
    /// reply, or a shape we did not anticipate.
    fn call(dest: &str, path: &str, method: &str) -> Option<u64> {
        let out = Command::new("gdbus")
            .args(["call", "--session", "--dest", dest, "--object-path", path, "--method", method])
            .output()
            .ok()?;
        if !out.status.success() {
            return None;
        }
        // gdbus prints a tuple literal: "(uint32 42,)" / "(uint64 42000,)".
        let text = String::from_utf8_lossy(&out.stdout);
        let digits: String = text.chars().skip_while(|c| !c.is_ascii_digit()).take_while(|c| c.is_ascii_digit()).collect();
        digits.parse().ok()
    }
}

#[cfg(not(any(windows, target_os = "linux")))]
mod imp {
    pub fn idle_seconds() -> Option<i64> {
        None
    }
}

pub use imp::idle_seconds;

#[cfg(test)]
mod tests {
    /// Exercises the real query path. On a headless box there is no session bus,
    /// so this takes the "nobody answered" route — the one that must degrade to
    /// `None` rather than panic on a missing `gdbus`, a non-zero exit, or a
    /// reply that does not parse.
    #[test]
    fn missing_idle_service_yields_no_opinion_not_a_panic() {
        if let Some(secs) = super::idle_seconds() {
            assert!(secs >= 0, "idle cannot be negative, got {secs}");
        }
    }
}
