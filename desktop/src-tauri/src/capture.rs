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

use crate::clock::ClockSample;
use crate::sync;
#[cfg(windows)]
use crate::url_capture;

const GENESIS: &str = "GENESIS";
// Never shoot in the first few seconds (window still settling after start).
const SHOT_MIN_OFFSET_SECS: i64 = 10;
// The first screenshot of every block lands by this offset, so tracking always
// produces visible evidence quickly rather than up to 10 minutes later.
const FIRST_SHOT_BY_SECS: i64 = 60;
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
// Whether the last screenshot attempt produced any image (see trax:capture-health).
static SHOTS_OK: AtomicBool = AtomicBool::new(true);
static CAPTURE: Lazy<Mutex<Option<Capture>>> = Lazy::new(|| Mutex::new(None));
static APP_HANDLE: Lazy<Mutex<Option<AppHandle>>> = Lazy::new(|| Mutex::new(None));
// Reused across blocks so the jiggler scan doesn't rebuild the process table each time.
static SYS: Lazy<Mutex<sysinfo::System>> = Lazy::new(|| Mutex::new(sysinfo::System::new()));

// Only consulted by the Windows URL sampler; there is no Linux equivalent yet.
#[cfg(windows)]
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
    // Tamper-resistant clock samples. `session_clock` is taken once at session
    // start, `block_clock` at each block boundary. Credited duration comes from
    // these — never from Utc::now() arithmetic, which the user controls.
    session_clock: ClockSample,
    block_clock: ClockSample,
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
            session_clock: ClockSample::now(),
            block_clock: ClockSample::now(),
        };
        c.plan_shots();
        c
    }

    /// Plan this block's screenshot offsets: one per evenly-sized window, at a
    /// random second within each window. Stratifying keeps shots unpredictable
    /// (anti-gaming) while guaranteeing coverage — and the first window is
    /// clamped to FIRST_SHOT_BY_SECS so a shot always lands early instead of a
    /// uniform-random draw over the whole 10 minutes (which meant a short
    /// session usually captured nothing at all).
    fn plan_shots(&mut self) {
        self.shot_offsets.clear();
        self.shots_taken.clear();
        if self.screenshots_per_block == 0 {
            return;
        }
        let mut rng = rand::thread_rng();
        let n = self.screenshots_per_block as i64;
        let block = self.block_secs.max(6);
        let window = (block / n).max(1);
        let mut offs = Vec::new();
        for i in 0..n {
            let lo = i * window;
            let hi = if i == n - 1 { block } else { (i + 1) * window };
            // First window: force an early shot so the user sees one quickly.
            let (lo, hi) = if i == 0 {
                (SHOT_MIN_OFFSET_SECS.min(block - 1), FIRST_SHOT_BY_SECS.min(block).max(SHOT_MIN_OFFSET_SECS + 1))
            } else {
                (lo.max(SHOT_MIN_OFFSET_SECS), hi.max(lo + 1))
            };
            offs.push(if hi > lo { rng.gen_range(lo..hi) } else { lo });
        }
        offs.sort_unstable();
        offs.dedup();
        self.shot_offsets = offs;
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
    // Recover from a poisoned mutex (a panic while a previous block finalized)
    // instead of leaving CAPTURE empty — otherwise ACTIVE would be true with no
    // state behind it and the timer would report 0 forever.
    let stored = match CAPTURE.lock() {
        Ok(mut guard) => {
            *guard = Some(Capture::new(
                token, backend, session_id, screenshots_per_block, blur,
                idle_minutes.clamp(1, 60) * 60, queue_dir, block_secs,
                base_elapsed_secs.max(0),
            ));
            true
        }
        Err(poisoned) => {
            let mut guard = poisoned.into_inner();
            *guard = Some(Capture::new(
                token, backend, session_id, screenshots_per_block, blur,
                idle_minutes.clamp(1, 60) * 60, queue_dir, block_secs,
                base_elapsed_secs.max(0),
            ));
            CAPTURE.clear_poison();
            true
        }
    };
    // Only advertise "capturing" once the state actually exists.
    ACTIVE.store(stored, Ordering::Relaxed);
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
/// wall-clock changes and webview throttling). `None` when there is no live
/// capture state, so callers can distinguish "no session" from "zero seconds".
fn live_elapsed_secs() -> Option<i64> {
    CAPTURE
        .lock()
        .ok()
        .and_then(|g| g.as_ref().map(|c| c.base_elapsed_secs + c.anchor.elapsed().as_secs() as i64))
}

/// Same, but 0 when there's no session (for the `get_elapsed` command).
fn elapsed_secs() -> i64 {
    live_elapsed_secs().unwrap_or(0)
}

/// OS-reported idle seconds, independent of the rdev hook so idle detection
/// survives a dead input listener. Windows uses GetLastInputInfo; Linux queries
/// the screensaver / Mutter idle monitor. `None` means "no opinion" — callers
/// must not read it as "not idle".
fn os_idle_secs() -> Option<i64> {
    crate::os_idle::idle_seconds()
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
    // Only emit when a live Capture exists — otherwise elapsed_secs() returns 0
    // (missing/poisoned state) and the UI would be pinned to 00:00:00 forever.
    if let Some(secs) = live_elapsed_secs() {
        emit("trax:tick", serde_json::json!({ "elapsedSecs": secs }));
    }

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
        // Screen capture can fail silently (no monitors, denied permission,
        // Wayland without a portal). Surface transitions so the UI can warn.
        let ok = !shots.is_empty();
        if ok != SHOTS_OK.swap(ok, Ordering::Relaxed) {
            emit("trax:capture-health", serde_json::json!({ "screenshots": ok }));
        }
        let mut announced: Vec<serde_json::Value> = Vec::new();
        if let Ok(mut guard) = CAPTURE.lock() {
            if let Some(c) = guard.as_mut() {
                let dir = shots_dir(&c.queue_dir);
                let _ = fs::create_dir_all(&dir);
                for (idx, bytes) in shots {
                    let taken = Utc::now();
                    // Persist immediately: the shot then survives a crash and can be
                    // shown locally right away, instead of sitting in RAM until the
                    // block finalizes (up to 10 min) and the upload succeeds.
                    let name = format!("{}-{}-m{}.webp", c.session_id, taken.timestamp_millis(), idx);
                    let path = dir.join(&name);
                    if fs::write(&path, &bytes).is_ok() {
                        announced.push(serde_json::json!({
                            "path": path.to_string_lossy(),
                            "takenAt": taken.to_rfc3339_opts(SecondsFormat::Millis, true),
                            "monitorIndex": idx,
                        }));
                    }
                    c.pending_shots.push(PendingShot { monitor_index: idx, taken_at: taken, bytes });
                }
            }
        }
        // Emit after releasing the lock.
        for p in announced {
            emit("trax:shot-captured", p);
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
    // --- tamper-resistant timing (not part of the hash-chain contract) ---
    /// Seconds of awake time this block actually covered, from the monotonic
    /// clock. The server credits this, not blockEnd - blockStart.
    #[serde(rename = "creditedSeconds")]
    credited_seconds: u64,
    /// Seconds the machine spent suspended during this block. Never credited.
    #[serde(rename = "suspendedSeconds")]
    suspended_seconds: u64,
    /// How far the wall clock drifted relative to the monotonic clock during
    /// this block. Non-zero means the system clock was changed.
    #[serde(rename = "clockSkewSeconds")]
    clock_skew_seconds: i64,
}

fn round2(v: f64) -> f64 {
    (v * 100.0).round() / 100.0
}

/// Finalize the current block: compute activity %, build the hash-chained payload,
/// sync it, upload its screenshots. Then advance the chain (unless stopping).
fn finalize_block(stopping: bool) {
    // Scan for a mouse-jiggler BEFORE taking the CAPTURE lock — it refreshes the
    // whole process table (tens of ms) and holding CAPTURE that long starves
    // on_input() (which locks CAPTURE on every mouse move); on Windows a slow
    // low-level input hook gets silently uninstalled, wedging activity at 0%.
    let jiggler = detect_jiggler();

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
        // Block duration comes from the monotonic clock, NOT from
        // `end - c.block_start`. A wall-clock subtraction can be inflated by
        // moving the clock forward, or driven negative by moving it back —
        // which then clamped to 1 and produced a perfect 100.00% activity block.
        let clock_now = ClockSample::now();
        let delta = clock_now.since(&c.block_clock);
        // Fall back to the wall-clock span only if the monotonic delta is
        // implausibly small (first sample in a block, or a counter glitch).
        let block_secs = (delta.credited_secs() as i64)
            .max((end - c.block_start).num_seconds())
            .max(1);
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
            credited_seconds: delta.credited_secs(),
            suspended_seconds: delta.suspended_secs(),
            clock_skew_seconds: delta.clock_skew_secs(),
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
            // Re-anchor the monotonic sample too, so the next block measures
            // from here rather than from session start.
            c.block_clock = clock_now;
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
        if stopping {
            // Clear any backoff so the loop uploads this final block promptly.
            sync::wake();
        } else {
            sync::note_attempt_result(false, Some("offline".into()));
        }
    }
}

// ---- offline queue (JSON block + .webp shot files under queue_dir) ----

fn queue_dir() -> Option<PathBuf> {
    CAPTURE.lock().ok().and_then(|g| g.as_ref().map(|c| c.queue_dir.clone()))
}

/// Directory where freshly-captured screenshots are written for instant local
/// viewing (a sibling of the sync queue, under app_data_dir).
fn shots_dir(queue_dir: &std::path::Path) -> PathBuf {
    queue_dir.parent().map(|p| p.join("shots")).unwrap_or_else(|| queue_dir.join("shots"))
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

/// Stop tracking. `end()` finalizes the last block (process scan + multi-MB
/// screenshot writes), so run it off the UI thread — a plain sync command would
/// freeze the window on every stop/switch.
#[tauri::command]
pub async fn end_capture() {
    let _ = tauri::async_runtime::spawn_blocking(end).await;
}

/// Seconds elapsed in the running session (monotonic). The UI polls this on
/// focus/visibility to correct a webview timer that was throttled while hidden.
#[tauri::command]
pub fn get_elapsed() -> i64 {
    elapsed_secs()
}

/// The most recent screenshots captured on this device, newest first, as inline
/// `data:` URLs so the in-app gallery shows them with no server round trip and
/// no extra CSP/asset-protocol setup. Returns [{ takenAt, monitorIndex, dataUrl }].
#[tauri::command]
pub fn local_shots(app: tauri::AppHandle) -> Vec<serde_json::Value> {
    use base64::Engine;
    use tauri::Manager;
    let Ok(base) = app.path().app_data_dir() else { return Vec::new() };
    let dir = shots_dir(&base.join("queue"));
    let Ok(entries) = fs::read_dir(&dir) else { return Vec::new() };
    // Collect metadata first (cheap), sort newest-first, then read + encode a cap.
    let mut metas: Vec<(i64, u32, PathBuf)> = entries
        .flatten()
        .filter_map(|e| {
            let path = e.path();
            let name = path.file_name()?.to_string_lossy().into_owned();
            let stem = name.strip_suffix(".webp")?;
            // name = "{sessionId}-{takenMs}-m{idx}"
            let mono = stem.rsplit('-').next()?; // mN
            let taken_ms: i64 = stem.rsplitn(2, '-').last()?.rsplit('-').next()?.parse().ok()?;
            let idx: u32 = mono.trim_start_matches('m').parse().ok()?;
            Some((taken_ms, idx, path))
        })
        .collect();
    metas.sort_by(|a, b| b.0.cmp(&a.0));

    // Upload state per shot. A queued block manifest still on disk means its
    // shots haven't been accepted by the server yet; the manifest is deleted
    // only after a fully successful flush. Shots held in the current unfinalized
    // block live in RAM and aren't queued yet, so they count as pending too.
    let queue = base.join("queue");
    let pending = pending_shot_index(&queue);
    let in_flight = crate::sync::uploading_block();

    metas
        .into_iter()
        .take(24)
        .filter_map(|(taken_ms, idx, path)| {
            let bytes = fs::read(&path).ok()?;
            let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
            let taken = DateTime::from_timestamp_millis(taken_ms).unwrap_or_else(Utc::now);
            let key = (taken_ms, idx);
            let status = match pending.get(&key) {
                Some(owner) => match &in_flight {
                    Some(cur) if cur == owner => "uploading",
                    _ => "pending",
                },
                None if is_unqueued_local(taken_ms, idx) => "pending",
                None => "uploaded",
            };
            Some(serde_json::json!({
                "takenAt": taken.to_rfc3339_opts(SecondsFormat::Millis, true),
                "monitorIndex": idx,
                "dataUrl": format!("data:image/webp;base64,{b64}"),
                "status": status,
            }))
        })
        .collect()
}

/// Map `(takenAtMs, monitorIndex)` → owning `(sessionId, seq)` for every shot
/// still referenced by a queued block manifest, i.e. not yet uploaded.
fn pending_shot_index(queue: &std::path::Path) -> HashMap<(i64, u32), (String, u32)> {
    let mut out = HashMap::new();
    let Ok(entries) = fs::read_dir(queue) else { return out };
    for e in entries.flatten() {
        let name = e.file_name().to_string_lossy().to_string();
        if !(name.starts_with("block-") && name.ends_with(".json")) {
            continue;
        }
        let Ok(text) = fs::read_to_string(e.path()) else { continue };
        let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) else { continue };
        let session_id = v.get("sessionId").and_then(|x| x.as_str()).unwrap_or("").to_string();
        let seq = v.get("seq").and_then(|x| x.as_u64()).unwrap_or(0) as u32;
        let Some(shots) = v.get("shots").and_then(|x| x.as_array()) else { continue };
        for s in shots {
            let monitor = s.get("monitorIndex").and_then(|x| x.as_u64()).unwrap_or(0) as u32;
            let Some(taken) = s.get("takenAt").and_then(|x| x.as_str()) else { continue };
            // The queue file itself must still exist — a partially-flushed block
            // can have some shots uploaded and removed while the manifest remains.
            let file = s.get("file").and_then(|x| x.as_str()).unwrap_or("");
            if file.is_empty() || !queue.join(file).exists() {
                continue;
            }
            if let Ok(dt) = DateTime::parse_from_rfc3339(taken) {
                out.insert((dt.timestamp_millis(), monitor), (session_id.clone(), seq));
            }
        }
    }
    out
}

/// True when this shot belongs to the live, not-yet-finalized block — captured
/// and saved locally, but not queued for upload yet.
fn is_unqueued_local(taken_ms: i64, idx: u32) -> bool {
    CAPTURE
        .lock()
        .ok()
        .and_then(|g| {
            g.as_ref().map(|c| {
                c.pending_shots
                    .iter()
                    .any(|p| p.monitor_index == idx && p.taken_at.timestamp_millis() == taken_ms)
            })
        })
        .unwrap_or(false)
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
