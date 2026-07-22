// Windows browser URL sampling via UI Automation. Reads the foreground
// browser's address-bar value and reduces it to a bare domain — never the full
// path/query (proportionate for an internal tool; disclosed on the consent
// screen). Only called when the foreground app is a known browser and the user
// is active. Any failure degrades silently to app-only attribution.
#![cfg(windows)]

use std::cell::RefCell;

use windows::core::Interface;
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED,
};
use windows::Win32::System::Variant::VARIANT;
use windows::Win32::UI::Accessibility::{
    CUIAutomation, IUIAutomation, IUIAutomationValuePattern, TreeScope_Descendants,
    UIA_ControlTypePropertyId, UIA_EditControlTypeId, UIA_ValuePatternId,
};
use windows::Win32::UI::WindowsAndMessaging::GetForegroundWindow;

thread_local! {
    // COM + the automation object are per-thread; the worker thread reuses them.
    static AUTOMATION: RefCell<Option<IUIAutomation>> = const { RefCell::new(None) };
}

fn automation() -> Option<IUIAutomation> {
    AUTOMATION.with(|cell| {
        if let Some(a) = cell.borrow().as_ref() {
            return Some(a.clone());
        }
        unsafe {
            // Ignore result: S_FALSE means COM is already initialized on this thread.
            let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
            let a: IUIAutomation = CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER).ok()?;
            *cell.borrow_mut() = Some(a.clone());
            Some(a)
        }
    })
}

/// The bare domain shown in the foreground browser's address bar, if readable.
pub fn foreground_domain() -> Option<String> {
    let automation = automation()?;
    unsafe {
        let hwnd = GetForegroundWindow();
        if hwnd.is_invalid() {
            return None;
        }
        let root = automation.ElementFromHandle(hwnd).ok()?;
        // Find the address bar: the first Edit control in the window tree.
        let cond = automation
            .CreatePropertyCondition(
                UIA_ControlTypePropertyId,
                &VARIANT::from(UIA_EditControlTypeId.0),
            )
            .ok()?;
        let edit = root.FindFirst(TreeScope_Descendants, &cond).ok()?;
        let pattern: IUIAutomationValuePattern =
            edit.GetCurrentPatternAs(UIA_ValuePatternId).ok()?;
        let value = pattern.CurrentValue().ok()?;
        domain_of(&value.to_string())
    }
}

/// Reduce an address-bar string to a bare lowercase host. Returns None for
/// search queries / anything that isn't clearly a hostname.
fn domain_of(raw: &str) -> Option<String> {
    let s = raw.trim();
    if s.is_empty() || s.contains(char::is_whitespace) {
        return None; // a search term, not a URL
    }
    // strip scheme
    let after_scheme = s.split("://").last().unwrap_or(s);
    // host is up to the first '/', '?' or '#'
    let host = after_scheme
        .split(['/', '?', '#'])
        .next()
        .unwrap_or(after_scheme);
    // drop userinfo and port
    let host = host.rsplit('@').next().unwrap_or(host);
    let host = host.split(':').next().unwrap_or(host);
    let host = host.trim().trim_end_matches('.').to_lowercase();
    if host.contains('.') && host.len() >= 3 && !host.contains(' ') {
        Some(host)
    } else {
        None
    }
}
