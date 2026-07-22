// Sync engine: owns the backend credentials, the offline-queue flush with
// retry/backoff (tolerant of Render free-tier cold starts), and the
// `trax:sync-state` event the UI renders. capture.rs produces records;
// this module gets them to the server exactly once.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

use chrono::{SecondsFormat, Utc};
use once_cell::sync::Lazy;
use rand::Rng;
use tauri::{AppHandle, Emitter, Manager};

/// Origins the desktop client may talk to — must stay in lockstep with the
/// CSP `connect-src` in tauri.conf.json.
const ALLOWED_BACKENDS: &[&str] = &[
    "http://localhost:3099",
    "https://trax-backend-ocaq.onrender.com",
];

const INITIAL_BACKOFF_SECS: u64 = 30;
const MAX_BACKOFF_SECS: u64 = 300;

struct SyncState {
    token: String,
    backend: String,
    last_synced_at: Option<String>,
    last_error: Option<String>,
    consecutive_failures: u32,
    next_attempt_at: i64, // unix seconds; loop waits until then after a failure
}

static SYNC: Lazy<Mutex<SyncState>> = Lazy::new(|| {
    Mutex::new(SyncState {
        token: String::new(),
        backend: String::new(),
        last_synced_at: None,
        last_error: None,
        consecutive_failures: 0,
        next_attempt_at: 0,
    })
});
static APP: Lazy<Mutex<Option<AppHandle>>> = Lazy::new(|| Mutex::new(None));

#[derive(Clone, serde::Serialize)]
struct SyncStatePayload {
    pending: usize,
    #[serde(rename = "lastSyncedAt")]
    last_synced_at: Option<String>,
    online: bool,
    #[serde(rename = "lastError")]
    last_error: Option<String>,
}

pub fn backend_allowed(backend: &str) -> bool {
    ALLOWED_BACKENDS.contains(&backend)
}

pub fn queue_dir_for(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_data_dir().ok().map(|d| d.join("queue"))
}

/// Queue dir resolved from the stored app handle — for callers (capture.rs)
/// that don't have an AppHandle on hand.
pub fn queue_dir_for_current() -> Option<PathBuf> {
    let guard = APP.lock().ok()?;
    let app = guard.as_ref()?;
    queue_dir_for(app)
}

pub fn count_blocks(dir: &Path) -> usize {
    fs::read_dir(dir)
        .map(|entries| {
            entries
                .flatten()
                .filter(|e| e.file_name().to_string_lossy().starts_with("block-"))
                .count()
        })
        .unwrap_or(0)
}

fn iso_now() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}

/// Push the current sync state to the UI. Safe to call from any thread.
pub fn emit_state() {
    let Ok(app_guard) = APP.lock() else { return };
    let Some(app) = app_guard.as_ref() else { return };
    let pending = queue_dir_for(app).map(|d| count_blocks(&d)).unwrap_or(0);
    let payload = {
        let Ok(s) = SYNC.lock() else { return };
        SyncStatePayload {
            pending,
            last_synced_at: s.last_synced_at.clone(),
            online: s.consecutive_failures == 0,
            last_error: s.last_error.clone(),
        }
    };
    let _ = app.emit("trax:sync-state", payload);
}

/// Record the outcome of any sync attempt (live block or queue flush) so
/// backoff and the UI state stay accurate, then notify the UI.
pub fn note_attempt_result(ok: bool, err: Option<String>) {
    if let Ok(mut s) = SYNC.lock() {
        if ok {
            s.last_synced_at = Some(iso_now());
            s.last_error = None;
            s.consecutive_failures = 0;
            s.next_attempt_at = 0;
        } else {
            s.consecutive_failures = s.consecutive_failures.saturating_add(1);
            let base = INITIAL_BACKOFF_SECS
                .saturating_mul(2u64.saturating_pow(s.consecutive_failures.saturating_sub(1)))
                .min(MAX_BACKOFF_SECS);
            let jitter = rand::thread_rng().gen_range(0.8..1.2);
            s.next_attempt_at = Utc::now().timestamp() + (base as f64 * jitter) as i64;
            s.last_error = err;
        }
    }
    emit_state();
}

// ---- network calls (blocking; always invoked off the main thread) ----

fn client(timeout_secs: u64) -> Option<reqwest::blocking::Client> {
    reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(timeout_secs))
        .build()
        .ok()
}

/// POST one activity block. Returns Ok(true) on 2xx, Ok(false) on a
/// permanent server rejection (safe to drop), Err on anything worth retrying.
fn post_block(
    c: &reqwest::blocking::Client,
    backend: &str,
    token: &str,
    session_id: &str,
    block: &serde_json::Value,
) -> Result<bool, String> {
    let body = serde_json::json!({ "sessionId": session_id, "blocks": [block] });
    let resp = c
        .post(format!("{backend}/sync/activity"))
        .bearer_auth(token)
        .json(&body)
        .send()
        .map_err(|e| format!("network: {e}"))?;
    let status = resp.status();
    if status.is_success() {
        Ok(true)
    } else if status.as_u16() == 400 {
        // Malformed/rejected payload will never succeed — don't wedge the queue.
        Ok(false)
    } else {
        // 401/403 (stale token) and 5xx: keep the data, retry later.
        Err(format!("server: {status}"))
    }
}

pub fn sync_block<T: serde::Serialize>(
    backend: &str,
    token: &str,
    session_id: &str,
    block: &T,
) -> bool {
    let Some(c) = client(20) else { return false };
    let Ok(v) = serde_json::to_value(block) else { return false };
    matches!(post_block(&c, backend, token, session_id, &v), Ok(true))
}

pub fn sync_app_usage(
    backend: &str,
    token: &str,
    session_id: &str,
    block_start: &str,
    apps: &[(String, i64)],
) -> bool {
    let Some(c) = client(20) else { return false };
    let apps_json: Vec<_> = apps
        .iter()
        .map(|(n, s)| serde_json::json!({ "appName": n, "seconds": s }))
        .collect();
    let body = serde_json::json!({ "sessionId": session_id, "blockStart": block_start, "apps": apps_json });
    c.post(format!("{backend}/sync/app-usage"))
        .bearer_auth(token)
        .json(&body)
        .send()
        .map(|r| r.status().is_success())
        .unwrap_or(false)
}

pub fn sync_url_usage(
    backend: &str,
    token: &str,
    session_id: &str,
    block_start: &str,
    urls: &[(String, i64)],
) -> bool {
    let Some(c) = client(20) else { return false };
    let urls_json: Vec<_> = urls
        .iter()
        .map(|(d, s)| serde_json::json!({ "domain": d, "seconds": s }))
        .collect();
    let body = serde_json::json!({ "sessionId": session_id, "blockStart": block_start, "urls": urls_json });
    c.post(format!("{backend}/sync/url-usage"))
        .bearer_auth(token)
        .json(&body)
        .send()
        .map(|r| r.status().is_success())
        .unwrap_or(false)
}

/// Presign → PUT to R2 → confirm, for one screenshot's bytes.
pub fn upload_shot(
    backend: &str,
    token: &str,
    session_id: &str,
    seq: u32,
    monitor_index: u32,
    taken_at_iso: &str,
    bytes: &[u8],
    blur: bool,
) -> bool {
    let Some(c) = client(30) else { return false };
    let presign = c
        .post(format!("{backend}/screenshots/presign"))
        .bearer_auth(token)
        .json(&serde_json::json!({ "sessionId": session_id, "monitorIndex": monitor_index, "takenAt": taken_at_iso }))
        .send();
    let (url, key) = match presign.and_then(|r| r.json::<serde_json::Value>()) {
        Ok(v) => (
            v.get("uploadUrl").and_then(|x| x.as_str()).unwrap_or("").to_string(),
            v.get("r2Key").and_then(|x| x.as_str()).unwrap_or("").to_string(),
        ),
        Err(_) => return false,
    };
    if url.is_empty() {
        return false;
    }
    let put_ok = c
        .put(&url)
        .header("Content-Type", "image/webp")
        .body(bytes.to_vec())
        .send()
        .map(|r| r.status().is_success())
        .unwrap_or(false);
    if !put_ok {
        return false;
    }
    c.post(format!("{backend}/screenshots/confirm"))
        .bearer_auth(token)
        .json(&serde_json::json!({
            "sessionId": session_id, "sequenceNo": seq, "r2Key": key,
            "monitorIndex": monitor_index, "takenAt": taken_at_iso, "blurred": blur
        }))
        .send()
        .map(|r| r.status().is_success())
        .unwrap_or(false)
}

// ---- offline queue flush ----

/// Drain the on-disk queue: for each block file (oldest first) POST the block,
/// then upload its queued screenshots (the block row must exist server-side
/// before /screenshots/confirm), deleting files only after success. Stops at
/// the first retryable failure.
pub fn flush_queue_dir(dir: &Path, backend: &str, token: &str, timeout_secs: u64) -> Result<(), String> {
    let Ok(entries) = fs::read_dir(dir) else { return Ok(()) };
    let mut blocks: Vec<PathBuf> = entries
        .flatten()
        .map(|e| e.path())
        .filter(|p| {
            p.file_name()
                .map(|n| {
                    let n = n.to_string_lossy();
                    n.starts_with("block-") && n.ends_with(".json")
                })
                .unwrap_or(false)
        })
        .collect();
    blocks.sort();
    let Some(c) = client(timeout_secs) else { return Err("http client".into()) };
    for path in blocks {
        let Ok(text) = fs::read_to_string(&path) else { continue };
        let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) else {
            let _ = fs::remove_file(&path); // corrupt file — unrecoverable
            continue;
        };
        let session_id = v.get("sessionId").and_then(|x| x.as_str()).unwrap_or("").to_string();
        let seq = v.get("seq").and_then(|x| x.as_u64()).unwrap_or(0) as u32;
        let blur = v.get("blur").and_then(|x| x.as_bool()).unwrap_or(false);

        match post_block(&c, backend, token, &session_id, &v["block"])? {
            true => {}
            false => {
                // Permanently rejected — drop the block and its shots.
                remove_block_files(dir, &path, &v);
                continue;
            }
        }

        // Block row exists server-side — now its screenshots can be confirmed.
        if let Some(shots) = v.get("shots").and_then(|x| x.as_array()) {
            for shot in shots {
                let file = shot.get("file").and_then(|x| x.as_str()).unwrap_or("");
                let monitor = shot.get("monitorIndex").and_then(|x| x.as_u64()).unwrap_or(0) as u32;
                let taken = shot.get("takenAt").and_then(|x| x.as_str()).unwrap_or("");
                if file.is_empty() || taken.is_empty() {
                    continue;
                }
                let shot_path = dir.join(file);
                let Ok(bytes) = fs::read(&shot_path) else { continue };
                if upload_shot(backend, token, &session_id, seq, monitor, taken, &bytes, blur) {
                    let _ = fs::remove_file(&shot_path);
                } else {
                    // Retryable (offline / cold start): the block re-POSTs next
                    // pass — /sync/activity is idempotent on (sessionId, seq).
                    return Err("screenshot upload failed".into());
                }
            }
        }

        // App/URL usage: idempotent server-side (skipDuplicates), so re-sending
        // after a partial flush is safe.
        let block_start = v["block"].get("blockStart").and_then(|x| x.as_str()).unwrap_or("");
        if !block_start.is_empty() {
            if let Some(apps) = v.get("appUsage").and_then(|x| x.as_array()) {
                let pairs = json_usage_pairs(apps, "appName");
                if !pairs.is_empty() && !sync_app_usage(backend, token, &session_id, block_start, &pairs) {
                    return Err("app-usage sync failed".into());
                }
            }
            if let Some(urls) = v.get("urlUsage").and_then(|x| x.as_array()) {
                let pairs = json_usage_pairs(urls, "domain");
                if !pairs.is_empty() && !sync_url_usage(backend, token, &session_id, block_start, &pairs) {
                    return Err("url-usage sync failed".into());
                }
            }
        }
        let _ = fs::remove_file(&path);
    }
    Ok(())
}

/// Extract [(name, seconds)] pairs from a queued usage array (app or URL).
fn json_usage_pairs(arr: &[serde_json::Value], key: &str) -> Vec<(String, i64)> {
    arr.iter()
        .filter_map(|e| {
            let name = e.get(key).and_then(|x| x.as_str())?.to_string();
            let secs = e.get("seconds").and_then(|x| x.as_i64())?;
            Some((name, secs))
        })
        .collect()
}

fn remove_block_files(dir: &Path, block_path: &Path, v: &serde_json::Value) {
    if let Some(shots) = v.get("shots").and_then(|x| x.as_array()) {
        for shot in shots {
            if let Some(file) = shot.get("file").and_then(|x| x.as_str()) {
                let _ = fs::remove_file(dir.join(file));
            }
        }
    }
    let _ = fs::remove_file(block_path);
}

/// Delete shot files no block references (legacy filename-format leftovers
/// from before shots were tracked in the block JSON) once they're stale.
fn cleanup_orphan_shots(dir: &Path) {
    let Ok(entries) = fs::read_dir(dir) else { return };
    let mut referenced: Vec<String> = Vec::new();
    let mut shot_files: Vec<PathBuf> = Vec::new();
    for e in entries.flatten() {
        let name = e.file_name().to_string_lossy().to_string();
        if name.starts_with("block-") && name.ends_with(".json") {
            if let Ok(text) = fs::read_to_string(e.path()) {
                if let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) {
                    if let Some(shots) = v.get("shots").and_then(|x| x.as_array()) {
                        for s in shots {
                            if let Some(f) = s.get("file").and_then(|x| x.as_str()) {
                                referenced.push(f.to_string());
                            }
                        }
                    }
                }
            }
        } else if name.starts_with("shot-") && name.ends_with(".webp") {
            shot_files.push(e.path());
        }
    }
    let week = Duration::from_secs(7 * 24 * 3600);
    for path in shot_files {
        let name = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
        if referenced.iter().any(|r| r == &name) {
            continue;
        }
        let stale = fs::metadata(&path)
            .and_then(|m| m.modified())
            .ok()
            .and_then(|t| t.elapsed().ok())
            .map(|age| age > week)
            .unwrap_or(true);
        if stale {
            let _ = fs::remove_file(&path);
        }
    }
}

// ---- background loop ----

/// One pass of the background sync loop: flush the queue if there's work,
/// auth is present, and backoff allows.
fn sync_pass(app: &AppHandle) {
    let Some(dir) = queue_dir_for(app) else { return };
    if count_blocks(&dir) == 0 {
        return;
    }
    let (token, backend, failures) = {
        let Ok(s) = SYNC.lock() else { return };
        if s.token.is_empty() || s.backend.is_empty() {
            return;
        }
        if Utc::now().timestamp() < s.next_attempt_at {
            return;
        }
        (s.token.clone(), s.backend.clone(), s.consecutive_failures)
    };
    // Generous first-attempt timeout: the Render free tier cold-starts (~15min idle).
    let timeout = if failures == 0 { 60 } else { 20 };
    match flush_queue_dir(&dir, &backend, &token, timeout) {
        Ok(()) => note_attempt_result(true, None),
        Err(e) => note_attempt_result(false, Some(e)),
    }
}

/// Spawn the background sync thread. Call once at startup.
pub fn spawn_sync_loop(app: AppHandle) {
    if let Ok(mut guard) = APP.lock() {
        *guard = Some(app.clone());
    }
    std::thread::spawn(move || {
        if let Some(dir) = queue_dir_for(&app) {
            cleanup_orphan_shots(&dir);
        }
        loop {
            std::thread::sleep(Duration::from_secs(5));
            let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| sync_pass(&app)));
        }
    });
}

// ---- Tauri commands ----

/// Give the sync engine credentials (on login / app mount) so the queue can
/// drain even when no tracking session is running. Empty token clears auth.
#[tauri::command]
pub fn set_sync_auth(token: String, backend: String) -> Result<(), String> {
    if !token.is_empty() && !backend_allowed(&backend) {
        return Err("backend not allowed".into());
    }
    if let Ok(mut s) = SYNC.lock() {
        s.token = token;
        s.backend = backend;
        s.next_attempt_at = 0; // fresh credentials — try immediately
        s.consecutive_failures = 0;
    }
    emit_state();
    Ok(())
}

/// Count pending queued activity blocks (exit dialog + sync badge seed).
#[tauri::command]
pub fn queue_count(app: AppHandle) -> usize {
    queue_dir_for(&app).map(|d| count_blocks(&d)).unwrap_or(0)
}

/// Finalize the active session and drain the offline queue in one shot.
/// Returns the number of blocks still pending afterwards (0 = fully synced).
#[tauri::command]
pub fn flush_now(app: AppHandle, token: String, backend: String) -> usize {
    crate::capture::end();
    if let Some(dir) = queue_dir_for(&app) {
        let _ = flush_queue_dir(&dir, &backend, &token, 20);
        count_blocks(&dir)
    } else {
        0
    }
}

/// Non-blocking exit flush: stops the session, drains the queue off the main
/// thread (bounded per-request timeout so close can't hang), and reports the
/// remaining count via `trax:flush-progress`. Returns blocks still pending.
#[tauri::command]
pub async fn flush_now_async(app: AppHandle, token: String, backend: String) -> usize {
    tauri::async_runtime::spawn_blocking(move || {
        crate::capture::end();
        let Some(dir) = queue_dir_for(&app) else { return 0 };
        let _ = flush_queue_dir(&dir, &backend, &token, 15);
        let remaining = count_blocks(&dir);
        let _ = app.emit("trax:flush-progress", serde_json::json!({ "remaining": remaining }));
        remaining
    })
    .await
    .unwrap_or(0)
}
