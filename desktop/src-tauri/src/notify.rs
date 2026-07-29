//! Native OS notifications.
//!
//! These deliberately do NOT use the notification plugin's JavaScript API. That
//! API sends through `window.Notification`, and its injected shim additionally
//! seeds the permission state as "denied" on Windows — so every toast raised
//! from the webview was swallowed before it ever reached the OS, and alerts
//! only ever appeared as the in-app banner. The webview calls `notify_os`
//! instead, which hands the notification straight to the platform notifier.
//!
//! Windows branding (the "Trax" header row and app icon Windows draws beside
//! each toast) comes from the AppUserModelID the NSIS installer stamps on the
//! Start Menu shortcut; the plugin sends under the bundle identifier, which
//! resolves to that registration. Nothing to set per notification — Windows
//! ignores the builder's icon, so it is only used by the Linux notifier.

use std::path::PathBuf;

use tauri::{AppHandle, Manager};
use tauri_plugin_notification::NotificationExt;

/// Longest title/body forwarded to the OS. IPC input is untrusted, and a toast
/// is not a place for unbounded text.
const MAX_LEN: usize = 180;

fn clip(s: &str) -> String {
    let s = s.trim();
    match s.char_indices().nth(MAX_LEN) {
        Some((i, _)) => format!("{}…", &s[..i]),
        None => s.to_owned(),
    }
}

/// Absolute path to the brand icon, materialised next to the device id on first
/// use. The bundled icons are compiled into the executable rather than
/// installed as loose files, so the notifier needs its own copy on disk.
fn brand_icon(app: &AppHandle) -> Option<PathBuf> {
    let dir = app.path().app_data_dir().ok()?;
    let path = dir.join("trax-icon.png");
    if !path.exists() {
        std::fs::create_dir_all(&dir).ok()?;
        std::fs::write(&path, include_bytes!("../icons/128x128.png")).ok()?;
    }
    Some(path)
}

/// Raise a native notification. Best-effort: a notifier that refuses must never
/// interrupt tracking, so failures are logged rather than propagated.
#[tauri::command]
pub fn notify_os(app: AppHandle, title: String, body: String) {
    let title = clip(&title);
    let mut builder = app
        .notification()
        .builder()
        .title(title.clone())
        .body(clip(&body));
    if let Some(icon) = brand_icon(&app) {
        builder = builder.icon(icon.to_string_lossy().into_owned());
    }
    if let Err(e) = builder.show() {
        eprintln!("[notify] could not show \"{title}\": {e}");
    }
}
