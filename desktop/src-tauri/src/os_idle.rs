// OS-level idle time. Used as a fallback so idle detection keeps working even
// if the rdev input hook dies (see capture.rs) — and, on Wayland, as the ONLY
// source that can see input at all, because rdev is X11-only.
//
// `None` means "no opinion" — the platform could not answer. Callers must not
// read it as "not idle": capture.rs treats a missing opinion as "we do not
// know", never as "the user is here" and never as "the user is away".

/// The number in a `gdbus call` reply.
///
/// gdbus prints a tuple literal whose *type name* carries digits of its own:
/// `(uint32 42,)`, `(uint64 42000,)`. Scanning for the first digit therefore
/// finds the `32` in `uint32` rather than the value — which is exactly what
/// this parser used to do, so every Linux idle reading was a constant 32
/// (screensaver) or 0 (Mutter, after the ms/1000 divide), and no Linux box has
/// ever reported its real idle time.
///
/// Take the first digit run that is not glued to the end of an identifier.
/// Lives outside the platform module, and is tested on every platform, because
/// a parser that only compiles on Linux is a parser CI never runs.
#[cfg(any(target_os = "linux", test))]
fn parse_gdbus_number(text: &str) -> Option<u64> {
    let bytes = text.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if !bytes[i].is_ascii_digit() {
            i += 1;
            continue;
        }
        let start = i;
        while i < bytes.len() && bytes[i].is_ascii_digit() {
            i += 1;
        }
        // `uint32` / `uint64` / `int16` — a digit run welded to the end of a
        // word is part of the type name, not the value.
        let glued_to_word = start > 0 && bytes[start - 1].is_ascii_alphabetic();
        if !glued_to_word {
            return text[start..i].parse().ok();
        }
    }
    None
}

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

    /// GetLastInputInfo is already millisecond-resolution; the seconds view
    /// above is the lossy one.
    pub fn idle_millis() -> Option<i64> {
        unsafe {
            let mut lii = LASTINPUTINFO {
                cbSize: std::mem::size_of::<LASTINPUTINFO>() as u32,
                dwTime: 0,
            };
            if GetLastInputInfo(&mut lii).as_bool() {
                let now = GetTickCount();
                Some(now.wrapping_sub(lii.dwTime) as i64)
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
    //! 1. `org.gnome.Mutter.IdleMonitor` — GNOME, including Wayland, where the
    //!    compositor is the only thing that can see input at all. Returns
    //!    **milliseconds**. Asked first because GNOME/Wayland is precisely the
    //!    case the X11 input hook cannot cover, so its answer is the one that
    //!    decides whether activity gets measured at all.
    //! 2. `org.freedesktop.ScreenSaver` — the cross-desktop interface, answered
    //!    by KDE and by X11 sessions generally. Returns **seconds**: too coarse
    //!    to drive per-second activity sampling, but fine for the idle
    //!    threshold, which is measured in minutes.
    //!
    //! Queried through `gdbus`, which ships with glib — a hard dependency of GTK
    //! and therefore present wherever either service is. Shelling out avoids
    //! pulling a D-Bus crate in for two method calls.

    use std::process::Command;
    use std::sync::Mutex;
    use std::time::{Duration, Instant};

    // Every reading costs a `gdbus` process spawn, and this is polled for as
    // long as someone is tracking — all day, on a laptop. So the reading is
    // cached, and callers say how fresh they need it rather than one TTL
    // serving two very different needs: the idle threshold is measured in
    // minutes and is happy with a stale figure, while the Wayland activity
    // sampler needs per-second resolution or it quantises a member's activity
    // into five-second steps. Only the machines that actually need per-second
    // sampling pay for it.
    static CACHE: Mutex<Option<(Instant, Option<i64>)>> = Mutex::new(None);

    /// Stale enough for the idle threshold, which is measured in minutes.
    const COARSE_MAX_AGE: Duration = Duration::from_millis(5_000);

    pub fn idle_seconds() -> Option<i64> {
        idle_millis_within(COARSE_MAX_AGE).map(|ms| ms / 1000)
    }

    /// Idle time in milliseconds, no older than `max_age`. The activity sampler
    /// needs sub-second resolution to tell "input during this tick" from "input
    /// a while ago"; the seconds view cannot express that.
    pub fn idle_millis() -> Option<i64> {
        idle_millis_within(Duration::from_millis(1_000))
    }

    fn idle_millis_within(max_age: Duration) -> Option<i64> {
        if let Ok(guard) = CACHE.lock() {
            if let Some((at, cached)) = *guard {
                let age = at.elapsed();
                if age < max_age {
                    // Age the cached reading rather than repeating it verbatim.
                    // A stale figure served twice reads as "input just now" one
                    // tick too long, which credits activity to a second the
                    // member was not there for.
                    return cached.map(|ms| ms + age.as_millis() as i64);
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
        mutter_millis().or_else(screensaver_millis)
    }

    fn mutter_millis() -> Option<i64> {
        call(
            "org.gnome.Mutter.IdleMonitor",
            "/org/gnome/Mutter/IdleMonitor/Core",
            "org.gnome.Mutter.IdleMonitor.GetIdletime",
        )
        .map(|ms| ms as i64)
    }

    fn screensaver_millis() -> Option<i64> {
        call(
            "org.freedesktop.ScreenSaver",
            "/org/freedesktop/ScreenSaver",
            "org.freedesktop.ScreenSaver.GetSessionIdleTime",
        )
        .map(|secs| (secs as i64).saturating_mul(1000))
    }

    /// One `gdbus` call, returning the single unsigned integer in the reply.
    /// `None` for anything unexpected: no gdbus, no such service, an error
    /// reply, or a shape we did not anticipate.
    fn call(dest: &str, path: &str, method: &str) -> Option<u64> {
        let out = Command::new("gdbus")
            .args([
                "call",
                "--session",
                "--dest",
                dest,
                "--object-path",
                path,
                "--method",
                method,
            ])
            .output()
            .ok()?;
        if !out.status.success() {
            return None;
        }
        super::parse_gdbus_number(&String::from_utf8_lossy(&out.stdout))
    }
}

#[cfg(not(any(windows, target_os = "linux")))]
mod imp {
    pub fn idle_seconds() -> Option<i64> {
        None
    }

    pub fn idle_millis() -> Option<i64> {
        None
    }
}

pub use imp::{idle_millis, idle_seconds};

#[cfg(test)]
mod tests {
    use super::parse_gdbus_number;

    /// The regression this parser was rewritten for: read the value, not the
    /// digits buried in the type name. `(uint32 42,)` used to parse as 32.
    #[test]
    fn reads_the_value_not_the_type_name() {
        assert_eq!(parse_gdbus_number("(uint32 42,)"), Some(42));
        assert_eq!(parse_gdbus_number("(uint64 42000,)"), Some(42000));
        assert_eq!(parse_gdbus_number("(uint32 0,)"), Some(0));
        assert_eq!(parse_gdbus_number("(uint64 1234567890,)"), Some(1234567890));
    }

    /// A reply carrying no value must not invent one: callers read `None` as
    /// "no opinion", which is very different from "zero idle, the user is here".
    #[test]
    fn no_value_yields_none() {
        assert_eq!(parse_gdbus_number("(uint32 ,)"), None);
        assert_eq!(parse_gdbus_number(""), None);
        assert_eq!(parse_gdbus_number("()"), None);
    }

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
