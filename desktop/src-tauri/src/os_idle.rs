// Windows OS-level idle time via GetLastInputInfo. Used as a fallback so idle
// detection keeps working even if the rdev input hook dies (see capture.rs).
#![cfg(windows)]

use windows::Win32::System::SystemInformation::GetTickCount;
use windows::Win32::UI::Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO};

/// Seconds since the last keyboard/mouse input, per the OS. `None` on failure.
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
