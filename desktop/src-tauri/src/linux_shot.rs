//! Screenshot capture on Wayland, where the X11 path cannot reach the screen.
//!
//! `xcap` enumerates monitors over XCB unconditionally and then, on a Wayland
//! session, captures through D-Bus. Two things go wrong with that here:
//!
//!  1. its portal path calls `org.freedesktop.portal.Screenshot` and then waits
//!     up to **sixty seconds** for a permission dialog nobody is sitting there
//!     to answer — on the worker thread that also drives the running timer,
//!     block boundaries and idle detection;
//!  2. the Screenshot portal grants permission per request, never persistently,
//!     so even an answered prompt buys exactly one screenshot. That is why
//!     capture on Zorin "worked right before" and then stopped: it worked the
//!     one time someone was there to click Allow.
//!
//! So this asks GNOME Shell directly, which answers immediately or not at all,
//! with a hard timeout either way. It captures the whole desktop as one image
//! rather than one per monitor — the compositor composes it that way, and a
//! single frame of everything is what a reviewer wants to look at anyway.
//!
//! Deliberately no new dependencies: `gdbus` is already how os_idle.rs talks to
//! the session bus, and `image` is already in the tree.

use std::path::PathBuf;
use std::process::Command;

/// Why capture could not happen, in words a member can act on. Carried into the
/// `trax:capture-health` event, because "no screenshots" with no reason is a
/// support ticket and "your desktop refused the request" is an answer.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ShotError {
    /// The session is Wayland but GNOME Shell's screenshot service did not
    /// answer — a non-GNOME compositor, or one that refuses non-shell callers.
    NoScreenshotService,
    /// The service answered but reported failure, or wrote nothing readable.
    ServiceRefused,
    /// The PNG the compositor wrote could not be decoded.
    Undecodable,
}

impl ShotError {
    /// One sentence, addressed to the member, not to a log reader.
    pub fn message(&self) -> &'static str {
        match self {
            // GNOME 41+ restricts org.gnome.Shell.Screenshot to callers it
            // trusts, so this is the ordinary answer on a current GNOME/Wayland
            // desktop, not an exotic failure. Silent capture there needs the
            // ScreenCast portal over PipeWire, which is not built yet — so this
            // names the one thing a member can actually do today, rather than
            // describing a limitation they cannot act on.
            ShotError::NoScreenshotService => {
                "Screenshots aren't available on this Wayland desktop. To turn them on, log out \
                 and choose an Xorg session from the gear icon on the login screen. \
                 Time and activity still record either way."
            }
            ShotError::ServiceRefused => {
                "The desktop refused the screenshot request. Time and activity still record."
            }
            ShotError::Undecodable => {
                "The desktop returned an image TraxStaff couldn't read. \
                 Time and activity still record."
            }
        }
    }
}

/// Whether this process is running under Wayland.
///
/// Checked the same way xcap checks it, so the two agree about which path is in
/// play: an X11 session must keep using the X11 capture, which works and is
/// cheaper.
pub fn is_wayland() -> bool {
    let session = std::env::var("XDG_SESSION_TYPE").unwrap_or_default();
    if session.eq_ignore_ascii_case("wayland") {
        return true;
    }
    std::env::var_os("WAYLAND_DISPLAY").is_some()
}

/// Where the compositor is asked to write the frame. A fixed name, overwritten
/// each time and deleted after reading: screenshots are the most sensitive
/// thing this app touches, and a temp directory slowly filling with unencrypted
/// frames of someone's desktop is not an acceptable byproduct of taking them.
fn scratch_path() -> PathBuf {
    std::env::temp_dir().join("traxstaff-frame.png")
}

/// Capture the whole desktop, as RGBA.
///
/// The timeout is the point: `gdbus --timeout` bounds the call, so a desktop
/// that decides to prompt (or simply never replies) costs a few seconds, not
/// the sixty that used to stall the tracker's entire worker loop.
pub fn capture_desktop() -> Result<image::RgbaImage, ShotError> {
    let path = scratch_path();
    // A stale frame from a previous attempt must never be mistaken for a fresh
    // one: if the call below fails without writing, we would otherwise re-upload
    // the last successful screenshot with a current timestamp.
    let _ = std::fs::remove_file(&path);

    let out = Command::new("gdbus")
        .args([
            "call",
            "--session",
            "--timeout",
            "10",
            "--dest",
            "org.gnome.Shell.Screenshot",
            "--object-path",
            "/org/gnome/Shell/Screenshot",
            "--method",
            "org.gnome.Shell.Screenshot.Screenshot",
            // include_cursor: false — the pointer is not evidence of anything,
            // and it lands on top of whatever it was over.
            "false",
            // flash: false — a screen flash every few minutes on someone's own
            // machine is startling, and this app announces capture in its own UI.
            "false",
        ])
        .arg(&path)
        .output()
        .map_err(|_| ShotError::NoScreenshotService)?;

    if !out.status.success() {
        return Err(ShotError::NoScreenshotService);
    }
    // Reply is `(true, '/tmp/traxstaff-frame.png')`; a leading `false` means the
    // shell took the call and declined to serve it.
    let reply = String::from_utf8_lossy(&out.stdout);
    if !reply.contains("true") {
        let _ = std::fs::remove_file(&path);
        return Err(ShotError::ServiceRefused);
    }

    let decoded = image::open(&path).map_err(|_| ShotError::Undecodable);
    // Read once, then remove regardless of how decoding went — a frame left on
    // disk after a decode failure is the same leak as one left after a success.
    let _ = std::fs::remove_file(&path);
    Ok(decoded?.to_rgba8())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The session-type sniff must not claim Wayland on a bare X11 or headless
    /// environment, or an X11 box would abandon a capture path that works.
    #[test]
    fn wayland_detection_needs_actual_evidence() {
        // Whatever the CI box is, the answer must be a clean bool rather than a
        // panic, and must agree with the two variables it reads.
        let expected = std::env::var("XDG_SESSION_TYPE")
            .map(|s| s.eq_ignore_ascii_case("wayland"))
            .unwrap_or(false)
            || std::env::var_os("WAYLAND_DISPLAY").is_some();
        assert_eq!(is_wayland(), expected);
    }

    /// Every failure has to carry a sentence a member can read. An empty or
    /// developer-facing string here would land in a notification.
    #[test]
    fn every_error_explains_itself_to_a_member() {
        for e in [
            ShotError::NoScreenshotService,
            ShotError::ServiceRefused,
            ShotError::Undecodable,
        ] {
            let m = e.message();
            assert!(m.len() > 20, "{e:?} has no usable message");
            assert!(
                m.contains("still record"),
                "{e:?} must reassure that time is not being lost"
            );
        }
    }

    /// The scratch frame must live in a temp dir and be a single reused name,
    /// not an accumulating pile of desktop captures.
    #[test]
    fn scratch_frame_is_one_reused_temp_file() {
        let p = scratch_path();
        assert!(p.starts_with(std::env::temp_dir()));
        assert_eq!(p.file_name().unwrap(), "traxstaff-frame.png");
    }
}
