mod capture;

use std::fs;
use std::path::PathBuf;

use tauri::Manager;
use uuid::Uuid;

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
        .setup(|app| {
            capture::spawn_workers(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_device_id,
            capture::begin_capture,
            capture::end_capture
        ])
        .run(tauri::generate_context!())
        .expect("error while running Trax");
}
