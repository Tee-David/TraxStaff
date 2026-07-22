// Native capture core: samples keyboard/mouse *intensity* (never content),
// computes per-10-min activity %, captures all-monitor WebP screenshots at the
// admin-set frequency, and syncs a tamper-evident hash-chain to the backend.
// Records that can't be sent immediately go to the on-disk queue (see sync.rs),
// which retries with backoff. Elapsed time is anchored to a monotonic clock so
// sleep/suspend and a throttled webview can't distort the running timer.
//
// Verified via the Windows CI build (this Linux sandbox can't build the GUI).

use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicI64, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use chrono::{DateTime, SecondsFormat, Utc};
use once_cell::sync::Lazy;
use rand::Rng;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter};

use crate::sync;
#[cfg(windows)]
use crate::url_capture;

const GENESIS: &str = "GENESIS";
// A wall-clock jump larger than this between 1 Hz ticks means the machine slept.
const SUSPEND_GAP_SECS: i64 = 120;
// A second counts toward app/URL attribution only if input landed this recently.
const ACTIVE_WINDOW_SECS: i64 = 2;
const JIGGLER_BLOCKLIST: &[&str] = &[
    "mousejiggler", "movemouse", "move mouse", "caffeine", "autoclicker",
    "auto clicker", "mousemover", "jiggler", "wiggler", "clickermann", "pressplay",
];

static ACTIVE: AtomicBool = AtomicBool::new(false);
static LAST_INPUT: AtomicI64 = AtomicI64::new(0);
static IDLE_NOTIFIED: AtomicBool = AtomicBool::new(false);
static LAST_TICK_WALL: AtomicI64 = AtomicI64::new(0);
// Whether the rdev input hook is delivering events. Starts true; the supervisor
// flips it false if the listener dies so the UI can warn that activity % is 0.
static INPUT_HOOK_OK: AtomicBool = AtomicBool::new(true);
static CAPTURE: Lazy<Mutex<Option<Capture>>> = Lazy::new(|| Mutex::new(None));
static APP_HANDLE: Lazy<Mutex<Option<AppHandle>>> = Lazy::new(|| Mutex::new(None));
// Reused across blocks so the jiggler scan doesn't rebuild the process table each time.
static SYS: Lazy<Mutex<sysinfo::System>> = Lazy::new(|| Mutex::new(sysinfo::System::new()));

const BROWSERS: &[&str] = &["chrome", "msedge", "firefox", "brave", "opera", "chromium", "vivaldi"];

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
    url_secs: HashMap<String, i64>,
    idle_threshold: i64,
    queue_dir: PathBuf,
    // Monotonic anchor for elapsed time; base is prior server-side elapsed
    // (non-zero when resuming an already-open session).
    anchor: Instant,
    base_elapsed_secs: i64,
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
        base_elapsed_secs: i64,
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
            url_secs: HashMap::new(),
            idle_threshold,
            queue_dir,
            anchor: Instant::now(),
            base_elapsed_secs,
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

fn emit<S: serde::Serialize + Clone>(event: &str, payload: S) {
    if let Ok(guard) = APP_HANDLE.lock() {
        if let Some(app) = guard.as_ref() {
            let _ = app.emit(event, payload);
        }
    }
}

/// Record an input event into the current block's per-second active buckets.
pub fn on_input(is_keyboard: bool) {
    // First event confirms the hook is alive.
    if !INPUT_HOOK_OK.swap(true, Ordering::Relaxed) {
        emit("trax:capture-health", serde_json::json!({ "inputHook": true }));
    }
    if !ACTIVE.load(Ordering::Relaxed) {
        return;
    }
    let sec = Utc::now().timestamp();
    let prev = LAST_INPUT.swap(sec, Ordering::Relaxed);
    // Returning from an idle stretch we already notified about → offer the
    // keep/discard prompt for the gap (from last input to now).
    if IDLE_NOTIFIED.swap(false, Ordering::Relaxed) && prev > 0 {
        emit(
            "trax:idle-ended",
            serde_json::json!({
                "minutes": (sec - prev) / 60,
                "fromISO": iso_ts(prev),
                "toISO": iso_ts(sec),
            }),
        );
    }
    if let Ok(mut guard) = CAPTURE.lock() {
        if let Some(c) = guard.as_mut() {
            if is_keyboard {
                c.kb_secs.insert(sec);
            } else {
                c.mouse_secs.insert(sec);
            }
        }
    }
}

/// A unix-seconds timestamp as an ISO-8601 string (UTC, matching JS toISOString).
fn iso_ts(secs: i64) -> String {
    DateTime::from_timestamp(secs, 0)
        .unwrap_or_else(Utc::now)
        .to_rfc3339_opts(SecondsFormat::Millis, true)
}

/// Start capturing for a session. `base_elapsed_secs` seeds the timer when
/// resuming a session the server says already started earlier.
#[allow(clippy::too_many_arguments)]
pub fn begin(
    token: String,
    backend: String,
    session_id: String,
    screenshots_per_block: u32,
    blur: bool,
    idle_minutes: i64,
    queue_dir: PathBuf,
    base_elapsed_secs: i64,
) {
    let block_secs = std::env::var("TRAX_BLOCK_SECS")
        .ok()
        .and_then(|v| v.parse::<i64>().ok())
        .unwrap_or(600)
        .clamp(30, 3600);
    let _ = fs::create_dir_all(&queue_dir);
    let now = Utc::now().timestamp();
    LAST_INPUT.store(now, Ordering::Relaxed);
    LAST_TICK_WALL.store(now, Ordering::Relaxed);
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
            base_elapsed_secs.max(0),
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

/// Seconds elapsed in the running session, from the monotonic anchor (immune to
/// wall-clock changes and webview throttling). 0 when no session is active.
fn elapsed_secs() -> i64 {
    CAPTURE
        .lock()
        .ok()
        .and_then(|g| g.as_ref().map(|c| c.base_elapsed_secs + c.anchor.elapsed().as_secs() as i64))
        .unwrap_or(0)
}

/// OS-reported idle seconds (Windows), independent of the rdev hook so idle
/// detection survives a dead input listener. `None` on other platforms.
fn os_idle_secs() -> Option<i64> {
    #[cfg(windows)]
    {
        crate::os_idle::idle_seconds()
    }
    #[cfg(not(windows))]
    {
        None
    }
}

/// Background worker: called ~every second. Handles screenshot timing, block
/// boundaries, the running-timer tick, idle detection, and suspend recovery.
pub fn tick() {
    if !ACTIVE.load(Ordering::Relaxed) {
        return;
    }
    let now_ts = Utc::now().timestamp();

    // Suspend/resume: a big wall-clock jump between ticks means the machine
    // slept. Close the current block (the gap is naturally idle) and tell the UI.
    let prev_tick = LAST_TICK_WALL.swap(now_ts, Ordering::Relaxed);
    if prev_tick > 0 && now_ts - prev_tick > SUSPEND_GAP_SECS {
        let gap = now_ts - prev_tick;
        emit("trax:resumed", serde_json::json!({ "gapSecs": gap }));
        finalize_block(false);
    }

    // Drive the running timer from the monotonic clock (survives minimize/sleep).
    emit("trax:tick", serde_json::json!({ "elapsedSecs": elapsed_secs() }));

    // A second counts toward app/URL only if the user was active in it.
    let rdev_idle = now_ts - LAST_INPUT.load(Ordering::Relaxed);
    let active_now = rdev_idle <= ACTIVE_WINDOW_SECS;

    // Sample the foreground app (outside the lock; it can be slow).
    let active_app = if active_now {
        active_win_pos_rs::get_active_window().ok().map(|w| {
            let mut name = w.app_name;
            if name.trim().is_empty() {
                name = w.title;
            }
            name.trim().to_string()
        })
    } else {
        None
    };
    // If the active app is a browser, sample its domain via UI Automation.
    let active_domain = active_app.as_deref().and_then(browser_domain);

    // Idle detection: use whichever clock reports the *smaller* idle so a dead
    // rdev hook can't keep the user "active" forever.
    let idle_threshold = CAPTURE.lock().ok().and_then(|g| g.as_ref().map(|c| c.idle_threshold)).unwrap_or(300);
    let idle_for = match os_idle_secs() {
        Some(os) => rdev_idle.min(os),
        None => rdev_idle,
    };
    if idle_for >= idle_threshold && !IDLE_NOTIFIED.swap(true, Ordering::Relaxed) {
        emit("trax:idle", serde_json::json!({ "minutes": idle_for / 60 }));
    }

    // Determine due screenshots + whether the block is complete (under lock, briefly).
    let (due, complete) = {
        let mut guard = match CAPTURE.lock() {
            Ok(g) => g,
            Err(_) => return,
        };
        let c = match guard.as_mut() {
            Some(c) => c,
            None => return,
        };
        if let Some(app) = active_app.as_ref().filter(|a| !a.is_empty()) {
            *c.app_secs.entry(app.clone()).or_insert(0) += 1;
        }
        if let Some(dom) = active_domain.as_ref().filter(|d| !d.is_empty()) {
            *c.url_secs.entry(dom.clone()).or_insert(0) += 1;
        }
        let elapsed = (Utc::now() - c.block_start).num_seconds();
        let mut due = Vec::new();
        for &off in &c.shot_offsets {
            if elapsed >= off && !c.shots_taken.contains(&off) {
                c.shots_taken.insert(off);
                due.push(off);
            }
        }
        (due, elapsed >= c.block_secs)
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

    if complete {
        finalize_block(false);
    }
}

#[cfg(windows)]
fn browser_domain(app_name: &str) -> Option<String> {
    let lower = app_name.to_lowercase();
    if BROWSERS.iter().any(|b| lower.contains(b)) {
        url_capture::foreground_domain()
    } else {
        None
    }
}

#[cfg(not(windows))]
fn browser_domain(_app_name: &str) -> Option<String> {
    None
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
    let mut sys = SYS.lock().ok()?;
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

#[derive(serde::Serialize, Clone)]
pub struct BlockPayload {
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
    // Build payload + drain shots/usage under the lock.
    let (payload, session_id, backend, token, blur, seq, shots, app_usage, url_usage, block_start_iso) = {
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
        let url_usage: Vec<(String, i64)> = c.url_secs.drain().collect();
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
        (payload, sid, backend, token, blur, seq, shots, app_usage, url_usage, block_start_iso)
    };

    // Network I/O outside the lock. On STOP we never touch the network — enqueue
    // locally and let the background sync loop drain it, so stopping is instant
    // and works fully offline. Mid-session block boundaries (worker thread) still
    // sync inline since they don't block the UI.
    let synced = if stopping {
        false
    } else {
        sync::sync_block(&backend, &token, &session_id, &payload)
    };
    if synced {
        for shot in &shots {
            let taken = shot.taken_at.to_rfc3339_opts(SecondsFormat::Millis, true);
            sync::upload_shot(&backend, &token, &session_id, seq, shot.monitor_index, &taken, &shot.bytes, blur);
        }
        if !app_usage.is_empty() {
            sync::sync_app_usage(&backend, &token, &session_id, &block_start_iso, &app_usage);
        }
        if !url_usage.is_empty() {
            sync::sync_url_usage(&backend, &token, &session_id, &block_start_iso, &url_usage);
        }
        sync::note_attempt_result(true, None);
        if let Some(dir) = sync::queue_dir_for_current() {
            let _ = sync::flush_queue_dir(&dir, &backend, &token, 20);
        }
    } else {
        enqueue_block(&session_id, &payload, &shots, blur, seq, &app_usage, &url_usage);
        if !stopping {
            sync::note_attempt_result(false, Some("offline".into()));
        }
    }
}

// ---- offline queue (JSON block + .webp shot files under queue_dir) ----

fn queue_dir() -> Option<PathBuf> {
    CAPTURE.lock().ok().and_then(|g| g.as_ref().map(|c| c.queue_dir.clone()))
}

/// Write a block that couldn't sync to disk: one JSON manifest naming its shot
/// files + embedded app/URL usage, plus the shot bytes. sync::flush_queue_dir
/// reads this exact shape.
fn enqueue_block(
    session_id: &str,
    block: &BlockPayload,
    shots: &[PendingShot],
    blur: bool,
    seq: u32,
    app_usage: &[(String, i64)],
    url_usage: &[(String, i64)],
) {
    let Some(dir) = queue_dir() else { return };
    let stamp = format!("{session_id}-{seq}");
    let mut shot_meta = Vec::new();
    for (i, shot) in shots.iter().enumerate() {
        let file = format!("shot-{stamp}-{i}.webp");
        if fs::write(dir.join(&file), &shot.bytes).is_ok() {
            shot_meta.push(serde_json::json!({
                "file": file,
                "monitorIndex": shot.monitor_index,
                "takenAt": shot.taken_at.to_rfc3339_opts(SecondsFormat::Millis, true),
            }));
        }
    }
    let app_json: Vec<_> = app_usage.iter().map(|(n, s)| serde_json::json!({ "appName": n, "seconds": s })).collect();
    let url_json: Vec<_> = url_usage.iter().map(|(d, s)| serde_json::json!({ "domain": d, "seconds": s })).collect();
    let manifest = serde_json::json!({
        "sessionId": session_id,
        "seq": seq,
        "blur": blur,
        "block": block,
        "shots": shot_meta,
        "appUsage": app_json,
        "urlUsage": url_json,
    });
    let _ = fs::write(dir.join(format!("block-{stamp}.json")), manifest.to_string().as_bytes());
    sync::emit_state();
}

fn hex(bytes: &[u8]) -> String {
    let mut s = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        s.push_str(&format!("{b:02x}"));
    }
    s
}

/// Spawn the rdev input listener + the 1-second worker loop. Call once at startup.
pub fn spawn_workers(app: AppHandle) {
    if let Ok(mut guard) = APP_HANDLE.lock() {
        *guard = Some(app);
    }
    // Input listener, supervised: if rdev::listen returns or panics the hook is
    // dead — flag it (UI warns activity % will read 0) and retry with backoff.
    std::thread::spawn(|| {
        let mut backoff = 1u64;
        loop {
            let res = std::panic::catch_unwind(|| {
                let _ = rdev::listen(|event| match event.event_type {
                    rdev::EventType::KeyPress(_) | rdev::EventType::KeyRelease(_) => on_input(true),
                    rdev::EventType::ButtonPress(_)
                    | rdev::EventType::ButtonRelease(_)
                    | rdev::EventType::MouseMove { .. }
                    | rdev::EventType::Wheel { .. } => on_input(false),
                });
            });
            // listen() only returns/panics on failure.
            if INPUT_HOOK_OK.swap(false, Ordering::Relaxed) {
                emit("trax:capture-health", serde_json::json!({ "inputHook": false }));
            }
            let _ = res;
            std::thread::sleep(Duration::from_secs(backoff));
            backoff = (backoff * 2).min(60);
        }
    });
    // worker loop — panic-guarded so a bad tick never kills tracking.
    std::thread::spawn(|| loop {
        std::thread::sleep(Duration::from_secs(1));
        let _ = std::panic::catch_unwind(tick);
    });
}

// ---- Tauri commands ----

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn begin_capture(
    app: tauri::AppHandle,
    token: String,
    backend: String,
    session_id: String,
    screenshots_per_block: u32,
    blur: bool,
    idle_minutes: i64,
    base_elapsed_secs: Option<i64>,
) -> Result<(), String> {
    use tauri::Manager;
    if !sync::backend_allowed(&backend) {
        return Err("backend not allowed".into());
    }
    if token.trim().is_empty() {
        return Err("missing token".into());
    }
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?.join("queue");
    begin(token, backend, session_id, screenshots_per_block, blur, idle_minutes, dir, base_elapsed_secs.unwrap_or(0));
    Ok(())
}

#[tauri::command]
pub fn end_capture() {
    end();
}

/// Seconds elapsed in the running session (monotonic). The UI polls this on
/// focus/visibility to correct a webview timer that was throttled while hidden.
#[tauri::command]
pub fn get_elapsed() -> i64 {
    elapsed_secs()
}

/// Whether the input hook is currently delivering events (activity sampling).
#[tauri::command]
pub fn capture_health() -> bool {
    INPUT_HOOK_OK.load(Ordering::Relaxed)
}

/// Whether a tracking session is currently live.
pub fn is_capturing() -> bool {
    ACTIVE.load(Ordering::Relaxed)
}
