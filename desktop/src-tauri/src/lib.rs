mod capture;

use std::fs;
use std::path::PathBuf;

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{Emitter, Manager};
use uuid::Uuid;

// Set once the user has requested close and we've begun draining the sync queue,
// so the flushed second close request is allowed straight through.
static CLOSING: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

// Build the always-visible system tray + menu (Start Working, Open Timer,
// Open Dashboard, Check for Updates, Sign Out, Quit, …). Menu clicks that need
// app state emit a `tray:<id>` event the webview handles; window/quit are native.
fn setup_tray(app: &tauri::AppHandle) -> tauri::Result<()> {
    let mi = |id: &str, label: &str| MenuItem::with_id(app, id, label, true, None::<&str>);
    let items = [
        mi("start", "Start Working")?,
        mi("stop", "Stop Working")?,
        mi("note", "Add Time Note")?,
        mi("open", "Open Timer")?,
    ];
    let admin = [
        mi("dashboard", "Open Dashboard")?,
        mi("help", "Help Center")?,
        mi("updates", "Check for Updates")?,
        mi("about", "About Trax")?,
    ];
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
            &admin[0], &admin[1], &admin[2], &admin[3],
            &sep2,
            &signout,
            &sep3,
            &quit,
        ],
    )?;

    let mut builder = TrayIconBuilder::new().menu(&menu).tooltip("Trax").on_menu_event(|app, event| {
        let id = event.id().as_ref();
        match id {
            // Route Quit through the window close flow so a live session is
            // stopped and the sync queue flushed (see CloseRequested below)
            // instead of hard-killing the process.
            "quit" => {
                match app.get_webview_window("main") {
                    Some(w) => { let _ = w.close(); }
                    None => app.exit(0),
                }
            }
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            capture::spawn_workers(app.handle().clone());
            setup_tray(app.handle())?;
            Ok(())
        })
        .on_window_event(|window, event| {
            // On close: give the sync queue a chance to drain. The webview shows an
            // "Uploading data" dialog; we prevent the immediate close and let the
            // frontend flush the queue, then call close again once it's done.
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let has_work = capture::is_capturing()
                    || capture::queue_count(window.app_handle().clone()) > 0;
                if has_work && !CLOSING.swap(true, std::sync::atomic::Ordering::SeqCst)
                {
                    api.prevent_close();
                    let _ = window.emit("app-closing", ());
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_device_id,
            capture::begin_capture,
            capture::end_capture,
            capture::queue_count,
            capture::flush_now
        ])
        .run(tauri::generate_context!())
        .expect("error while running Trax");
}
