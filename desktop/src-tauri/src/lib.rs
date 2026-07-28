mod capture;
mod clock;
mod sync;
#[cfg(windows)]
mod os_idle;
#[cfg(windows)]
mod url_capture;

use std::fs;
use std::path::PathBuf;

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{Emitter, Manager, RunEvent};
use uuid::Uuid;

const TRAY_ID: &str = "trax-tray";

// Set once the user has requested close and we've begun draining the sync queue,
// so the flushed second close request is allowed straight through. cancel_close()
// resets it if the user backs out of the close dialog.
static CLOSING: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

// Build the always-visible system tray + menu. Menu clicks that need app state
// emit a `tray:<id>` event the webview handles; window/quit are native.
fn setup_tray(app: &tauri::AppHandle) -> tauri::Result<()> {
    let mi = |id: &str, label: &str| MenuItem::with_id(app, id, label, true, None::<&str>);
    let items = [
        mi("start", "Start Working")?,
        mi("stop", "Stop Working")?,
        mi("note", "Add Time Note")?,
        mi("open", "Open Timer")?,
    ];
    let dashboard = mi("dashboard", "Open Dashboard")?;
    let updates = mi("updates", "Check for Updates")?;
    let sep1 = PredefinedMenuItem::separator(app)?;
    let sep2 = PredefinedMenuItem::separator(app)?;
    let sep3 = PredefinedMenuItem::separator(app)?;
    let signout = mi("signout", "Sign Out")?;
    let quit = mi("quit", "Quit Trax")?;
    let menu = Menu::with_items(
        app,
        &[
            &items[0], &items[1], &items[2], &items[3],
            &sep1,
            &dashboard, &updates,
            &sep2,
            &signout,
            &sep3,
            &quit,
        ],
    )?;

    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .menu(&menu)
        .tooltip("Trax — not tracking")
        .on_menu_event(|app, event| {
            let id = event.id().as_ref();
            match id {
                // Route Quit through the window close flow so a live session is
                // stopped and the sync queue flushed (see CloseRequested below)
                // instead of hard-killing the process.
                "quit" => match app.get_webview_window("main") {
                    Some(w) => {
                        let _ = w.close();
                    }
                    None => app.exit(0),
                },
                _ => {
                    if id == "open" || id == "dashboard" {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                            let _ = w.unminimize();
                        }
                    }
                    let _ = app.emit(&format!("tray:{id}"), ());
                }
            }
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    Ok(())
}

/// Return a stable per-install device id, generating and persisting one on
/// first launch. Stored under the app's data dir so it survives restarts.
#[tauri::command]
fn get_device_id(app: tauri::AppHandle) -> Result<String, String> {
    let dir: PathBuf = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("no app data dir: {e}"))?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    let path = dir.join("device_id");
    if let Ok(existing) = fs::read_to_string(&path) {
        let trimmed = existing.trim();
        if !trimmed.is_empty() {
            return Ok(trimmed.to_string());
        }
    }

    let id = Uuid::new_v4().to_string();
    fs::write(&path, &id).map_err(|e| e.to_string())?;
    Ok(id)
}

/// Reflect tracking state in the tray tooltip (always-visible indicator; there
/// is no stealth mode).
#[tauri::command]
fn set_tracking_indicator(app: tauri::AppHandle, active: bool) {
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        let _ = tray.set_tooltip(Some(if active { "Trax — tracking" } else { "Trax — not tracking" }));
    }
}

/// The user backed out of the close dialog — allow future close requests to
/// re-trigger the flow.
#[tauri::command]
fn cancel_close() {
    CLOSING.store(false, std::sync::atomic::Ordering::SeqCst);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        // Single-instance MUST be registered first: a second launch focuses the
        // running tracker instead of spawning a duplicate that double-captures.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            capture::spawn_workers(app.handle().clone());
            sync::spawn_sync_loop(app.handle().clone());
            setup_tray(app.handle())?;
            Ok(())
        })
        .on_window_event(|window, event| {
            // On close: if a session is live or the queue isn't empty, hold the
            // window open and let the webview show the exit dialog (stop & sync /
            // quit anyway / cancel). The dialog decides when to destroy().
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let capturing = capture::is_capturing();
                let pending = sync::queue_count(window.app_handle().clone());
                // Only intercept the close for a LIVE session (the tracker is
                // mounted then, so the dialog has a listener). A non-empty queue
                // with no live session drains on next launch — don't hold the
                // window open on the login/consent screen where nothing listens.
                let visible = window.is_visible().unwrap_or(true);
                if capturing
                    && visible
                    && !CLOSING.swap(true, std::sync::atomic::Ordering::SeqCst)
                {
                    api.prevent_close();
                    let _ = window.emit(
                        "app-closing",
                        serde_json::json!({ "capturing": capturing, "pending": pending }),
                    );
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_device_id,
            set_tracking_indicator,
            cancel_close,
            capture::begin_capture,
            capture::end_capture,
            capture::get_elapsed,
            capture::capture_health,
            capture::local_shots,
            sync::set_sync_auth,
            sync::queue_count,
            sync::flush_now,
            sync::flush_now_async,
        ])
        .build(tauri::generate_context!());

    match app {
        Ok(app) => app.run(|_app, event| {
            // Any exit path (incl. tray Quit with no window): finalize the live
            // block into the durable queue before the process goes away. Fast,
            // no network — the queue drains on next launch.
            if let RunEvent::ExitRequested { .. } = event {
                if capture::is_capturing() {
                    capture::end();
                }
            }
        }),
        Err(e) => {
            eprintln!("Trax failed to start: {e}");
        }
    }
}
