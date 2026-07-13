// Native capture core: samples keyboard/mouse *intensity* (never content),
// computes per-10-min activity %, captures all-monitor WebP screenshots at the
// admin-set frequency, and syncs a tamper-evident hash-chain to the backend.
// Falls back to an on-disk queue when offline and retries.
//
// Verified via the Windows CI build (this Linux sandbox can't build the GUI).

use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::Write;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicI64, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use chrono::{DateTime, SecondsFormat, Utc};
use once_cell::sync::Lazy;
use rand::Rng;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter};

const GENESIS: &str = "GENESIS";
const JIGGLER_BLOCKLIST: &[&str] = &[
    "mousejiggler", "movemouse", "move mouse", "caffeine", "autoclicker",
    "auto clicker", "mousemover", "jiggler", "wiggler", "clickermann", "pressplay",
];

static ACTIVE: AtomicBool = AtomicBool::new(false);
static LAST_INPUT: AtomicI64 = AtomicI64::new(0);
static IDLE_NOTIFIED: AtomicBool = AtomicBool::new(false);
static CAPTURE: Lazy<Mutex<Option<Capture>>> = Lazy::new(|| Mutex::new(None));
static APP_HANDLE: Lazy<Mutex<Option<AppHandle>>> = Lazy::new(|| Mutex::new(None));

struct PendingShot {
    monitor_index: u32,
    taken_at: DateTime<Utc>,
    bytes: Vec<u8>,
}

struct Capture {
    token: String,
    backend: String,
    session_id: String,
    screenshots_per_block: u32,
    blur: bool,
    block_secs: i64,
    seq: u32,
    prev_hash: String,
    block_start: DateTime<Utc>,
    kb_secs: HashSet<i64>,
    mouse_secs: HashSet<i64>,
    shot_offsets: Vec<i64>,
    shots_taken: HashSet<i64>,
    pending_shots: Vec<PendingShot>,
    app_secs: HashMap<String, i64>,
    idle_threshold: i64,
    queue_dir: PathBuf,
}

impl Capture {
    #[allow(clippy::too_many_arguments)]
    fn new(
        token: String,
        backend: String,
        session_id: String,
        screenshots_per_block: u32,
        blur: bool,
        idle_threshold: i64,
        queue_dir: PathBuf,
        block_secs: i64,
    ) -> Self {
        let mut c = Capture {
            token,
            backend,
            session_id,
            screenshots_per_block,
            blur,
            block_secs,
            seq: 0,
            prev_hash: GENESIS.to_string(),
            block_start: Utc::now(),
            kb_secs: HashSet::new(),
            mouse_secs: HashSet::new(),
            shot_offsets: Vec::new(),
            shots_taken: HashSet::new(),
            pending_shots: Vec::new(),
            app_secs: HashMap::new(),
            idle_threshold,
            queue_dir,
        };
        c.plan_shots();
        c
    }

    fn plan_shots(&mut self) {
        self.shot_offsets.clear();
        self.shots_taken.clear();
        if self.screenshots_per_block == 0 {
            return;
        }
        let mut rng = rand::thread_rng();
        let mut offs = HashSet::new();
        // spread N screenshots across the block at distinct random seconds
        while (offs.len() as u32) < self.screenshots_per_block {
            offs.insert(rng.gen_range(5..self.block_secs.max(6)));
        }
        self.shot_offsets = offs.into_iter().collect();
    }

    fn iso(dt: DateTime<Utc>) -> String {
        // Matches JS new Date(x).toISOString() exactly (3-digit ms + Z).
        dt.to_rfc3339_opts(SecondsFormat::Millis, true)
    }
}

fn iso_now() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}

/// Record an input event into the current block's per-second active buckets.
pub fn on_input(is_keyboard: bool) {
    if !ACTIVE.load(Ordering::Relaxed) {
        return;
    }
    LAST_INPUT.store(Utc::now().timestamp(), Ordering::Relaxed);
    IDLE_NOTIFIED.store(false, Ordering::Relaxed);
    if let Ok(mut guard) = CAPTURE.lock() {
        if let Some(c) = guard.as_mut() {
            let sec = Utc::now().timestamp();
            if is_keyboard {
                c.kb_secs.insert(sec);
            } else {
                c.mouse_secs.insert(sec);
            }
        }
    }
}

/// Start capturing for a session.
#[allow(clippy::too_many_arguments)]
pub fn begin(
    token: String,
    backend: String,
    session_id: String,
    screenshots_per_block: u32,
    blur: bool,
    idle_minutes: i64,
    queue_dir: PathBuf,
) {
    let block_secs = std::env::var("TRAX_BLOCK_SECS")
        .ok()
        .and_then(|v| v.parse::<i64>().ok())
        .unwrap_or(600)
        .clamp(30, 3600);
    let _ = fs::create_dir_all(&queue_dir);
    LAST_INPUT.store(Utc::now().timestamp(), Ordering::Relaxed);
    IDLE_NOTIFIED.store(false, Ordering::Relaxed);
    if let Ok(mut guard) = CAPTURE.lock() {
        *guard = Some(Capture::new(
            token,
            backend,
            session_id,
            screenshots_per_block,
            blur,
            idle_minutes.clamp(1, 60) * 60,
            queue_dir,
            block_secs,
        ));
    }
    ACTIVE.store(true, Ordering::Relaxed);
}

/// Stop capturing: finalize the partial block and flush.
pub fn end() {
    ACTIVE.store(false, Ordering::Relaxed);
    finalize_block(true);
    if let Ok(mut guard) = CAPTURE.lock() {
        *guard = None;
    }
}

/// Background worker: called ~every second. Handles screenshot timing and block boundaries.
pub fn tick() {
    if !ACTIVE.load(Ordering::Relaxed) {
        return;
    }
    // Sample the foreground app for this second (outside the lock; it can be slow).
    let active_app = active_win_pos_rs::get_active_window().ok().map(|w| {
        let mut name = w.app_name;
        if name.trim().is_empty() {
            name = w.title;
        }
        name.trim().to_string()
    });

    // Idle detection: notify the UI once per idle stretch.
    let idle_threshold = CAPTURE.lock().ok().and_then(|g| g.as_ref().map(|c| c.idle_threshold)).unwrap_or(300);
    let idle_for = Utc::now().timestamp() - LAST_INPUT.load(Ordering::Relaxed);
    if idle_for >= idle_threshold && !IDLE_NOTIFIED.swap(true, Ordering::Relaxed) {
        if let Ok(guard) = APP_HANDLE.lock() {
            if let Some(app) = guard.as_ref() {
                let _ = app.emit("trax:idle", idle_for / 60);
            }
        }
    }

    // Determine due screenshots + whether the block is complete (under lock, briefly).
    let (due, backend, token, session_id, blur, seq, complete) = {
        let mut guard = match CAPTURE.lock() {
            Ok(g) => g,
            Err(_) => return,
        };
        let c = match guard.as_mut() {
            Some(c) => c,
            None => return,
        };
        if let Some(app) = &active_app {
            if !app.is_empty() {
                *c.app_secs.entry(app.clone()).or_insert(0) += 1;
            }
        }
        let elapsed = (Utc::now() - c.block_start).num_seconds();
        let mut due = Vec::new();
        for &off in &c.shot_offsets {
            if elapsed >= off && !c.shots_taken.contains(&off) {
                c.shots_taken.insert(off);
                due.push(off);
            }
        }
        (
            due,
            c.backend.clone(),
            c.token.clone(),
            c.session_id.clone(),
            c.blur,
            c.seq,
            elapsed >= c.block_secs,
        )
    };

    // Capture screenshots outside the lock (slow), then stash bytes.
    if !due.is_empty() {
        let shots = capture_all_monitors();
        if let Ok(mut guard) = CAPTURE.lock() {
            if let Some(c) = guard.as_mut() {
                for (idx, bytes) in shots {
                    c.pending_shots.push(PendingShot { monitor_index: idx, taken_at: Utc::now(), bytes });
                }
            }
        }
    }
    let _ = (backend, token, session_id, blur, seq);

    if complete {
        finalize_block(false);
    }
}

fn capture_all_monitors() -> Vec<(u32, Vec<u8>)> {
    let mut out = Vec::new();
    let monitors = match xcap::Monitor::all() {
        Ok(m) => m,
        Err(_) => return out,
    };
    for (i, m) in monitors.iter().enumerate() {
        if let Ok(img) = m.capture_image() {
            let (w, h) = (img.width(), img.height());
            let raw = img.as_raw();
            let encoder = webp::Encoder::from_rgba(raw, w, h);
            let mem = encoder.encode(72.0); // lossy q72 — good size/quality balance
            out.push((i as u32, mem.to_vec()));
        }
    }
    out
}

fn detect_jiggler() -> Option<String> {
    let mut sys = sysinfo::System::new();
    sys.refresh_processes(sysinfo::ProcessesToUpdate::All, true);
    for process in sys.processes().values() {
        let raw = process.name().to_string_lossy();
        let name = raw.to_lowercase();
        for bad in JIGGLER_BLOCKLIST {
            if name.contains(bad) {
                return Some(raw.to_string());
            }
        }
    }
    None
}

#[derive(serde::Serialize)]
struct BlockPayload {
    #[serde(rename = "blockStart")]
    block_start: String,
    #[serde(rename = "blockEnd")]
    block_end: String,
    #[serde(rename = "keyboardPct")]
    keyboard_pct: f64,
    #[serde(rename = "mousePct")]
    mouse_pct: f64,
    #[serde(rename = "activityPct")]
    activity_pct: f64,
    #[serde(rename = "idleSeconds")]
    idle_seconds: i64,
    #[serde(rename = "sequenceNo")]
    sequence_no: u32,
    #[serde(rename = "prevHash")]
    prev_hash: String,
    hash: String,
    #[serde(rename = "jigglerProcess", skip_serializing_if = "Option::is_none")]
    jiggler_process: Option<String>,
}

fn round2(v: f64) -> f64 {
    (v * 100.0).round() / 100.0
}

/// Finalize the current block: compute activity %, build the hash-chained payload,
/// sync it, upload its screenshots. Then advance the chain (unless stopping).
fn finalize_block(stopping: bool) {
    // Build payload + drain shots under the lock.
    let (payload, session_id, backend, token, blur, seq, shots, app_usage, block_start_iso) = {
        let mut guard = match CAPTURE.lock() {
            Ok(g) => g,
            Err(_) => return,
        };
        let c = match guard.as_mut() {
            Some(c) => c,
            None => return,
        };
        let end = Utc::now();
        let block_secs = (end - c.block_start).num_seconds().max(1);
        let denom = block_secs as f64;
        let kb = c.kb_secs.len() as f64;
        let mouse = c.mouse_secs.len() as f64;
        let active: HashSet<i64> = c.kb_secs.union(&c.mouse_secs).copied().collect();
        let act = active.len() as f64;
        let kb_pct = round2((kb / denom * 100.0).min(100.0));
        let mouse_pct = round2((mouse / denom * 100.0).min(100.0));
        let act_pct = round2((act / denom * 100.0).min(100.0));
        let idle = (block_secs - active.len() as i64).max(0);

        let start_iso = Capture::iso(c.block_start);
        let end_iso = Capture::iso(end);
        // canonical MUST match backend: sessionId|seq|startISO|endISO|kb|mouse|act|idle
        let canonical = format!(
            "{}|{}|{}|{}|{:.2}|{:.2}|{:.2}|{}",
            c.session_id, c.seq, start_iso, end_iso, kb_pct, mouse_pct, act_pct, idle
        );
        let mut hasher = Sha256::new();
        hasher.update(c.prev_hash.as_bytes());
        hasher.update(canonical.as_bytes());
        let hash = hex(hasher.finalize().as_slice());

        let jiggler = detect_jiggler();

        let payload = BlockPayload {
            block_start: start_iso,
            block_end: end_iso,
            keyboard_pct: kb_pct,
            mouse_pct: mouse_pct,
            activity_pct: act_pct,
            idle_seconds: idle,
            sequence_no: c.seq,
            prev_hash: c.prev_hash.clone(),
            hash: hash.clone(),
            jiggler_process: jiggler,
        };
        let shots = std::mem::take(&mut c.pending_shots);
        let app_usage: Vec<(String, i64)> = c.app_secs.drain().collect();
        let block_start_iso = payload.block_start.clone();
        let seq = c.seq;
        let sid = c.session_id.clone();
        let backend = c.backend.clone();
        let token = c.token.clone();
        let blur = c.blur;

        // advance the chain for the next block (unless we're stopping)
        if !stopping {
            c.seq += 1;
            c.prev_hash = hash.clone();
            c.block_start = end;
            c.kb_secs.clear();
            c.mouse_secs.clear();
            c.plan_shots();
        }
        (payload, sid, backend, token, blur, seq, shots, app_usage, block_start_iso)
    };

    // Network I/O outside the lock.
    let synced = sync_block(&backend, &token, &session_id, &payload);
    if synced {
        for shot in &shots {
            upload_shot(&backend, &token, &session_id, seq, shot, blur);
        }
        if !app_usage.is_empty() {
            sync_app_usage(&backend, &token, &session_id, &block_start_iso, &app_usage);
        }
        flush_queue(&backend, &token);
    } else {
        enqueue_block(&session_id, &payload, &shots, blur, seq);
    }
}

fn sync_block(backend: &str, token: &str, session_id: &str, block: &BlockPayload) -> bool {
    let client = match reqwest::blocking::Client::builder().timeout(Duration::from_secs(20)).build() {
        Ok(c) => c,
        Err(_) => return false,
    };
    let body = serde_json::json!({ "sessionId": session_id, "blocks": [block] });
    match client.post(format!("{backend}/sync/activity")).bearer_auth(token).json(&body).send() {
        Ok(r) => r.status().is_success(),
        Err(_) => false,
    }
}

fn sync_app_usage(backend: &str, token: &str, session_id: &str, block_start: &str, apps: &[(String, i64)]) {
    let client = match reqwest::blocking::Client::builder().timeout(Duration::from_secs(20)).build() {
        Ok(c) => c,
        Err(_) => return,
    };
    let apps_json: Vec<_> = apps.iter().map(|(n, s)| serde_json::json!({ "appName": n, "seconds": s })).collect();
    let body = serde_json::json!({ "sessionId": session_id, "blockStart": block_start, "apps": apps_json });
    let _ = client.post(format!("{backend}/sync/app-usage")).bearer_auth(token).json(&body).send();
}

fn upload_shot(backend: &str, token: &str, session_id: &str, seq: u32, shot: &PendingShot, blur: bool) -> bool {
    let client = match reqwest::blocking::Client::builder().timeout(Duration::from_secs(30)).build() {
        Ok(c) => c,
        Err(_) => return false,
    };
    let taken = shot.taken_at.to_rfc3339_opts(SecondsFormat::Millis, true);
    // 1) presign
    let presign = client
        .post(format!("{backend}/screenshots/presign"))
        .bearer_auth(token)
        .json(&serde_json::json!({ "sessionId": session_id, "monitorIndex": shot.monitor_index, "takenAt": taken }))
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
    // 2) upload bytes to R2
    if client.put(&url).header("Content-Type", "image/webp").body(shot.bytes.clone()).send().map(|r| r.status().is_success()).unwrap_or(false) {
        // 3) confirm
        return client
            .post(format!("{backend}/screenshots/confirm"))
            .bearer_auth(token)
            .json(&serde_json::json!({
                "sessionId": session_id, "sequenceNo": seq, "r2Key": key,
                "monitorIndex": shot.monitor_index, "takenAt": taken, "blurred": blur
            }))
            .send()
            .map(|r| r.status().is_success())
            .unwrap_or(false);
    }
    false
}

// ---- offline queue (JSON block + .webp shot files under queue_dir) ----

fn queue_dir() -> Option<PathBuf> {
    CAPTURE.lock().ok().and_then(|g| g.as_ref().map(|c| c.queue_dir.clone()))
}

fn enqueue_block(session_id: &str, block: &BlockPayload, shots: &[PendingShot], blur: bool, seq: u32) {
    let Some(dir) = queue_dir() else { return };
    let stamp = format!("{}-{}", session_id, seq);
    let block_json = serde_json::json!({ "sessionId": session_id, "block": block, "blur": blur, "seq": seq });
    if let Ok(mut f) = fs::File::create(dir.join(format!("block-{stamp}.json"))) {
        let _ = f.write_all(block_json.to_string().as_bytes());
    }
    for (i, shot) in shots.iter().enumerate() {
        let name = format!("shot-{stamp}-{i}-m{}-{}.webp", shot.monitor_index, shot.taken_at.timestamp_millis());
        let _ = fs::write(dir.join(name), &shot.bytes);
    }
}

fn flush_queue(backend: &str, token: &str) {
    let Some(dir) = queue_dir() else { return };
    let Ok(entries) = fs::read_dir(&dir) else { return };
    let mut blocks: Vec<PathBuf> = entries
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.file_name().map(|n| n.to_string_lossy().starts_with("block-")).unwrap_or(false))
        .collect();
    blocks.sort();
    for path in blocks {
        let Ok(text) = fs::read_to_string(&path) else { continue };
        let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) else { continue };
        let session_id = v.get("sessionId").and_then(|x| x.as_str()).unwrap_or("");
        let block = &v["block"];
        let client = reqwest::blocking::Client::new();
        let body = serde_json::json!({ "sessionId": session_id, "blocks": [block] });
        let ok = client.post(format!("{backend}/sync/activity")).bearer_auth(token).json(&body).send().map(|r| r.status().is_success()).unwrap_or(false);
        if ok {
            let _ = fs::remove_file(&path);
            // (queued shot files are best-effort; removed with their block)
        } else {
            break; // still offline; try again later
        }
    }
}

fn hex(bytes: &[u8]) -> String {
    let mut s = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        s.push_str(&format!("{:02x}", b));
    }
    s
}

/// Spawn the rdev input listener + the 1-second worker loop. Call once at startup.
pub fn spawn_workers(app: AppHandle) {
    if let Ok(mut guard) = APP_HANDLE.lock() {
        *guard = Some(app);
    }
    // input listener
    std::thread::spawn(|| {
        let _ = rdev::listen(|event| match event.event_type {
            rdev::EventType::KeyPress(_) | rdev::EventType::KeyRelease(_) => on_input(true),
            rdev::EventType::ButtonPress(_)
            | rdev::EventType::ButtonRelease(_)
            | rdev::EventType::MouseMove { .. }
            | rdev::EventType::Wheel { .. } => on_input(false),
        });
    });
    // worker loop
    std::thread::spawn(|| loop {
        std::thread::sleep(Duration::from_secs(1));
        tick();
    });
}

// ---- Tauri commands ----

#[tauri::command]
pub fn begin_capture(
    app: tauri::AppHandle,
    token: String,
    backend: String,
    session_id: String,
    screenshots_per_block: u32,
    blur: bool,
    idle_minutes: i64,
) -> Result<(), String> {
    use tauri::Manager;
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?.join("queue");
    begin(token, backend, session_id, screenshots_per_block, blur, idle_minutes, dir);
    Ok(())
}

#[tauri::command]
pub fn end_capture() {
    end();
}

// silence unused warning for iso_now helper on some targets
#[allow(dead_code)]
fn _keep() {
    let _ = iso_now();
}
