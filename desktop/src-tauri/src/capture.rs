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
// ── Pause definition ────────────────────────────────────────────────────────
//
// How long a single input event keeps counting as work. An event at second `t`
// marks `[t, t + PAUSE_DEFINITION_SECS)` active, so a brief pause between
// keystrokes reads as working rather than as idle.
//
// 2.5s is the threshold Chang, Chen, Chen & Yu (Ergonomics, 2009; PMID
// 19562597) validated against video-record observation as the most accurate
// estimator of keyboard and mouse use time (r = 0.918-0.964). We bucket by
// whole seconds, so 3.
//
// This is deliberately NOT configurable, and must stay that way. An activity
// score an admin can turn up is a negotiated figure rather than evidence —
// worthless in exactly the dispute it exists to settle — and a threshold that
// moves week to week destroys period-over-period comparability. The number to
// expect from this is modest and known: Richter et al. (Applied Ergonomics,
// 2008; PMID 18177840), across 571 users and ~60,000 working days, measured a
// log-linear relationship in which doubling the pause definition raises
// measured work duration by ~3.5%.
//
// It cannot manufacture activity. The window only extends outward from real
// input events, so a member who was away produces no events and still scores
// zero at any value.
const PAUSE_DEFINITION_SECS: i64 = 3;
const JIGGLER_BLOCKLIST: &[&str] = &[
    "mousejiggler", "movemouse", "move mouse", "caffeine", "autoclicker",
    "auto clicker", "mousemover", "jiggler", "wiggler", "clickermann", "pressplay",
];

static ACTIVE: AtomicBool = AtomicBool::new(false);
static LAST_INPUT: AtomicI64 = AtomicI64::new(0);
static IDLE_NOTIFIED: AtomicBool = AtomicBool::new(false);
static LAST_TICK_WALL: AtomicI64 = AtomicI64::new(0);

// ── Away time ───────────────────────────────────────────────────────────────
//
// Seconds deducted from the running timer because the member wasn't there — an
// idle stretch past the org's threshold, or the machine asleep. Both mean the
// same thing and are accounted identically.
//
// Deducted the moment they return, BEFORE they answer the keep/discard prompt, so
// the clock shows the work they actually did rather than a total that quietly
// includes the hours they were away. "Keep" adds it back via `credit_away`.
//
// The clock keeping the away time and only removing it if asked was the wrong
// default: an unanswered prompt (auto-resolved to Keep after an hour) silently
// billed a lunch break or an overnight.
static AWAY_SECS: AtomicI64 = AtomicI64::new(0);
// High-water mark of away time already accounted for, as a unix timestamp.
//
// Two code paths detect the same absence — the suspend branch in `tick()` fires at
// wake, and `on_input` fires on the first keypress after it — so without a
// watermark a single nap would be deducted twice.
static AWAY_ACCOUNTED_TO: AtomicI64 = AtomicI64::new(0);

/// Deduct the part of [from, to] not already deducted. Returns the seconds newly
/// taken off the clock, or 0 if this span was already covered.
fn account_away(from_secs: i64, to_secs: i64) -> i64 {
    if to_secs <= from_secs {
        return 0;
    }
    let watermark = AWAY_ACCOUNTED_TO.load(Ordering::Relaxed);
    if to_secs <= watermark {
        return 0;
    }
    let start = from_secs.max(watermark);
    let secs = to_secs - start;
    if secs <= 0 {
        return 0;
    }
    AWAY_SECS.fetch_add(secs, Ordering::Relaxed);
    AWAY_ACCOUNTED_TO.store(to_secs, Ordering::Relaxed);
    secs
}

/// Put away seconds back on the clock — the member chose "Keep".
///
/// Clamped at zero: a duplicated Keep must not credit time that was never
/// deducted, which would turn the prompt into a way to inflate the timer.
pub fn credit_away(secs: i64) {
    if secs <= 0 {
        return;
    }
    let _ = AWAY_SECS.fetch_update(Ordering::Relaxed, Ordering::Relaxed, |cur| {
        Some((cur - secs).max(0))
    });
}
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
//
// Matched against `active_win_pos_rs`'s `app_name`, which on Windows is the
// executable's VERSIONINFO *FileDescription* ("Microsoft Edge", "Google
// Chrome"), NOT the process name — so the old "msedge" entry could never match
// and Edge was silently excluded from URL sampling. Entries must therefore be
// substrings of the display name; "edge" covers both forms.
#[cfg(windows)]
const BROWSERS: &[&str] = &["chrome", "edge", "firefox", "brave", "opera", "chromium", "vivaldi"];

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
        resumed: Option<ChainHead>,
    ) -> Self {
        // Resume the hash chain where this session left off, if it has run
        // before on this machine. See load_chain_head().
        let (seq, prev_hash) = match resumed {
            Some(h) => (h.seq, h.prev_hash),
            None => (0, GENESIS.to_string()),
        };
        let mut c = Capture {
            token,
            backend,
            session_id,
            screenshots_per_block,
            blur,
            block_secs,
            seq,
            prev_hash,
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
        // Take it off the clock first, then ask. The prompt carries the exact number
        // of seconds deducted so "Keep" can put back precisely that much — deriving
        // it again from the timestamps would drift if the two paths disagreed about
        // where the span started.
        let deducted = account_away(prev, sec);
        if deducted > 0 {
            emit(
                "trax:idle-ended",
                serde_json::json!({
                    "minutes": (sec - prev) / 60,
                    "fromISO": iso_ts(prev),
                    "toISO": iso_ts(sec),
                    "deductedSecs": deducted,
                }),
            );
        }
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
    // Pick the chain up where this session left off. A session outlives the
    // process — the app resumes its own still-open session by id after a crash,
    // a reboot or an auto-update — and restarting the chain at GENESIS makes the
    // server silently discard every block of the second run. See load_chain_head().
    let resumed = load_chain_head(&queue_dir, &session_id);
    if let Some(h) = &resumed {
        emit(
            "trax:chain-resumed",
            serde_json::json!({ "sessionId": session_id, "sequenceNo": h.seq }),
        );
    }
    let now = Utc::now().timestamp();
    LAST_INPUT.store(now, Ordering::Relaxed);
    LAST_TICK_WALL.store(now, Ordering::Relaxed);
    IDLE_NOTIFIED.store(false, Ordering::Relaxed);
    // Away accounting is per session. Carrying a previous session's deduction over
    // would take time off a timer that never had it.
    AWAY_SECS.store(0, Ordering::Relaxed);
    AWAY_ACCOUNTED_TO.store(now, Ordering::Relaxed);
    // Recover from a poisoned mutex (a panic while a previous block finalized)
    // instead of leaving CAPTURE empty — otherwise ACTIVE would be true with no
    // state behind it and the timer would report 0 forever.
    let stored = match CAPTURE.lock() {
        Ok(mut guard) => {
            *guard = Some(Capture::new(
                token, backend, session_id, screenshots_per_block, blur,
                idle_minutes.clamp(1, 60) * 60, queue_dir, block_secs,
                base_elapsed_secs.max(0), resumed,
            ));
            true
        }
        Err(poisoned) => {
            let mut guard = poisoned.into_inner();
            *guard = Some(Capture::new(
                token, backend, session_id, screenshots_per_block, blur,
                idle_minutes.clamp(1, 60) * 60, queue_dir, block_secs,
                base_elapsed_secs.max(0), resumed,
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
        // The session is over, so its chain state has nothing left to describe.
        // Cleared AFTER the final block is finalized and queued, so a crash
        // partway through still leaves a resumable head on disk.
        if let Some(c) = guard.as_ref() {
            clear_chain_head(&c.queue_dir, &c.session_id);
        }
        *guard = None;
    }
}

/// Seconds elapsed in the running session, from the monotonic anchor (immune to
/// wall-clock changes and webview throttling). `None` when there is no live
/// capture state, so callers can distinguish "no session" from "zero seconds".
fn live_elapsed_secs() -> Option<i64> {
    CAPTURE.lock().ok().and_then(|g| {
        g.as_ref().map(|c| {
            let raw = c.base_elapsed_secs + c.anchor.elapsed().as_secs() as i64;
            // Net of time the member was away. `anchor` is an Instant, which on
            // Windows keeps counting through sleep and hibernate (see clock.rs), so
            // the raw value bills an overnight suspend as worked time. Floored at 0
            // so an over-deduction can never run the clock backwards.
            (raw - AWAY_SECS.load(Ordering::Relaxed)).max(0)
        })
    })
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
    // Emit both trax:resumed (informational) and trax:idle-ended (actionable)
    // so the user gets the keep/discard prompt, just like with idle detection.
    let prev_tick = LAST_TICK_WALL.swap(now_ts, Ordering::Relaxed);
    if prev_tick > 0 && now_ts - prev_tick > SUSPEND_GAP_SECS {
        let gap = now_ts - prev_tick;
        // Informational: let the UI know the machine woke from sleep
        emit("trax:resumed", serde_json::json!({ "gapSecs": gap }));
        // Deduct the sleep before offering the prompt, exactly as for idle. The
        // monotonic anchor counts through suspend on Windows, so without this the
        // timer bills every hour the lid was shut. `account_away` also stops the
        // first keypress after wake deducting the same nap a second time.
        let deducted = account_away(prev_tick, now_ts);
        if deducted > 0 {
            // Actionable: offer the keep/discard prompt for the sleep gap.
            emit(
                "trax:idle-ended",
                serde_json::json!({
                    "minutes": gap / 60,
                    "fromISO": iso_ts(prev_tick),
                    "toISO": iso_ts(now_ts),
                    "deductedSecs": deducted,
                }),
            );
        }
        // The idle notification (if any) is consumed by this span — clearing it
        // stops on_input raising a second, overlapping prompt for the same absence.
        IDLE_NOTIFIED.store(false, Ordering::Relaxed);
        LAST_INPUT.store(now_ts, Ordering::Relaxed);
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
    /// The pause definition this block's `activityPct` was measured with, so
    /// every stored figure says how it was produced. Blocks written before this
    /// existed have no value and are read as the old per-second behaviour; a
    /// report spanning the cutover can therefore say so instead of silently
    /// comparing two different measurements.
    #[serde(rename = "pauseDefinitionSecs")]
    pause_definition_secs: i64,
}

fn round2(v: f64) -> f64 {
    (v * 100.0).round() / 100.0
}

// ── Chain continuity across a restart ───────────────────────────────────────
//
// The hash chain is per SESSION, but `Capture` is in-memory and `begin()` builds
// a fresh one every time. A session, meanwhile, outlives the process: the app
// finds its own still-open session on launch and resumes it with the same id
// (App.tsx re-invokes `begin_capture` with `open.id`), after a crash, a forced
// reboot, an auto-updater relaunch, or a "Stop & sync" whose POST failed.
//
// Restarting at `seq 0` / GENESIS then produced silent, total data loss. The
// server's `@@unique([sessionId, sequenceNo])` makes `createMany(skipDuplicates)`
// DROP the second run's blocks 0, 1, 2 — it replies 200 with the rows discarded,
// the client believes the sync succeeded and deletes its queue, and half an hour
// of work is gone with no error anywhere. Screenshots attach to the earlier
// block with the same sequence number, so the gallery shows them against an
// unrelated ten minutes.
//
// So the chain head is persisted beside the queue on every block boundary. A
// tiny file, written after the block it describes, read back by `begin()`.

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
struct ChainHead {
    seq: u32,
    prev_hash: String,
}

fn chain_head_path(queue_dir: &std::path::Path, session_id: &str) -> PathBuf {
    queue_dir.join(format!("chain-{session_id}.json"))
}

/// Where this session's chain had reached, if it has run before on this machine.
///
/// A missing or unreadable file means "no idea", which falls back to starting at
/// GENESIS — the old behaviour, and the only safe default for a genuinely new
/// session.
fn load_chain_head(queue_dir: &std::path::Path, session_id: &str) -> Option<ChainHead> {
    let text = fs::read_to_string(chain_head_path(queue_dir, session_id)).ok()?;
    let head: ChainHead = serde_json::from_str(&text).ok()?;
    if head.prev_hash.is_empty() {
        return None;
    }
    Some(head)
}

/// Record where the chain has reached. Best-effort: failing to write it costs
/// continuity across a restart, which is strictly better than failing the block.
fn save_chain_head(queue_dir: &std::path::Path, session_id: &str, seq: u32, prev_hash: &str) {
    let head = ChainHead { seq, prev_hash: prev_hash.to_string() };
    if let Ok(text) = serde_json::to_string(&head) {
        let _ = fs::write(chain_head_path(queue_dir, session_id), text);
    }
}

/// Drop a finished session's chain state. Called on stop, so the file does not
/// outlive the session it describes.
fn clear_chain_head(queue_dir: &std::path::Path, session_id: &str) {
    let _ = fs::remove_file(chain_head_path(queue_dir, session_id));
}

/// How many seconds of work one block actually covered — the denominator for
/// every percentage on it.
///
/// `credited` comes from the monotonic awake counter (see clock.rs): it excludes
/// time the machine spent suspended and cannot be moved by the wall clock. It is
/// the only figure worth trusting. The wall span is a fallback for the single
/// case the monotonic delta cannot describe — a block so short that integer
/// division floors `credited_secs()` to zero, or a counter glitch — and that
/// case is recognisable precisely because `credited` is zero.
///
/// This used to be `credited.max(wall_span).max(1)`, which always took the
/// LARGER of the two. Since `credited` excludes suspend and the wall span
/// includes it, the wall clock won exactly when the machine had slept: five
/// minutes of work followed by an overnight suspend produced a 68,700-second
/// denominator and reported 83% activity as 0.36%. The `.max()` handed the
/// decision to the clock the monotonic counter exists to distrust — and did the
/// same on any forward NTP step.
fn block_duration_secs(credited_secs: i64, wall_span_secs: i64) -> i64 {
    if credited_secs > 0 {
        credited_secs
    } else {
        wall_span_secs.max(1)
    }
}

/// The per-second counts behind one block's percentages.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
struct ActiveSeconds {
    /// Seconds containing a keyboard event. Raw — no pause definition applied.
    keyboard: i64,
    /// Seconds containing a mouse event. Raw — no pause definition applied.
    mouse: i64,
    /// Seconds counted as active once the pause definition is applied.
    active: i64,
}

/// Count the active seconds in a block, applying the pause definition.
///
/// `kb` and `mouse` hold the absolute unix-second of each second in which an
/// event of that kind arrived; they are cleared at every block boundary, so they
/// only ever describe the block being finalized.
///
/// Two deliberate properties:
///
/// - **Forward fill only.** An event at `t` credits `[t, t + pause_secs)` and
///   never a second before `t`. Crediting backwards would mean an event
///   retroactively proving the user was working before they touched anything.
/// - **Clipped to the block's wall-clock span.** Credit cannot leak past the end
///   of the block into the next one, nor before its start. The bound is the wall
///   span rather than `block_duration_secs`, because these sets are keyed on
///   wall-clock seconds — using the (shorter) credited duration as the bound
///   would silently discard real input recorded either side of a suspend.
///
/// `keyboard` and `mouse` come back RAW, without the pause definition. They are
/// the uncalibrated signal and the input to divergence-based jiggler detection
/// (mouse busy while keyboard is flat, and the converse), so smoothing them
/// would blunt the very check they exist for. Only `active` is smoothed.
fn count_active_seconds(
    kb: &HashSet<i64>,
    mouse: &HashSet<i64>,
    block_start_ts: i64,
    wall_end_ts: i64,
    pause_secs: i64,
) -> ActiveSeconds {
    let in_block = |s: i64| s >= block_start_ts && s <= wall_end_ts;
    let fill = pause_secs.max(1);

    let mut active: HashSet<i64> = HashSet::new();
    for &t in kb.iter().chain(mouse.iter()) {
        for s in t..t.saturating_add(fill) {
            if in_block(s) {
                active.insert(s);
            }
        }
    }

    ActiveSeconds {
        keyboard: kb.iter().filter(|&&s| in_block(s)).count() as i64,
        mouse: mouse.iter().filter(|&&s| in_block(s)).count() as i64,
        active: active.len() as i64,
    }
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
        let block_secs = block_duration_secs(
            delta.credited_secs() as i64,
            (end - c.block_start).num_seconds(),
        );
        let denom = block_secs as f64;
        // The pause definition is applied here, at finalization, rather than in
        // on_input(): keeping the raw event seconds intact means the underlying
        // signal survives and the expansion stays a single auditable step.
        let counts = count_active_seconds(
            &c.kb_secs,
            &c.mouse_secs,
            c.block_start.timestamp(),
            end.timestamp(),
            PAUSE_DEFINITION_SECS,
        );
        let kb_pct = round2((counts.keyboard as f64 / denom * 100.0).min(100.0));
        let mouse_pct = round2((counts.mouse as f64 / denom * 100.0).min(100.0));
        // Clamped because the fill can spill a second or two of credit across a
        // suspend boundary, where the wall span the fill is clipped to is longer
        // than the credited denominator.
        let act_pct = round2((counts.active as f64 / denom * 100.0).min(100.0));
        let idle = (block_secs - counts.active).max(0);

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
            pause_definition_secs: PAUSE_DEFINITION_SECS,
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
            // Persist the new head immediately. If the process dies before the
            // next boundary, `begin()` picks the chain up here instead of
            // restarting at GENESIS and having the server discard everything
            // that follows.
            save_chain_head(&c.queue_dir, &c.session_id, c.seq, &c.prev_hash);
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
    if !sync::backend_allowed(&backend) {
        return Err("backend not allowed".into());
    }
    if token.trim().is_empty() {
        return Err("missing token".into());
    }
    // Bind the queue to the account this token belongs to, so a block is only
    // ever flushed with credentials that can actually claim it. Set from the
    // capturing token itself (not just set_sync_auth's) so the dir being
    // written to always matches the dir the flush will target.
    crate::scope::set_from_token(&token);
    let dir = sync::queue_dir_for(&app).ok_or_else(|| "no queue dir for this account".to_string())?;
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

/// Seconds elapsed in the running session (monotonic, net of away time). The UI
/// polls this on focus/visibility to correct a webview timer that was throttled
/// while hidden.
#[tauri::command]
pub fn get_elapsed() -> i64 {
    elapsed_secs()
}

/// Put an away stretch back on the clock — the member answered "Keep".
///
/// `secs` is the `deductedSecs` from the `trax:idle-ended` payload, so the credit
/// is exactly what was taken off rather than a fresh guess from the timestamps.
#[tauri::command]
pub fn keep_away_time(secs: i64) {
    credit_away(secs);
}

/// The most recent screenshots captured on this device, newest first, as inline
/// `data:` URLs so the in-app gallery shows them with no server round trip and
/// no extra CSP/asset-protocol setup. Returns [{ takenAt, monitorIndex, dataUrl }].
#[tauri::command]
pub fn local_shots(app: tauri::AppHandle) -> Vec<serde_json::Value> {
    use base64::Engine;
    use tauri::Manager;
    let Ok(base) = app.path().app_data_dir() else { return Vec::new() };
    // Only ever the signed-in account's own shots. These used to come from a
    // single shared dir with no ownership check, so a new user's gallery showed
    // the previous user's screenshots.
    let Some(key) = crate::scope::current() else { return Vec::new() };
    let dir = crate::scope::shots_dir(&base, &key);
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
    let queue = crate::scope::queue_dir(&base, &key);
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

#[cfg(test)]
mod tests {
    use super::*;

    /// Block starting at an arbitrary fixed epoch second, so the tests read in
    /// block-relative offsets rather than absolute timestamps.
    const T0: i64 = 1_760_000_000;

    fn secs(offsets: impl IntoIterator<Item = i64>) -> HashSet<i64> {
        offsets.into_iter().map(|o| T0 + o).collect()
    }

    /// Percentage exactly as finalize_block computes it, so the tests exercise
    /// the same arithmetic rather than a paraphrase of it.
    fn pct(active: i64, block_secs: i64) -> f64 {
        round2((active as f64 / block_secs as f64 * 100.0).min(100.0))
    }

    // ── block_duration_secs: the suspend bug ────────────────────────────────

    #[test]
    fn suspend_does_not_enter_the_denominator() {
        // Five minutes of work, then the lid closes overnight and the block is
        // finalized on wake. Credited excludes the sleep; the wall span does not.
        let credited = 300;
        let wall_span = 68_700;
        assert_eq!(block_duration_secs(credited, wall_span), 300);

        // 250 of those 300 seconds had input. Before the fix this reported 0.36%.
        assert_eq!(pct(250, block_duration_secs(credited, wall_span)), 83.33);
    }

    #[test]
    fn forward_clock_step_does_not_deflate_activity() {
        // NTP corrects an hour forward mid-block. The monotonic counter is
        // unmoved, so the denominator must be too.
        assert_eq!(block_duration_secs(600, 4_200), 600);
    }

    #[test]
    fn backward_clock_step_cannot_produce_a_perfect_block() {
        // A negative wall span used to clamp to 1, making any input 100%.
        assert_eq!(block_duration_secs(600, -3_000), 600);
    }

    #[test]
    fn wall_span_is_used_only_when_credited_is_zero() {
        // Sub-second block: credited_secs() floors to 0, so the wall span is all
        // there is. Never below 1, or the percentage divides by zero.
        assert_eq!(block_duration_secs(0, 5), 5);
        assert_eq!(block_duration_secs(0, 0), 1);
        assert_eq!(block_duration_secs(0, -7), 1);
    }

    #[test]
    fn ordinary_block_is_unaffected() {
        // No suspend, no skew: the two clocks agree and the answer is unchanged.
        assert_eq!(block_duration_secs(600, 600), 600);
    }

    // ── count_active_seconds: the pause definition ──────────────────────────

    #[test]
    fn pause_of_one_reproduces_legacy_per_second_counting() {
        // The regression guard: with no fill, this must be exactly the old
        // `kb ∪ mouse` cardinality.
        let kb = secs([0, 1, 2, 50, 51]);
        let mouse = secs([2, 3, 90]);
        let c = count_active_seconds(&kb, &mouse, T0, T0 + 600, 1);
        assert_eq!(c.active, 7); // {0,1,2,3,50,51,90}
        assert_eq!(c.keyboard, 5);
        assert_eq!(c.mouse, 3);
    }

    #[test]
    fn empty_input_scores_zero_at_every_pause_definition() {
        // The load-bearing property of the whole design: the window only extends
        // outward from real events, so an absent member scores zero however wide
        // it is. If this ever fails, the metric has become fabrication.
        let empty = HashSet::new();
        for pause in 0..=10 {
            let c = count_active_seconds(&empty, &empty, T0, T0 + 600, pause);
            assert_eq!(c.active, 0, "pause={pause} invented activity from nothing");
        }
    }

    #[test]
    fn a_single_event_credits_exactly_the_pause_definition() {
        let kb = secs([10]);
        let empty = HashSet::new();
        let c = count_active_seconds(&kb, &empty, T0, T0 + 600, PAUSE_DEFINITION_SECS);
        assert_eq!(c.active, 3); // seconds 10, 11, 12
        assert_eq!(c.keyboard, 1, "the raw signal is not smoothed");
    }

    #[test]
    fn overlapping_fills_are_not_double_counted() {
        // Events one second apart must union, not sum.
        let kb = secs([10, 11, 12]);
        let empty = HashSet::new();
        let c = count_active_seconds(&kb, &empty, T0, T0 + 600, 3);
        assert_eq!(c.active, 5); // 10..=14, not 9
    }

    #[test]
    fn continuous_input_is_100_percent_at_every_pause_definition() {
        let kb: HashSet<i64> = secs(0..600);
        let empty = HashSet::new();
        for pause in 1..=5 {
            let c = count_active_seconds(&kb, &empty, T0, T0 + 599, pause);
            assert_eq!(pct(c.active, 600), 100.0, "pause={pause}");
        }
    }

    #[test]
    fn fill_never_credits_past_the_end_of_the_block() {
        // An event in the last second must not bleed into the next block.
        let kb = secs([599]);
        let empty = HashSet::new();
        let c = count_active_seconds(&kb, &empty, T0, T0 + 599, PAUSE_DEFINITION_SECS);
        assert_eq!(c.active, 1);
    }

    #[test]
    fn fill_never_credits_before_the_start_of_the_block() {
        // Forward-fill only. A stale second from before block_start (a clock step
        // during the block) contributes nothing rather than back-dating work.
        let kb = secs([-5]);
        let empty = HashSet::new();
        let c = count_active_seconds(&kb, &empty, T0, T0 + 600, PAUSE_DEFINITION_SECS);
        assert_eq!(c.active, 0);
        assert_eq!(c.keyboard, 0);
    }

    #[test]
    fn activity_can_never_exceed_one_hundred_percent() {
        // Input right up to a suspend boundary: the fill is clipped to the wall
        // span, which is longer than the credited denominator. The clamp holds.
        let kb: HashSet<i64> = secs(0..300);
        let empty = HashSet::new();
        let block_secs = block_duration_secs(300, 68_700);
        let c = count_active_seconds(&kb, &empty, T0, T0 + 68_700, PAUSE_DEFINITION_SECS);
        assert!(c.active >= block_secs);
        assert_eq!(pct(c.active, block_secs), 100.0);
    }

    #[test]
    fn keyboard_and_mouse_are_unioned_not_summed() {
        // The same second touched by both must count once.
        let kb = secs([0, 1, 2]);
        let mouse = secs([0, 1, 2]);
        let c = count_active_seconds(&kb, &mouse, T0, T0 + 600, 1);
        assert_eq!(c.active, 3);
        assert_eq!(c.keyboard, 3);
        assert_eq!(c.mouse, 3);
    }

    /// The composite case from the research: a realistic bursty 600-second block
    /// with 210 raw active seconds — typing, reading with periodic scrolls, a
    /// video call with occasional mouse movement, and some thinking.
    ///
    /// This is the number the whole change is justified by, so it is pinned:
    /// 210 of 600 seconds carry input, which reads as 35.0% under per-second
    /// counting and 57.5% once the pause definition is applied. The bands below
    /// are deliberately wider than those two figures — the point is the shape of
    /// the change, not a fragile equality — but if either escapes its band the
    /// fill is leaking across a boundary or has stopped applying at all.
    #[test]
    fn realistic_bursty_block_moves_from_thirties_into_the_fifties() {
        let mut kb = HashSet::new();
        let mut mouse = HashSet::new();
        // 0-119: typing an email, dense input.
        for s in 0..120 {
            kb.insert(T0 + s);
        }
        // 120-299: reading, a scroll every 6 seconds.
        for s in (120..300).step_by(6) {
            mouse.insert(T0 + s);
        }
        // 300-449: on a call, mouse moved every 30 seconds.
        for s in (300..450).step_by(30) {
            mouse.insert(T0 + s);
        }
        // 450-539: mouse-driven design work, intermittent drags.
        for s in (450..540).step_by(2) {
            mouse.insert(T0 + s);
        }
        // 540-599: thinking, a handful of scattered keystrokes.
        for s in (540..600).step_by(6) {
            kb.insert(T0 + s);
        }

        let raw = count_active_seconds(&kb, &mouse, T0, T0 + 599, 1);
        let filled = count_active_seconds(&kb, &mouse, T0, T0 + 599, PAUSE_DEFINITION_SECS);

        let before = pct(raw.active, 600);
        let after = pct(filled.active, 600);

        assert!(
            (30.0..40.0).contains(&before),
            "per-second baseline should land in the thirties, got {before}"
        );
        assert!(
            (50.0..65.0).contains(&after),
            "pause definition should land in the fifties, got {after}"
        );
        assert!(after > before, "the pause definition is monotone");
        // The raw per-kind signal is untouched by the fill.
        assert_eq!(raw.keyboard, filled.keyboard);
        assert_eq!(raw.mouse, filled.mouse);
    }

    #[test]
    fn activity_is_monotone_in_the_pause_definition() {
        let kb = secs([0, 30, 60, 90, 120, 200, 400]);
        let empty = HashSet::new();
        let mut previous = 0;
        for pause in 1..=6 {
            let c = count_active_seconds(&kb, &empty, T0, T0 + 600, pause);
            assert!(
                c.active >= previous,
                "widening the window from {} lowered activity", pause - 1
            );
            previous = c.active;
        }
    }
}
