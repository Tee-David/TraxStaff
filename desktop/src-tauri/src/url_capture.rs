// Windows browser URL sampling. The extraction reads the foreground browser's
// address bar via UI Automation and reduces it to a bare domain — never the
// full path/query (proportionate for an internal tool; disclosed on the consent
// screen). Called only when the foreground app is a known browser and the user
// is active; any failure degrades silently to app-only attribution.
//
// NOTE: the UI Automation COM extraction is not yet enabled — the windows-crate
// `VARIANT`/pattern surface needs to be finalized against a Windows compiler
// (it can't be built/verified from the Linux dev box). Until then this returns
// None: everything downstream (backend UrlUsage model + endpoint, dashboard
// URLs breakdown, offline queueing, active-only sampling) is wired and waiting.
// The domain parser below is the reusable piece; wiring the COM read to it is a
// single-function change.
#![cfg(windows)]

/// The bare domain shown in the foreground browser's address bar, if readable.
pub fn foreground_domain() -> Option<String> {
    // TODO(windows): implement via UI Automation — ElementFromHandle(
    // GetForegroundWindow()) → first Edit control → ValuePattern.CurrentValue →
    // domain_of(). Left disabled until it can be compiled on Windows.
    None
}

/// Reduce an address-bar string to a bare lowercase host. Returns None for
/// search queries / anything that isn't clearly a hostname.
#[allow(dead_code)]
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
