// Windows browser URL sampling. The extraction reads the foreground browser's
// address bar via UI Automation and reduces it to a bare domain — never the
// full path/query (proportionate for an internal tool; disclosed on the consent
// screen). Called only when the foreground app is a known browser and the user
// is active; any failure degrades silently to app-only attribution.
#![cfg(windows)]

use std::cell::RefCell;
use std::collections::VecDeque;
use std::time::{Duration, Instant};

use windows::core::Interface;
use windows::Win32::Foundation::HWND;
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CLSCTX_INPROC_SERVER, COINIT_MULTITHREADED,
};
use windows::Win32::UI::Accessibility::{
    CUIAutomation, IUIAutomation, IUIAutomationElement, IUIAutomationTreeWalker,
    IUIAutomationValuePattern, UIA_EditControlTypeId, UIA_ValuePatternId,
};
use windows::Win32::UI::WindowsAndMessaging::GetForegroundWindow;

// A UI Automation tree walk is a cross-process COM conversation, far too
// expensive to run at the sampler's 1 Hz. The domain is re-read at most this
// often and reused in between — but only while the foreground window is
// unchanged, so switching to another window is still attributed immediately.
const RESAMPLE_AFTER: Duration = Duration::from_secs(5);

// Bounds on the walk. A browser window is a deep tree and the address bar sits
// near the top of it; without a budget an unlucky layout could keep the sampler
// thread busy for a noticeable fraction of its one-second tick.
const MAX_NODES: u32 = 400;
const MAX_DEPTH: u32 = 12;

thread_local! {
    // COM objects are not Send. The sampler runs on one dedicated thread
    // (capture.rs spawns a single 1 Hz loop), so a thread-local is both correct
    // and sufficient — the automation object is created once per process
    // lifetime rather than once per sample.
    static AUTOMATION: RefCell<Option<IUIAutomation>> = const { RefCell::new(None) };
    static CACHE: RefCell<Option<(isize, Instant, Option<String>)>> = const { RefCell::new(None) };
}

/// The bare domain shown in the foreground browser's address bar, if readable.
pub fn foreground_domain() -> Option<String> {
    let hwnd = unsafe { GetForegroundWindow() };
    let key = hwnd.0 as isize;

    let cached = CACHE.with(|c| match &*c.borrow() {
        Some((k, at, v)) if *k == key && at.elapsed() < RESAMPLE_AFTER => Some(v.clone()),
        _ => None,
    });
    // A cached miss (Some(None)) is honoured too: re-walking the tree every
    // second for a window with no readable address bar is the worst case.
    if let Some(v) = cached {
        return v;
    }

    let fresh = read_domain(hwnd);
    CACHE.with(|c| *c.borrow_mut() = Some((key, Instant::now(), fresh.clone())));
    fresh
}

fn read_domain(hwnd: HWND) -> Option<String> {
    AUTOMATION.with(|slot| -> Option<String> {
        let mut slot = slot.borrow_mut();
        if slot.is_none() {
            unsafe {
                // Already-initialised (RPC_E_CHANGED_MODE) is fine — we need
                // *an* apartment, not this specific one.
                let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
                *slot = CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER).ok();
            }
        }
        let automation = slot.as_ref()?;
        // A null or destroyed HWND simply fails here — no separate guard needed.
        let root = unsafe { automation.ElementFromHandle(hwnd) }.ok()?;
        first_address_bar(automation, &root)
    })
}

/// Breadth-first search for the first Edit control whose ValuePattern reads as a
/// hostname. Breadth-first because the omnibox is shallow, while the page's own
/// content — which can contain any number of Edit controls — is deep.
///
/// A TreeWalker is used rather than `FindFirst` with a property condition
/// specifically to avoid constructing a `VARIANT`: the walker path is entirely
/// typed, and every step is a plain `Result`.
fn first_address_bar(automation: &IUIAutomation, root: &IUIAutomationElement) -> Option<String> {
    let walker: IUIAutomationTreeWalker = unsafe { automation.ControlViewWalker() }.ok()?;
    let mut queue: VecDeque<(IUIAutomationElement, u32)> = VecDeque::new();
    queue.push_back((root.clone(), 0));
    let mut budget = MAX_NODES;

    while let Some((element, depth)) = queue.pop_front() {
        if budget == 0 {
            break;
        }
        budget -= 1;

        if unsafe { element.CurrentControlType() }.ok() == Some(UIA_EditControlTypeId) {
            // Keep searching when the value isn't a hostname: browsers expose
            // more than one Edit (find-in-page, the page's own inputs), and the
            // omnibox shows a search term rather than a URL often enough to
            // matter.
            if let Some(domain) = value_of(&element).as_deref().and_then(domain_of) {
                return Some(domain);
            }
        }

        if depth >= MAX_DEPTH {
            continue;
        }
        let mut child = unsafe { walker.GetFirstChildElement(&element) }.ok();
        while let Some(c) = child {
            let next = unsafe { walker.GetNextSiblingElement(&c) }.ok();
            queue.push_back((c, depth + 1));
            child = next;
        }
    }
    None
}

fn value_of(element: &IUIAutomationElement) -> Option<String> {
    let pattern = unsafe { element.GetCurrentPattern(UIA_ValuePatternId) }.ok()?;
    let value: IUIAutomationValuePattern = pattern.cast().ok()?;
    Some(unsafe { value.CurrentValue() }.ok()?.to_string())
}

/// Reduce an address-bar string to a bare lowercase host. Returns None for
/// search queries / anything that isn't clearly a hostname.
fn domain_of(raw: &str) -> Option<String> {
    let s = raw.trim();
    if s.is_empty() || s.contains(char::is_whitespace) {
        return None; // a search term, not a URL
    }
    let after_scheme = s.split("://").last().unwrap_or(s);
    let host = after_scheme.split(['/', '?', '#']).next().unwrap_or(after_scheme);
    let host = host.rsplit('@').next().unwrap_or(host);
    let host = host.split(':').next().unwrap_or(host);
    let host = host.trim().trim_end_matches('.').to_lowercase();
    if host.contains('.') && host.len() >= 3 {
        Some(host)
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::domain_of;

    #[test]
    fn extracts_hosts_and_rejects_searches() {
        assert_eq!(domain_of("https://github.com/x/y?tab=1"), Some("github.com".into()));
        assert_eq!(domain_of("mail.google.com"), Some("mail.google.com".into()));
        assert_eq!(domain_of("https://user@Example.COM:8443/a"), Some("example.com".into()));
        assert_eq!(domain_of("how to write rust"), None);
        assert_eq!(domain_of("localhost"), None);
        assert_eq!(domain_of(""), None);
    }
}
