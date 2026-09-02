import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import CircularTimer from "./CircularTimer";
import LightRays from "./LightRays";
import Consent from "./Consent";
import { DatePicker } from "./DatePicker";
import { Select } from "./Select";
import { useInfiniteList } from "./useInfinite";
import {
  api,
  ApiError,
  API_BASE,
  clearToken,
  getToken,
  setToken,
  CONSENT_VERSION,
  UNAUTHORIZED_EVENT,
  type Me,
  type Project,
  type Session,
} from "./api";

// Push the sync engine our credentials so the offline queue drains even when
// no session is running. Empty token clears them (on sign-out).
//
// This is also what binds the on-disk queue and the local screenshot gallery to
// the signed-in account, so callers that are about to read either one should
// await it — both are empty until the engine knows who is signed in.
function pushSyncAuth(): Promise<void> {
  return invoke<void>("set_sync_auth", { token: getToken() ?? "", backend: API_BASE }).catch(() => {});
}

interface SyncState {
  pending: number;
  lastSyncedAt: string | null;
  online: boolean;
  lastError: string | null;
}

interface ReminderPrefs {
  idle: boolean;
  notTracking: boolean;
  /** OS notification each time a screenshot is captured. On by default — the
   *  product commitment is that capture is never silent. */
  screenshots: boolean;
  /** OS notification when the timer starts/stops. */
  timer: boolean;
  /** OS notification when syncing to the backend starts failing / recovers. */
  sync: boolean;
  /** OS notification when a new version is available. On by default — the app
   *  lives in the tray, so without this an update is only ever discovered by
   *  opening the window. */
  updates: boolean;
}
const REMINDER_DEFAULTS: ReminderPrefs = { idle: true, notTracking: false, screenshots: true, timer: true, sync: true, updates: true };
function loadReminders(): ReminderPrefs {
  try { return { ...REMINDER_DEFAULTS, ...JSON.parse(localStorage.getItem("trax_reminders") || "{}") }; }
  catch { return { ...REMINDER_DEFAULTS }; }
}

// The app's real version (from Tauri); falls back in browser preview.
async function getAppVersion(): Promise<string> {
  try { return await (await import("@tauri-apps/api/app")).getVersion(); }
  catch { return "0.0.0"; }
}

// Org capture policy is cached so a session can start (and capture) with no
// network — offline-first. Refreshed whenever we successfully reach the backend.
interface OrgCaptureSettings { perBlock: number; blur: boolean; idleMinutes: number }
function cacheOrgSettings(o: { screenshotsPerBlock: number; blurScreenshots: boolean; idleTimeoutMinutes: number }) {
  try { localStorage.setItem("trax_org_settings", JSON.stringify({ perBlock: o.screenshotsPerBlock, blur: o.blurScreenshots, idleMinutes: o.idleTimeoutMinutes })); } catch { /* ignore */ }
}
function getCachedOrgSettings(): OrgCaptureSettings {
  try { const v = JSON.parse(localStorage.getItem("trax_org_settings") || ""); if (v && typeof v.perBlock === "number") return v; } catch { /* ignore */ }
  return { perBlock: 1, blur: false, idleMinutes: 5 };
}

// The signed-in role, cached for the same offline-first reason as the capture
// policy above. Needed by the local gallery, which decides whether to show an
// image without being able to ask the server.
function cacheRole(role: string) {
  try { localStorage.setItem("trax_role", role); } catch { /* ignore */ }
}
/** Owner/admin see every capture regardless of the org's blur setting. */
function isPrivilegedCached(): boolean {
  try { const r = localStorage.getItem("trax_role"); return r === "owner" || r === "admin"; } catch { return false; }
}

/**
 * Whether the person at this machine may look at a capture taken on it.
 *
 * Mirrors the server's rule for /screenshots exactly — `privileged || !blur` —
 * because the local gallery reads .webp files straight off disk and never asks
 * the server, so nothing else would apply the org's blur policy to it.
 *
 * Note what this can and cannot do: it withholds the image from the app's own
 * UI. The file is still on this disk, because the capture happened here; a
 * determined user can open it in a file browser. That is inherent to capturing
 * on someone's own machine and is the same reason blur is a display policy
 * rather than a guarantee — see the comment on the server's list handler.
 */
function canViewOwnCaptures(): boolean {
  return isPrivilegedCached() || !getCachedOrgSettings().blur;
}
/**
 * Locally-tracked sessions, persisted so the total survives an app restart before
 * they've synced. Pruned to the last ~8 days.
 *
 * Stamped with the OWNER's identity rather than wiped at every re-auth boundary.
 *
 * The wipe existed for a real reason — a different person signing into the same
 * installed app would otherwise inherit the previous user's cached sessions,
 * which `mergeSessions` folds straight into their totals with no ownership check.
 * But wiping unconditionally destroyed the *same* user's closed copies too, and
 * that combination is what made a rejected token permanently corrupting: the 401
 * handler banks the running session locally because it cannot post a stop, then
 * signing back in deleted exactly that record — leaving a server row that was
 * open, un-maskable (no local closed copy) and un-resumable (`trax_stopped_ids`),
 * accruing time forever.
 *
 * Tagging by owner keeps the protection and drops the collateral damage.
 */
const LOCAL_SESSIONS_KEY = "trax_local_sessions";
const LOCAL_SESSIONS_OWNER_KEY = "trax_local_sessions_owner";

/** Who the cached sessions belong to, or null if unknown/never set. */
function localSessionsOwner(): string | null {
  try { return localStorage.getItem(LOCAL_SESSIONS_OWNER_KEY); } catch { return null; }
}
function loadLocalSessions(): Session[] {
  try {
    const list = JSON.parse(localStorage.getItem(LOCAL_SESSIONS_KEY) || "[]") as Session[];
    const cutoff = Date.now() - 8 * 86400000;
    return Array.isArray(list) ? list.filter((s) => new Date(s.startedAt).getTime() >= cutoff) : [];
  } catch { return []; }
}
function saveLocalSessions(list: Session[]) {
  try { localStorage.setItem(LOCAL_SESSIONS_KEY, JSON.stringify(list)); } catch { /* ignore */ }
}
/** Record who the cache belongs to. Called as soon as the signed-in identity is known. */
function setLocalSessionsOwner(owner: string) {
  try { localStorage.setItem(LOCAL_SESSIONS_OWNER_KEY, owner); } catch { /* ignore */ }
}
/**
 * Drop the cache only if it belongs to somebody else.
 *
 * Called at each re-authentication boundary. An unknown owner is treated as
 * somebody else: caches written before this tagging existed have no provenance,
 * and inheriting them is the leak this guards against.
 */
function clearLocalSessionsCacheUnless(owner: string) {
  if (localSessionsOwner() === owner) return;
  try {
    localStorage.removeItem(LOCAL_SESSIONS_KEY);
    localStorage.removeItem(STOPPED_IDS_KEY);
  } catch { /* ignore */ }
  setLocalSessionsOwner(owner);
}
/**
 * Stops we owe the server.
 *
 * The 401 path ends a session locally but CANNOT post the stop — the token is
 * precisely what was rejected. Recording the intent here means the stop is sent
 * as soon as we are authenticated again, so the row is closed with an accurate
 * reason rather than waiting to be swept up by the server later.
 *
 * Small and idempotent: a stop for an already-closed session returns 409, which
 * is a successful outcome as far as this queue is concerned.
 */
const PENDING_STOPS_KEY = "trax_pending_stops";
function loadPendingStops(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(PENDING_STOPS_KEY) || "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch { return []; }
}
function savePendingStops(ids: string[]) {
  try { localStorage.setItem(PENDING_STOPS_KEY, JSON.stringify(ids.slice(-20))); } catch { /* ignore */ }
}
function rememberPendingStop(id: string) {
  savePendingStops([...new Set([...loadPendingStops(), id])]);
}

// Sessions this device has finished but the server may still think are open,
// because our token was rejected before we could post the stop.
//
// Persisted rather than kept only in the in-memory `stoppedIds` set, which dies
// with the component when a rejected token drops us to the login screen. Without
// it the next sign-in sees a still-open row, treats it as a crash to recover
// from, and silently resumes this morning's clock — counting every signed-out
// hour as tracked. Capped because it only has to outlive a re-login.
const STOPPED_IDS_KEY = "trax_stopped_ids";
function loadStoppedIds(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(STOPPED_IDS_KEY) || "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch { return []; }
}
function rememberStoppedId(id: string) {
  try {
    const next = [...new Set([...loadStoppedIds(), id])].slice(-20);
    localStorage.setItem(STOPPED_IDS_KEY, JSON.stringify(next));
  } catch { /* ignore */ }
}
// Merge server + local sessions, de-duplicated by id (client & server share the
// id, so a synced session is never counted twice). Prefer whichever copy is
// marked ended: a stale still-open server row must not override a locally-closed
// session, or secs() would keep growing and inflate the totals after a stop.
function mergeSessions(server: Session[], local: Session[]): Session[] {
  const byId = new Map<string, Session>();
  for (const s of local) if (s.id) byId.set(s.id, s);
  for (const s of server) {
    if (!s.id) continue;
    const existing = byId.get(s.id);
    if (existing?.endedAt && !s.endedAt) continue; // keep the closed copy
    // A server row whose duration is negative (client/server clock disagreement)
    // must not replace a sane local copy — that's how a bad clock turned into
    // "-1:-1:-1" and a stuck 00:00:00 ring.
    if (existing && rawSecs(s) < 0 && rawSecs(existing) >= 0) continue;
    byId.set(s.id, s);
  }
  return [...byId.values()];
}

// A locally-generated session id so tracking can begin with zero network.
function newSessionId(): string {
  try { return crypto.randomUUID(); } catch {
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0; return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
    });
  }
}

// Fire a real OS notification — one that shows up outside the app window.
//
// Routed through Rust rather than @tauri-apps/plugin-notification's JS API: that
// API sends via `window.Notification` and its shim reports the permission as
// "denied" on Windows, so nothing ever reached the OS and every alert below was
// only ever visible as the in-app banner. Best-effort; never blocks the caller.
function notify(title: string, body: string) {
  invoke("notify_os", { title, body }).catch(() => { /* not under Tauri — ignore */ });
}

const WEEK_TARGET_SECONDS = 40 * 3600; // 40h/week target
const DAY_TARGET_SECONDS = 8 * 3600;

function startOfToday(): Date { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }
function startOfWeek(): Date { const d = startOfToday(); const day = (d.getDay() + 6) % 7; d.setDate(d.getDate() - day); return d; }
// When a session effectively ended.
//
// NOT `endedAt ?? Date.now()`. Nothing in this product used to close a session
// abandoned by a crash, an OS shutdown or a rejected token, so treating a null
// `endedAt` as "still running" let one forgotten row accrue time indefinitely
// across every total on this screen. The server now decides where an open session
// stops — at the last evidence its device was alive — and sends it as
// `effectiveEndAt`. Fall back to `now` only for a session created locally moments
// ago that has not registered yet; that one really is running.
function endMs(s: Session): number {
  if (s.effectiveEndAt) return new Date(s.effectiveEndAt).getTime();
  if (s.endedAt) return new Date(s.endedAt).getTime();
  return Date.now();
}
// Signed duration — only for deciding which of two copies of a session to trust.
function rawSecs(s: Session): number { return (endMs(s) - new Date(s.startedAt).getTime()) / 1000; }
// Duration for display/aggregation. Clamped: a session can never have run for a
// negative amount of time, and an unclamped value propagates into every total,
// bar width and clock on the screen.
//
// Prefers the server's `workedSeconds`, which is the only figure that also nets
// off idle the member discarded — this client cannot see IdleDiscard rows, which
// is why "Worked time" in Reports and "Tracked today" here used to disagree.
function secs(s: Session): number {
  if (typeof s.workedSeconds === "number") return Math.max(0, s.workedSeconds);
  return Math.max(0, rawSecs(s));
}
/** Still tracking. An open row alone does not prove it — see `abandoned`. */
function isLive(s: Session): boolean { return !s.endedAt && !s.abandoned; }
// Seconds of a session that fall inside [fromMs, toMs).
//
// Totals are attributed by OVERLAP, never by which day a session started. A
// shift from 23:00 to 03:00 belongs to both days — one hour to the first, three
// to the second. Bucketing the whole session by its start instant meant today
// showed nothing at all for someone who began before midnight, and the running
// timer never reset at 00:00 because its full elapsed time kept being added to
// "today" no matter how long ago it started.
function overlapSecs(s: Session, fromMs: number, toMs: number): number {
  const start = new Date(s.startedAt).getTime();
  const end = endMs(s);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  const winFrom = Math.max(start, fromMs);
  const winTo = Math.min(end, toMs);
  const inside = Math.max(0, winTo - winFrom) / 1000;
  if (inside <= 0) return 0;

  // Deducted stretches come off the exact window they happened in.
  //
  // `idleSpans` carries the real from/to of each deduction, so a session that ran
  // Monday to Wednesday with a two-day hole in the middle shows nothing on Tuesday
  // and its full real hours on Wednesday. Spreading the deduction across the
  // session instead — which is what a single worked/gross ratio does — reported a
  // seven-hour Wednesday as under three, and still showed hours on a Tuesday when
  // the app had not been running at all.
  const idle = (s.idleSpans ?? []).reduce((a, span) => {
    const f = new Date(span.from).getTime();
    const t = new Date(span.to).getTime();
    return a + Math.max(0, Math.min(t, winTo) - Math.max(f, winFrom)) / 1000;
  }, 0);

  return Math.max(0, inside - idle);
}
// Both formatters clamp too — Math.floor on a small negative yields -1 for each
// component independently, which is where "-1:-1:-1" came from.
function fmtClock(sec: number): string { const t = Math.max(0, sec); const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = Math.floor(t % 60); return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`; }
function fmtShort(sec: number): string { const t = Math.max(0, sec); const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60); return h > 0 ? `${h}h ${m}m` : `${m}m`; }
function fmtT(iso: string): string { return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); }
function fmtD(iso: string): string { return new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" }); }

type DashTab = "dashboard" | "timesheets" | "activity" | "reports" | "projects";

export default function App() {
  const [authed, setAuthed] = useState(Boolean(getToken()));
  // Set when we were signed out *for* the user rather than by them, so the login
  // screen can explain itself instead of just appearing.
  const [signedOutReason, setSignedOutReason] = useState<string | null>(null);
  const [pendingUpdate, setPendingUpdate] = useState<PendingUpdate | null>(null);
  useUpdateCheck(setPendingUpdate);

  // A manual check from the footer button shows the same dialog as the automatic
  // one — same "what's new", same explicit choice — rather than a second, thinner
  // path to installing.
  useEffect(() => {
    const onFound = (e: Event) => {
      const found = (e as CustomEvent<PendingUpdate>).detail;
      if (found) setPendingUpdate(found);
    };
    window.addEventListener(UPDATE_FOUND_EVENT, onFound);
    return () => window.removeEventListener(UPDATE_FOUND_EVENT, onFound);
  }, []);

  // The server rejected our token (expired, or signed with a key that has since
  // changed). api() has already cleared it; drop to the login screen rather than
  // leaving a signed-in-looking tracker that can't load anything. Also clear the
  // sync engine's copy so it stops retrying uploads with a credential the server
  // will never accept — it treats 401 as retryable and would loop forever.
  useEffect(() => {
    const onUnauthorized = (e: Event) => {
      pushSyncAuth();
      const detail = (e as CustomEvent<{ message?: string }>).detail;
      setSignedOutReason(detail?.message ?? "Please sign in again.");
      setAuthed(false);
    };
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, []);

  return (
    <>
      {pendingUpdate && (
        <UpdateDialog update={pendingUpdate} onDismiss={() => setPendingUpdate(null)} />
      )}
      {!authed ? (
        <Login
          notice={signedOutReason}
          onLogin={() => { setSignedOutReason(null); setAuthed(true); }}
        />
      ) : (
        <ConsentGate onLogout={() => setAuthed(false)} />
      )}
    </>
  );
}

// Gate the tracker behind the consent screen. Capture code (begin_capture) is
// unreachable until the current CONSENT_VERSION is accepted for this user.
function ConsentGate({ onLogout }: { onLogout: () => void }) {
  const [state, setState] = useState<"checking" | "needed" | "ok">("checking");

  useEffect(() => {
    // Scope first, then the consent check — offline, /auth/me rejects straight
    // away, and the tracker behind this gate reads the per-account screenshot
    // gallery as soon as it mounts.
    pushSyncAuth()
      .then(() => api<Me>("/auth/me"))
      .then((me) => {
        if (me.token) { setToken(me.token); pushSyncAuth(); } // sliding renewal
        setState(me.consentVersion != null && me.consentVersion >= CONSENT_VERSION ? "ok" : "needed");
      })
      .catch((e) => {
        // A rejected token is not "offline" — reading it that way is what let a
        // dead session fall through this gate into a tracker that could never
        // load a project. App has already been told to show the login screen;
        // stay in "checking" so we don't render the tracker on the way out.
        if (e instanceof ApiError && e.status === 401) return;
        // Genuinely offline: if we've accepted before on this device, don't block; else ask.
        setState(localStorage.getItem("trax_consent_v") === String(CONSENT_VERSION) ? "ok" : "needed");
      });
  }, []);

  function signOut() {
    clearToken();
    // The local session cache is deliberately NOT wiped here. It is tagged with
    // its owner, so the next sign-in drops it only if somebody else logs in —
    // which means this user's own closed-but-unsynced time survives a sign-out
    // instead of being thrown away before it can reach the server.
    pushSyncAuth();
    onLogout();
  }

  if (state === "checking") {
    return <div className="app-loading"><div className="app-loading-mark" /></div>;
  }
  if (state === "needed") {
    return (
      <Consent
        onAccept={() => { localStorage.setItem("trax_consent_v", String(CONSENT_VERSION)); setState("ok"); }}
        onDecline={signOut}
      />
    );
  }
  return <Tracker onLogout={onLogout} />;
}

// Compare dotted numeric versions. >0 if a is newer, <0 if older, 0 if equal.
// Non-numeric/short parts are treated as 0 so "0.1.10" > "0.1.0" (10 > 0) rather
// than comparing as strings, where "0.1.10" < "0.1.9".
function cmpVersion(a: string, b: string): number {
  const pa = a.split("."), pb = b.split(".");
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (parseInt(pa[i] ?? "0", 10) || 0) - (parseInt(pb[i] ?? "0", 10) || 0);
    if (d !== 0) return d > 0 ? 1 : -1;
  }
  return 0;
}

// Check for a newer signed release on startup; if found, download + relaunch.
//
// Guarded deliberately: the updater must NEVER install a version that isn't
// strictly newer than what's running. Without this check a build whose version
// trails the published `latest.json` (e.g. an untagged CI artifact stamped
// 0.1.0 against a 0.1.10 release) installs the *older* release over itself,
// relaunches, and loops — wiping newer code and resetting the timer each cycle.
// Runs at most once per launch.
export type PendingUpdate = {
  version: string;
  current: string;
  notes: string;
  install: () => Promise<void>;
};

/** Versions the user chose to skip — never offered again. */
function isSkipped(v: string): boolean {
  try { return (JSON.parse(localStorage.getItem("trax_skipped_updates") ?? "[]") as string[]).includes(v); }
  catch { return false; }
}
function skipVersion(v: string) {
  try {
    const list = JSON.parse(localStorage.getItem("trax_skipped_updates") ?? "[]") as string[];
    if (!list.includes(v)) list.push(v);
    localStorage.setItem("trax_skipped_updates", JSON.stringify(list));
  } catch { /* storage unavailable — worst case we offer it again */ }
}

// How often to re-check for a new release while the app is running. This is a
// tray app that stays open for days at a time, so a one-shot check at launch
// meant a release published after startup went unnoticed until the next
// restart — which for some users is never.
const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours

// Process-lifetime timer, deliberately never cleared: the check should keep
// running for as long as the app does. Also acts as the "already scheduled"
// guard, replacing a plain boolean that React 18 StrictMode's double-invoke
// could otherwise leave set with no interval actually running.
let updateTimer: ReturnType<typeof setInterval> | null = null;
// Versions we've already raised an OS notification for, so a repeating check
// doesn't re-notify about the same release every 6 hours.
const notifiedVersions = new Set<string>();

/**
 * Raised when a manual check finds an update, so the footer button can reuse the
 * same prompt the automatic check shows.
 *
 * A window event rather than props threaded down: `pendingUpdate` lives in App(),
 * and Tracker() sits two components below it behind ConsentGate. Matches the
 * UNAUTHORIZED_EVENT convention already used to reach across that gap.
 */
export const UPDATE_FOUND_EVENT = "trax:update-found";

export type UpdateCheck =
  | { status: "available"; update: PendingUpdate }
  | { status: "current"; version: string }
  /** No opinion — not running under Tauri, offline, or the updater threw. */
  | { status: "unknown" };

/**
 * Ask the updater what's out there. One implementation, three callers: the 6-hourly
 * background check, the tray menu, and the footer button.
 *
 * `respectSkips` is false for a manual check — someone who has just clicked "check
 * for updates" is asking about the version they previously skipped too, and
 * silently telling them they're up to date would be a lie.
 */
async function findUpdate(respectSkips: boolean): Promise<UpdateCheck> {
  const current = await getAppVersion();
  try {
    const { check } = await import("@tauri-apps/plugin-updater");
    const update = await check();
    if (!update?.available) return { status: "current", version: current };
    const next = update.version;
    // A "newer" version that isn't newer is a broken manifest, not an update.
    if (cmpVersion(next, current) <= 0) {
      console.warn(`[updater] refusing ${current} → ${next} (not newer)`);
      return { status: "current", version: current };
    }
    if (respectSkips && isSkipped(next)) {
      console.info(`[updater] ${next} was skipped by the user`);
      return { status: "current", version: current };
    }
    return {
      status: "available",
      update: {
        version: next,
        current,
        notes: update.body?.trim() || "",
        install: async () => {
          await update.downloadAndInstall();
          const { relaunch } = await import("@tauri-apps/plugin-process");
          await relaunch();
        },
      },
    };
  } catch (e) {
    console.warn("[updater] check failed:", e);
    return { status: "unknown" };
  }
}

function useUpdateCheck(onFound: (u: PendingUpdate) => void) {
  // The interval outlives any given render, so it reads the callback through a
  // ref rather than capturing a stale one from the first closure.
  const cb = useRef(onFound);
  cb.current = onFound;

  useEffect(() => {
    if (updateTimer !== null) return;

    const runCheck = async () => {
      const found = await findUpdate(true);
      if (found.status !== "available") return;
      const { version: next, current } = found.update;
      // Ask rather than install silently. An unannounced restart mid-session is
      // alarming, and users deserve to see what changed before it happens.
      console.info(`[updater] ${next} available (running ${current})`);
      // The in-app dialog is invisible when the window is minimised to the tray,
      // which is where the tracker usually lives — so the OS notification is the
      // part that actually reaches the user. Raised once per version, and read
      // from storage each time so toggling the pref takes effect without a
      // restart.
      if (!notifiedVersions.has(next)) {
        notifiedVersions.add(next);
        if (loadReminders().updates) {
          notify("TraxStaff", `Version ${next} is available — you're on ${current}. Open TraxStaff to install it.`);
        }
      }
      cb.current(found.update);
    };

    void runCheck();
    updateTimer = setInterval(() => { void runCheck(); }, UPDATE_CHECK_INTERVAL_MS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

// Kept for the tray "Check for updates" action, which installs immediately.
async function installUpdateNow(): Promise<void> {
      const current = await getAppVersion();
      try {
        const { check } = await import("@tauri-apps/plugin-updater");
        const update = await check();
        if (!update?.available) return;
        const next = update.version;
        if (cmpVersion(next, current) <= 0) {
          console.warn(`[updater] refusing ${current} → ${next} (not newer)`);
          return;
        }
        console.info(`[updater] updating ${current} → ${next}`);
        await update.downloadAndInstall();
        const { relaunch } = await import("@tauri-apps/plugin-process");
        await relaunch();
      } catch (e) {
        // Not running under Tauri, offline, or the update failed. Not fatal —
        // but log it, since a silently broken updater strands users on old builds.
        console.warn("[updater] check failed:", e);
      }
}

/** Hubstaff-style update prompt: what's new, and an explicit choice. */
function UpdateDialog({ update, onDismiss }: { update: PendingUpdate; onDismiss: () => void }) {
  const [installing, setInstalling] = useState(false);
  const [failed, setFailed] = useState(false);

  async function install() {
    setInstalling(true);
    setFailed(false);
    try {
      await update.install();
    } catch (e) {
      console.error("[updater] install failed:", e);
      setInstalling(false);
      setFailed(true);
    }
  }

  return (
    <div className="modal-scrim">
      <div className="upd-card" role="dialog" aria-modal="true" aria-labelledby="upd-title">
        <h3 className="upd-title" id="upd-title">A new version of TraxStaff is available</h3>
        <p className="upd-sub">
          TraxStaff <strong>{update.version}</strong> is ready to install — you have {update.current}.
        </p>

        {update.notes && (
          <>
            <div className="upd-notes-label">What&rsquo;s new</div>
            <div className="upd-notes">{update.notes}</div>
          </>
        )}

        {failed && (
          <div className="upd-error">
            The update couldn&rsquo;t be installed. Check your connection and try again.
          </div>
        )}

        <div className="upd-actions">
          <button
            className="upd-ghost"
            disabled={installing}
            onClick={() => { skipVersion(update.version); onDismiss(); }}
          >
            Skip this version
          </button>
          <button className="upd-ghost" disabled={installing} onClick={onDismiss}>
            Remind me later
          </button>
          <button className="upd-primary" disabled={installing} onClick={install}>
            {installing ? "Installing…" : "Install and restart"}
          </button>
        </div>
        <p className="upd-foot">
          TraxStaff will close and reopen. Any tracked time is saved first.
        </p>
      </div>
    </div>
  );
}

// Inline SVG icons. Glyph characters (⏻ » «) are NOT present in Space Grotesk or
// Outfit, so they fall through to the platform symbol font — or render as a tofu
// box when it lacks them too, which is what happened to the sign-out icon.
function PowerIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" aria-hidden>
      <path d="M12 3v9" />
      <path d="M18.4 6.6a9 9 0 1 1-12.8 0" />
    </svg>
  );
}

function ChevronIcon({ dir }: { dir: "left" | "right" }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {dir === "right" ? <path d="M9 6l6 6-6 6" /> : <path d="M15 6l-6 6 6 6" />}
    </svg>
  );
}

/** Check-for-updates: a download arrow onto a tray, matching the footer's stroke icons. */
function UpdateIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 3v11" />
      <path d="m7.5 9.5 4.5 4.5 4.5-4.5" />
      <path d="M4 19h16" />
    </svg>
  );
}

export type ShotStatus = "uploaded" | "uploading" | "pending";

/** Per-screenshot upload state, so it's obvious what has reached the server. */
function UploadTag({ status }: { status?: ShotStatus }) {
  const s: ShotStatus = status ?? "pending";
  const label = s === "uploaded" ? "Uploaded" : s === "uploading" ? "Uploading…" : "Not uploaded";
  return (
    <div className={`shot-tag ${s}`} title={
      s === "uploaded" ? "Stored on the server"
      : s === "uploading" ? "Uploading now"
      : "Saved on this device — will upload automatically"
    }>
      {s === "uploaded" && (
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M4 12.5l5 5L20 6.5" /></svg>
      )}
      {s === "uploading" && <span className="shot-tag-spin" aria-hidden />}
      {s === "pending" && (
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" aria-hidden><path d="M12 8v4l3 2" /><circle cx="12" cy="12" r="9" /></svg>
      )}
      {label}
    </div>
  );
}

const eyeProps = { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
function EyeIcon() {
  return (
    <svg {...eyeProps} aria-hidden>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}
function EyeOffIcon() {
  return (
    <svg {...eyeProps} aria-hidden>
      <path d="M10.6 6.1A9.6 9.6 0 0 1 12 6c6.5 0 10 6 10 6a15 15 0 0 1-3.3 3.8M6.6 6.6A15 15 0 0 0 2 12s3.5 6 10 6a9.3 9.3 0 0 0 3.6-.7" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
      <path d="m3 3 18 18" />
    </svg>
  );
}

function Login({ onLogin, notice }: { onLogin: () => void; notice?: string | null }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setLoading(true); setError(null);
    try {
      const res = await api<{ token: string }>("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
      setToken(res.token);
      // The actual re-auth boundary, and the one place a different person signing
      // into a shared/reused install would inherit the last user's locally-cached
      // tracked time. Scoped by owner: somebody else's cache is dropped, this
      // person's own closed-but-unsynced sessions survive — losing those is what
      // turned a rejected token into a permanently open server row.
      clearLocalSessionsCacheUnless(email.trim().toLowerCase());
      notify("TraxStaff", `Signed in as ${email}`);
      onLogin();
    } catch (err) { setError(err instanceof Error ? err.message : "Login failed"); }
    finally { setLoading(false); }
  }
  return (
    <div className="login-screen">
      <div className="login-bg">
        <LightRays raysOrigin="top-center" raysColor="#ffffff" raysSpeed={1} lightSpread={0.5} rayLength={3} followMouse mouseInfluence={0.1} distortion={0.4} saturation={1} />
      </div>
      <div className="login-card">
        <img src="/brand/icon-badge.svg" alt="TraxStaff" className="login-badge" />
        <h1 className="login-title">Welcome back</h1>
        <p className="login-sub">{notice ?? "Sign in to start tracking."}</p>
        <form onSubmit={submit} className="stack">
          <input type="email" placeholder="name@company.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <div className="pw-wrap">
            <input type={showPw ? "text" : "password"} placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            <button type="button" className="pw-toggle" onClick={() => setShowPw((s) => !s)} aria-label={showPw ? "Hide password" : "Show password"}>
              {showPw ? <EyeOffIcon /> : <EyeIcon />}
            </button>
          </div>
          {error && <div className="error">{error}</div>}
          <button type="submit" disabled={loading}>{loading ? "Signing in…" : "Log in"}</button>
        </form>
      </div>
    </div>
  );
}

function Tracker({ onLogout }: { onLogout: () => void }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [week, setWeek] = useState<Session[]>([]);
  // Seeded from the constants so the first paint has a sane ring, then replaced
  // by whatever the org/member is actually set to.
  const [dayTarget, setDayTarget] = useState(DAY_TARGET_SECONDS);
  const [weekTarget, setWeekTarget] = useState(WEEK_TARGET_SECONDS);
  // Sessions tracked on THIS device that may not have synced yet. Merged into
  // the week totals (deduped by id) so switching projects / working offline
  // never makes the on-screen total drop — the completed time still counts.
  const [localSessions, setLocalSessions] = useState<Session[]>(() => loadLocalSessions());
  const [active, setActive] = useState<Session | null>(null);
  const [projectId, setProjectId] = useState("");
  const [taskId, setTaskId] = useState("");
  const [elapsed, setElapsed] = useState(0);
  // Last authoritative elapsed value + the monotonic instant it arrived, so the
  // 1 Hz interpolator counts on from Rust's clock instead of competing with it.
  const elapsedAnchor = useRef<{ secs: number; at: number } | null>(null);
  // Purely to force a re-render once a minute so `dayStartMs`/`weekStartMs`
  // below (computed fresh from `Date.now()` on every render) roll over at
  // local midnight even with no active session. Without this, "Tracked today"
  // would freeze at yesterday's total past midnight until some unrelated
  // event (window focus, a new session starting) happened to re-render —
  // the per-second ticker further below only runs while `active` is set.
  const [, setDayBoundaryTick] = useState(0);
  // Must match the window size tauri.conf.json actually opens at (420x640).
  // Starting this `true` meant the first click on the chevron *shrank* an
  // already-narrow window, so the control looked dead.
  const [expanded, setExpanded] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [tab, setTab] = useState<DashTab>("dashboard");
  const [error, setError] = useState<string | null>(null);
  const [idleBanner, setIdleBanner] = useState<number | null>(null); // "you're idle" hint while away
  const [idlePrompt, setIdlePrompt] = useState<{ minutes: number; fromISO: string; toISO: string; deductedSecs?: number } | null>(null);
  /**
   * An open session from a previous run that the server no longer believes is
   * alive — the app was killed, the machine shut down, or a token was rejected
   * before a stop could be posted.
   *
   * It is NOT adopted as the live session. Doing that is what put 39 hours on the
   * clock the moment the app opened, and banked all of it on the next Start.
   */
  const [orphanSession, setOrphanSession] = useState<Session | null>(null);
  /**
   * Away stretches currently deducted from the live session, with their wall-clock
   * spans.
   *
   * Needed because the timer is a single monotonic number: it cannot say WHEN the
   * deducted time was. That matters at a day boundary — a session running from
   * 22:00 with an overnight suspend would otherwise have the whole deduction
   * charged against today, under-reporting today by however much of the absence
   * happened yesterday. Keeping the spans lets the day/week split subtract only the
   * part of the absence that falls inside the window.
   *
   * A span leaves this list when the member adds it back, and the whole list is
   * dropped when the session ends.
   */
  const [awaySpans, setAwaySpans] = useState<{ fromMs: number; toMs: number; secs: number }[]>([]);
  const [resumed, setResumed] = useState<number | null>(null); // suspend gap (minutes)
  const [sync, setSync] = useState<SyncState | null>(null);
  const [hookOk, setHookOk] = useState(true);
  // True when the native capture engine refused to start. The timer keeps
  // running, but screenshots/activity are NOT being recorded — the user must be
  // told rather than shown a false "screenshots on".
  const [captureFailed, setCaptureFailed] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [closeInfo, setCloseInfo] = useState<{ capturing: boolean; pending: number } | null>(null);
  const [closingRemaining, setClosingRemaining] = useState<number | null>(null);
  const [shotsOk, setShotsOk] = useState(true);
  const [shotCount, setShotCount] = useState(0); // screenshots this session
  const [localShots, setLocalShots] = useState<{ takenAt: string; monitorIndex: number; dataUrl: string; status?: ShotStatus }[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2600);
  }, []);
  const loadLocalShots = useCallback(() => {
    invoke<{ takenAt: string; monitorIndex: number; dataUrl: string }[]>("local_shots").then(setLocalShots).catch(() => {});
  }, []);
  const deviceId = useRef<string | null>(null);
  const heartbeat = useRef<ReturnType<typeof setInterval> | null>(null);
  const registerTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Ids we've stopped locally — so a `load()` that races the stop POST doesn't
  // re-adopt the just-stopped session and restart the timer with no capture.
  // Seeded from disk so a session we closed on the way out of a rejected-token
  // sign-out is still recognised as stopped after the user signs back in.
  const stoppedIds = useRef<Set<string>>(new Set(loadStoppedIds()));
  const reminders = useRef<ReminderPrefs>(loadReminders());
  // Alerts we've already raised at OS level, so a health/sync event that repeats
  // every tick notifies once per transition instead of once per second.
  const alerted = useRef({ hook: false, shots: false, sync: false });
  const [remPrefs, setRemPrefs] = useState<ReminderPrefs>(reminders.current);
  const [settingsOpen, setSettingsOpen] = useState(false);
  /** True while a manual update check is in flight, so the button can say so. */
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  // Latest active session, readable from event listeners that register once.
  const activeRef = useRef<Session | null>(null);
  activeRef.current = active;

  // Our token was rejected, so this component is about to be replaced by the
  // login screen. Two things must happen first, and neither can wait for a
  // render: the time already on the clock has to be banked, and the native
  // capture engine has to stop — otherwise it keeps screenshotting for someone
  // the app has just signed out.
  //
  // Written straight to localStorage rather than through preserveOnExit(): that
  // one banks the session inside a setLocalSessions updater, and React may never
  // run an updater on a component that is unmounting, which would silently throw
  // away the tracked time.
  useEffect(() => {
    const onUnauthorized = () => {
      const cur = activeRef.current;
      if (!cur) return;
      stoppedIds.current.add(cur.id);
      rememberStoppedId(cur.id);
      // The server still thinks this session is open and we cannot tell it
      // otherwise right now. Record the debt so the next authenticated load()
      // settles it, instead of leaving a row that only the server-side sweeper
      // will ever close.
      rememberPendingStop(cur.id);
      const finished: Session = { ...cur, endedAt: new Date().toISOString() };
      saveLocalSessions(mergeSessions([], [...loadLocalSessions(), finished]));
      invoke("end_capture").catch(() => {});
      invoke("set_tracking_indicator", { active: false }).catch(() => {});
    };
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, []);

  // "Not tracking" reminder: within work hours (Mon–Fri 9–17 local), if the app
  // is open but no timer is running, nudge once an hour.
  useEffect(() => {
    const lastNudge = { at: 0 };
    const id = setInterval(() => {
      if (!reminders.current.notTracking || activeRef.current) return;
      const d = new Date();
      const workHours = d.getDay() >= 1 && d.getDay() <= 5 && d.getHours() >= 9 && d.getHours() < 17;
      if (workHours && Date.now() - lastNudge.at > 3600_000) {
        lastNudge.at = Date.now();
        notify("TraxStaff", "You're not tracking time right now.");
      }
    }, 5 * 60_000);
    return () => clearInterval(id);
  }, []);

  // Forces a re-render once a minute so `dayStartMs`/`weekStartMs` below
  // (computed fresh from `Date.now()` on every render) roll over at local
  // midnight even with nothing tracking. Without this, "Tracked today" would
  // freeze at yesterday's total past midnight until some unrelated event
  // (window focus, a new session starting) happened to re-render — the
  // per-second ticker further below only runs while a session is active.
  useEffect(() => {
    const id = setInterval(() => setDayBoundaryTick((t) => t + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  // Native capture engine → UI events. Registered once; read live state via refs.
  useEffect(() => {
    const uns = [
      // Timer truth from the monotonic clock (immune to minimize/sleep throttling).
      // Ignore non-positive values so a stray tick can't pin the clock to 0.
      // Re-anchors the local interpolator so it counts on from this value rather
      // than racing it.
      listen<{ elapsedSecs: number }>("trax:tick", (e) => {
        if (e.payload.elapsedSecs > 0) {
          elapsedAnchor.current = { secs: e.payload.elapsedSecs, at: performance.now() };
          setElapsed(e.payload.elapsedSecs);
        }
      }),
      // Sync engine state → badge + toast. Losing (or regaining) the backend is
      // notified once per transition, not on every state push.
      listen<SyncState>("trax:sync-state", (e) => {
        setSync(e.payload);
        const failing = !e.payload.online && !!e.payload.lastError;
        if (failing !== alerted.current.sync) {
          alerted.current.sync = failing;
          if (reminders.current.sync) {
            notify("TraxStaff", failing
              ? "Can't reach the TraxStaff server — your tracked time is saved on this device and will upload automatically."
              : "Back online — your tracked time has been uploaded.");
          }
        }
      }),
      // Capture health: input hook and/or screenshots. These are integrity
      // alerts — deliberately not behind a reminder toggle, and raised at OS
      // level too because the in-app banner is invisible from the tray.
      listen<{ inputHook?: boolean; screenshots?: boolean }>("trax:capture-health", (e) => {
        const { inputHook, screenshots } = e.payload;
        if (typeof inputHook === "boolean") {
          setHookOk(inputHook);
          if (!inputHook && !alerted.current.hook) {
            notify("TraxStaff", "Activity tracking stopped responding — your time still counts, but activity will read 0%.");
          }
          alerted.current.hook = !inputHook;
        }
        if (typeof screenshots === "boolean") {
          setShotsOk(screenshots);
          if (!screenshots && !alerted.current.shots) {
            notify("TraxStaff", "Screenshots couldn't be captured on this screen — time and activity still record.");
          }
          alerted.current.shots = !screenshots;
        }
      }),
      // A screenshot was just captured (persisted locally) — count it, toast it,
      // and refresh the local gallery. No server round trip needed.
      listen<{ takenAt: string }>("trax:shot-captured", () => {
        setShotCount((n) => n + 1);
        showToast("Screenshot captured");
        // Also notify at OS level: the in-app toast is invisible when the window
        // is minimised or behind another app, and capture must never feel silent.
        if (reminders.current.screenshots) notify("TraxStaff", "Screenshot taken");
        loadLocalShots();
      }),
      // Sync state changed — upload tags on the local gallery may have moved
      // from pending → uploading → uploaded.
      listen("trax:sync-state", () => loadLocalShots()),
      // Machine woke from sleep.
      listen<{ gapSecs: number }>("trax:resumed", (e) => {
        const mins = Math.round(e.payload.gapSecs / 60);
        setResumed(mins);
        if (reminders.current.idle) notify("TraxStaff", `Your computer was asleep for ~${mins} min — still tracking.`);
      }),
      // Idle threshold crossed (informational) and returned from idle (actionable).
      listen<{ minutes: number }>("trax:idle", (e) => {
        setIdleBanner(e.payload.minutes);
        if (reminders.current.idle) notify("TraxStaff", `You've been idle for ~${e.payload.minutes} min while tracking.`);
      }),
      // Back from an away stretch (idle past the threshold, or the machine woke).
      //
      // Rust has ALREADY taken the away time off the clock, so the timer on screen
      // is the work done before the member stepped away. This prompt only decides
      // whether to add it back. The discard is written to the server here too, not
      // when the prompt is answered, so an admin looking at the dashboard in this
      // window sees the same number the member does.
      listen<{ minutes: number; fromISO: string; toISO: string; deductedSecs?: number }>("trax:idle-ended", async (e) => {
        setIdleBanner(null);
        if (e.payload.minutes >= 1) {
          setIdlePrompt(e.payload);
          const fromMs = new Date(e.payload.fromISO).getTime();
          const toMs = new Date(e.payload.toISO).getTime();
          const secs = e.payload.deductedSecs ?? Math.max(0, (toMs - fromMs) / 1000);
          setAwaySpans((prev) =>
            prev.some((s) => s.fromMs === fromMs && s.toMs === toMs)
              ? prev
              : [...prev, { fromMs, toMs, secs }]
          );
          const cur = activeRef.current;
          if (cur) {
            api("/sync/discard-idle", {
              method: "POST",
              body: JSON.stringify({ sessionId: cur.id, fromISO: e.payload.fromISO, toISO: e.payload.toISO }),
            }).catch(() => { /* offline: the local deduction stands; retried on Keep/Discard */ });
          }
          if (reminders.current.idle) notify("TraxStaff", `You were away for ~${e.payload.minutes} min — keep or discard that time?`);
          // Pop the window to the foreground so the user sees the prompt immediately.
          // This matches Hubstaff's behavior: the idle prompt draws attention even if
          // the app was minimized or hidden. Non-blocking if not under Tauri.
          try {
            const { getCurrentWindow } = await import("@tauri-apps/api/window");
            const w = getCurrentWindow();
            if (!await w.isFocused()) {
              await w.show();
              await w.unminimize();
              await w.setFocus();
            }
          } catch { /* not under Tauri / window ops failed — ignore */ }
        }
      }),
    ];
    invoke<boolean>("capture_health").then(setHookOk).catch(() => {});
    return () => { uns.forEach((u) => u.then((f) => f())); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // An unanswered prompt leaves the away time DISCARDED.
  //
  // There is deliberately no auto-resolve timer here any more. The old one
  // auto-answered "Keep" after 60 minutes, on the reasoning that keeping was the
  // safe default — but the time was also being counted in the meantime, so an
  // ignored prompt silently billed a lunch break, and an overnight suspend billed
  // the night. With the deduction applied up front, silence now means "don't
  // credit it", and time is only ever added by an explicit Keep. The prompt itself
  // stays on screen until answered.

  // Exit flow: Rust holds the window open while a session is live or the sync
  // queue isn't empty, and emits "app-closing" with { capturing, pending }. We
  // show a three-way dialog (stop & sync / quit anyway / cancel) instead of
  // destroying the window and silently dropping unsynced records.
  useEffect(() => {
    const un = listen<{ capturing: boolean; pending: number }>("app-closing", (e) => setCloseInfo(e.payload));
    const up = listen<{ remaining: number }>("trax:flush-progress", (e) => setClosingRemaining(e.payload.remaining));
    return () => { un.then((f) => f()); up.then((f) => f()); };
  }, []);

  // If the window destroy call itself ever fails or hangs (any reason — a
  // stale webview handle, a plugin hiccup) the exit dialog was previously
  // left stuck forever at "Records remaining: 0" with no way out, since
  // nothing here had a fallback. Race a hard cap and fall back to killing
  // the whole process via the process plugin (already used for relaunch()
  // elsewhere in this file) so the app always actually closes once the
  // flush is done, regardless of why the window-level destroy failed.
  async function destroyWindow() {
    const hardExit = async () => {
      const { exit } = await import("@tauri-apps/plugin-process");
      await exit(0);
    };
    try {
      await Promise.race([
        (async () => {
          const { getCurrentWindow } = await import("@tauri-apps/api/window");
          await getCurrentWindow().destroy();
        })(),
        new Promise((_, reject) => setTimeout(() => reject(new Error("destroy timed out")), 5_000)),
      ]);
    } catch {
      await hardExit().catch(() => {});
    }
  }
  // Preserve a session's time locally so it's never lost on exit, whichever
  // button the user picks (shows in totals next launch; queued blocks still sync).
  function preserveOnExit(cur: Session | null) {
    if (!cur) return;
    stoppedIds.current.add(cur.id);
    const finished: Session = { ...cur, endedAt: new Date().toISOString() };
    setLocalSessions((prev) => { const next = mergeSessions([], [...prev, finished]); saveLocalSessions(next); return next; });
    invoke("set_tracking_indicator", { active: false }).catch(() => {});
  }
  // "Stop & sync": save locally, tell the server, then try to drain the queue —
  // but NEVER hang the close. Cap the flush; whatever's left drains next launch.
  async function closeStopAndSync() {
    const cur = activeRef.current;
    preserveOnExit(cur);
    setClosingRemaining(await invoke<number>("queue_count").catch(() => 0));
    if (cur) api(`/sessions/${cur.id}/stop`, { method: "POST", body: JSON.stringify({ endReason: "stopped" }) }).catch(() => {});
    await Promise.race([
      invoke<number>("flush_now_async", { token: getToken() ?? "", backend: API_BASE }).catch(() => 0),
      new Promise((r) => setTimeout(r, 25_000)), // hard cap so a flaky network can't wedge the exit
    ]);
    await destroyWindow();
  }
  // "Quit anyway": save locally + finalize the block to the durable queue (no
  // waiting on the network) and go. Your time is intact when you reopen.
  async function closeQuitAnyway() {
    const cur = activeRef.current;
    preserveOnExit(cur);
    if (cur) api(`/sessions/${cur.id}/stop`, { method: "POST", body: JSON.stringify({ endReason: "stopped" }) }).catch(() => {}); // best-effort
    await invoke("end_capture").catch(() => {});
    await destroyWindow();
  }
  function closeCancel() {
    invoke("cancel_close").catch(() => {});
    setCloseInfo(null);
    setClosingRemaining(null);
  }

  // System-tray menu actions → app handlers (via a ref so listeners register once).
  const trayHandlers = useRef<Record<string, () => void>>({});
  useEffect(() => {
    const events = ["start", "stop", "signout", "dashboard", "updates", "note"];
    const uns = events.map((e) => listen(`tray:${e}`, () => trayHandlers.current[e]?.()));
    return () => { uns.forEach((u) => u.then((f) => f())); };
  }, []);

  const load = useCallback(async () => {
    try {
      const [p, s, me] = await Promise.all([
        api<Project[]>("/projects"),
        api<Session[]>(`/sessions?from=${startOfWeek().toISOString()}`),
        // Targets are configurable per org and per member. A failure here must
        // not take the dashboard down with it — fall back to the defaults.
        api<Me>("/auth/me").catch(() => null),
      ]);
      setProjects(p); setWeek(s);
      // Sliding renewal: the server hands back a fresh token once the current
      // one is over halfway through its life, so an app left running in the tray
      // never reaches the 7-day expiry. Push it to the sync engine too, or the
      // queue keeps draining with the older (eventually dead) credential.
      if (me?.token) { setToken(me.token); pushSyncAuth(); }
      if (me?.role) cacheRole(me.role);
      // Tag the local session cache with whoever is actually signed in. Covers the
      // case a login never does: a persisted valid token skips the login screen
      // entirely, so without this an untagged cache would be discarded the next
      // time this same person signed in explicitly.
      if (me?.email) setLocalSessionsOwner(me.email.trim().toLowerCase());
      // Settle any stop we couldn't post while our token was being rejected. A 409
      // ("already stopped") is just as final as a 200, so both clear the debt; only
      // a network failure leaves it queued for the next attempt.
      void drainPendingStops();
      if (me?.dailyTargetMinutes != null) setDayTarget(me.dailyTargetMinutes * 60);
      if (me?.weeklyTargetMinutes != null) setWeekTarget(me.weeklyTargetMinutes * 60);
      // Refresh the capture policy here too, not only after a session registers.
      // Previously the only refresh lived in registerSession(), so a change an
      // admin made (blur, capture frequency) did not reach this client until the
      // session AFTER next — and never at all for someone who stopped tracking.
      api<{ screenshotsPerBlock: number; blurScreenshots: boolean; idleTimeoutMinutes: number }>("/orgs/settings")
        .then(cacheOrgSettings)
        .catch(() => { /* offline — the cached policy stands */ });
      setLastUpdated(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
      if (p[0] && !projectId) setProjectId(p[0].id);
      // Resume a genuinely-open session (e.g. after a crash) — but never when we
      // already have a live local session, and never a session we just stopped.
      //
      // "Genuinely open" now means the server still considers it alive. This used
      // to be `!x.endedAt` alone, which adopted ANY open row and then seeded the
      // timer with raw wall-clock since `startedAt` — so opening the app on
      // Wednesday silently resumed Monday evening's session with 39 hours already
      // on the clock, and pressing Start banked all of it. An abandoned row is
      // offered instead (see `orphan` below), never resumed behind the user's back.
      //
      // Most recent first, not `find`: with more than one open row, adopting an
      // arbitrary one leaves the others accruing (plans/checklist.md §1.5).
      const openCandidates = s
        .filter((x) => !x.endedAt && !stoppedIds.current.has(x.id))
        .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
      const open = openCandidates.find(isLive);
      const orphan = openCandidates.find((x) => !isLive(x));
      // An unfinished session from a previous run: ask, don't assume. Skipped
      // while something is already tracking — the prompt would be about a row the
      // takeover on the next start will close anyway.
      setOrphanSession(orphan && !activeRef.current && !open ? orphan : null);
      if (open && !activeRef.current) {
        setActive(open); setProjectId(open.projectId); if (open.taskId) setTaskId(open.taskId);
        // Restart native capture for the resumed session, seeding the timer from
        // the server start time (without this the timer counted from 0 and
        // nothing was captured on resume).
        const cfg = getCachedOrgSettings();
        const baseElapsedSecs = Math.max(0, Math.floor((Date.now() - new Date(open.startedAt).getTime()) / 1000));
        invoke("begin_capture", {
          token: getToken() ?? "", backend: API_BASE, sessionId: open.id,
          screenshotsPerBlock: cfg.perBlock, blur: cfg.blur, idleMinutes: cfg.idleMinutes, baseElapsedSecs,
        })
          .then(() => { setCaptureFailed(false); return invoke("set_tracking_indicator", { active: true }); })
          .catch((e) => {
            console.error("[capture] begin_capture failed on resume:", e);
            setCaptureFailed(true);
            notify("TraxStaff", "Monitoring didn't start — your time is counting, but no screenshots or activity are being recorded.");
          });
        beginHeartbeat(open.id);
      }
    } catch (e) { setError(e instanceof Error ? e.message : "Failed to load"); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  useEffect(() => { invoke<string>("get_device_id").then((id) => (deviceId.current = id)).catch(() => {}); load(); loadLocalShots(); /* eslint-disable-next-line */ }, []);

  // Rust drives the timer via trax:tick (monotonic, survives sleep/minimize).
  // In browser-preview (no Tauri) fall back to a local clock; and on focus we
  // hard-correct from Rust in case the webview throttled the tick stream.
  useEffect(() => {
    // Away spans belong to one session's timer. Clearing them alongside `elapsed`
    // keeps the two consistent: Rust resets its own deduction in begin(), so a
    // leftover span here would subtract from a window it no longer applies to.
    if (!active) { elapsedAnchor.current = null; setElapsed(0); setAwaySpans([]); return; }
    const startMs = new Date(active.startedAt).getTime();
    // Clamped: a startedAt slightly in the future (clock skew) must not show a
    // negative or backwards-running timer.
    const anchorTo = (secs: number) => {
      elapsedAnchor.current = { secs, at: performance.now() };
      setElapsed(secs);
    };
    // Clamped: a startedAt slightly in the future (clock skew) must not show a
    // negative or backwards-running timer.
    const localTick = () => anchorTo(Math.max(0, (Date.now() - startMs) / 1000));
    const correct = () => invoke<number>("get_elapsed").then((s) => { if (s > 0) anchorTo(s); }).catch(localTick);
    correct();
    // Local interpolation between Rust ticks so the display is smooth at 1 Hz.
    // Measured from the last authoritative anchor via performance.now() (a
    // monotonic browser clock) rather than blindly adding 1 — a blind +1 races
    // trax:tick and makes the clock jump forward then snap back each second.
    const id = setInterval(() => {
      const a = elapsedAnchor.current;
      if (a) setElapsed(a.secs + (performance.now() - a.at) / 1000);
    }, 1000);
    const onWake = () => correct();
    document.addEventListener("visibilitychange", onWake);
    window.addEventListener("focus", onWake);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onWake);
      window.removeEventListener("focus", onWake);
    };
  }, [active]);

  function beginHeartbeat(id: string) { stopHeartbeat(); heartbeat.current = setInterval(() => { api(`/sessions/${id}/heartbeat`, { method: "POST" }).catch(() => {}); }, 60_000); }
  function stopHeartbeat() { if (heartbeat.current) clearInterval(heartbeat.current); heartbeat.current = null; }

  // LOCAL-FIRST start: the session id is generated on-device and tracking +
  // capture begin immediately with NO network. Works fully offline; the server
  // session is registered in the background purely so uploads have a home.
  async function start(pid?: string) {
    const useProject = pid ?? projectId;
    if (!useProject) return;
    // Same project already tracking → no-op; a different one → switch cleanly.
    if (activeRef.current) {
      if (activeRef.current.projectId === useProject) return;
      await stop();
    }
    setError(null);
    setProjectId(useProject);
    const proj = projects.find((p) => p.id === useProject);
    const taskForSession = (pid ? proj?.tasks?.find((t) => t.status !== "done")?.id : taskId) || undefined;
    const sid = newSessionId();
    const startedAt = new Date().toISOString();
    setShotCount(0);
    showToast(`Tracking ${proj?.name ?? "project"}`);
    if (reminders.current.timer) notify("TraxStaff", `Started timer for project ${proj?.name ?? "project"}`);
    // Timer starts now, off the local monotonic clock — never waits on Render.
    setAwaySpans([]);
    setActive({
      id: sid, projectId: useProject, taskId: taskForSession ?? null, startedAt, endedAt: null,
      project: { id: useProject, name: proj?.name ?? "Project", clientTag: proj?.clientTag ?? null },
    });
    const s = getCachedOrgSettings();
    invoke("begin_capture", {
      token: getToken() ?? "", backend: API_BASE, sessionId: sid,
      screenshotsPerBlock: s.perBlock, blur: s.blur, idleMinutes: s.idleMinutes, baseElapsedSecs: 0,
    })
      .then(() => {
        setCaptureFailed(false);
        return invoke("set_tracking_indicator", { active: true });
      })
      .catch((e) => {
        // The timer still runs — but nothing is being captured. Previously this
        // was swallowed, so the UI claimed "Tracking · screenshots on" while
        // taking zero screenshots and recording zero activity.
        console.error("[capture] begin_capture failed:", e);
        setCaptureFailed(true);
        notify("TraxStaff", "Monitoring didn't start — your time is counting, but no screenshots or activity are being recorded.");
      });
    void registerSession(sid, useProject, taskForSession, startedAt);
  }

  // Register the locally-started session with the server (background, retried).
  // Not required for tracking — only so the queued data has somewhere to sync.
  async function registerSession(sid: string, useProject: string, taskForSession: string | undefined, startedAt: string) {
    if (registerTimer.current) { clearTimeout(registerTimer.current); registerTimer.current = null; }
    try {
      const appVersion = await getAppVersion();
      await api<Session>("/sessions/start", { method: "POST", body: JSON.stringify({ id: sid, startedAt, projectId: useProject, taskId: taskForSession, deviceId: deviceId.current ?? undefined, platform: "windows", appVersion }) });
      if (activeRef.current?.id === sid) {
        beginHeartbeat(sid);
      } else {
        // The user stopped/switched while registration was in flight — close the
        // just-created session now so it doesn't linger open forever server-side.
        api(`/sessions/${sid}/stop`, { method: "POST", body: JSON.stringify({ endReason: "stopped" }) }).catch(() => {});
      }
      api<{ screenshotsPerBlock: number; blurScreenshots: boolean; idleTimeoutMinutes: number }>("/orgs/settings").then(cacheOrgSettings).catch(() => {});
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/another device/i.test(msg)) {
        setError("A session is already running on another device. Stop it there first.");
        notify("TraxStaff", "A session is already running on another device — stop it there first.");
        await stop();
        return;
      }
      // Offline / backend asleep — keep tracking locally and retry registration.
      if (activeRef.current?.id === sid) {
        registerTimer.current = setTimeout(() => {
          if (activeRef.current?.id === sid) registerSession(sid, useProject, taskForSession, startedAt);
        }, 20_000);
      }
    }
  }

  /**
   * Check for an update because the user asked, from the footer button.
   *
   * Unlike the tray path this raises the normal prompt instead of installing on the
   * spot — the window is by definition open and focused here, so there is somewhere
   * to show "what's new" and the choice belongs to them. Always answers something:
   * an update check that appears to do nothing is indistinguishable from a broken
   * one, which is how people end up stranded on old builds.
   */
  async function checkForUpdates() {
    if (checkingUpdate) return; // double-click guard; the check takes a moment
    setCheckingUpdate(true);
    setError(null);
    try {
      const found = await findUpdate(false);
      if (found.status === "available") {
        window.dispatchEvent(new CustomEvent(UPDATE_FOUND_EVENT, { detail: found.update }));
      } else if (found.status === "current") {
        showToast(`You're on the latest version (${found.version})`);
      } else {
        setError("Couldn't check for updates. Check your connection.");
      }
    } finally {
      setCheckingUpdate(false);
    }
  }

  /**
   * Post the stops we owe from a 401, oldest first.
   *
   * `abrupt_exit`, not `stopped`: the app was signed out from under the session
   * rather than stopped by the member. The server finalizes it at the last evidence
   * of life, so a stop arriving hours late credits the work that actually happened,
   * not the gap since.
   */
  async function drainPendingStops() {
    const pending = loadPendingStops();
    if (pending.length === 0) return;
    const unsettled: string[] = [];
    for (const id of pending) {
      try {
        await api(`/sessions/${id}/stop`, { method: "POST", body: JSON.stringify({ endReason: "abrupt_exit" }) });
      } catch (e) {
        // 404 (gone) and 409 (already stopped) are both settled. Anything else —
        // offline, 5xx — stays queued.
        const status = e instanceof ApiError ? e.status : 0;
        if (status !== 404 && status !== 409) unsettled.push(id);
      }
    }
    savePendingStops(unsettled);
  }

  /**
   * Resolve an unfinished session found at startup.
   *
   * Both answers close the row — the question is only what it should be credited
   * with, and neither answer may ever credit the hours the app was not running.
   *
   * `keep`  → the work up to the last evidence the tracker was alive. That is what
   *           the server already computed as `effectiveEndAt`, so posting a plain
   *           stop is enough: the takeover/sweep logic finalizes it there, not at
   *           `now`.
   * discard → nothing. The row is closed at its own start, so it contributes zero.
   *
   * Either way it goes into `stoppedIds` so a `load()` racing this can't re-offer
   * or re-adopt it.
   */
  async function resolveOrphan(keep: boolean) {
    const o = orphanSession;
    setOrphanSession(null);
    if (!o) return;
    stoppedIds.current.add(o.id);
    rememberStoppedId(o.id);
    try {
      await api(`/sessions/${o.id}/stop`, {
        method: "POST",
        body: JSON.stringify({ endReason: "abrupt_exit", discard: !keep }),
      });
      showToast(keep ? "Unfinished session kept" : "Unfinished session discarded");
    } catch {
      // Offline: the server-side sweeper closes it at the same instant we would
      // have, so nothing is lost by failing quietly here.
      showToast("We'll finish tidying that up when you're back online");
    }
    load();
  }

  // LOCAL-FIRST stop: end the timer + capture instantly (capture finalizes to the
  // local queue, no network); the server is told in the background.
  async function stop() {
    const cur = activeRef.current;
    if (!cur) return;
    if (cur.id) stoppedIds.current.add(cur.id); // guard load() from re-adopting it
    if (registerTimer.current) { clearTimeout(registerTimer.current); registerTimer.current = null; }
    await invoke("end_capture").catch(() => {}); // fast + local; awaited so a following start() can't race it
    invoke("set_tracking_indicator", { active: false }).catch(() => {});
    stopHeartbeat();
    // Record the finished session locally so its time keeps counting toward the
    // total even before it syncs (deduped against the server copy by id).
    const finished: Session = { ...cur, endedAt: new Date().toISOString() };
    setLocalSessions((prev) => { const next = mergeSessions([], [...prev, finished]); saveLocalSessions(next); return next; });
    setActive(null); setElapsed(0);
    showToast("■ Stopped");
    if (reminders.current.timer) notify("TraxStaff", `Stopped timer for project ${cur.project?.name ?? "project"}`);
    if (cur.id) {
      api(`/sessions/${cur.id}/stop`, { method: "POST", body: JSON.stringify({ endReason: "stopped" }) }).catch(() => {});
    }
    load();
  }
  // Signing out stops tracking first — otherwise the session stays open on the
  // server and the timer would resume the next time you sign in.
  async function signOut() {
    if (activeRef.current) { try { await stop(); } catch { /* stop best-effort */ } }
    clearToken();
    // Cache kept — it is owner-tagged, and the next sign-in clears it if the
    // person changes. See clearLocalSessionsCacheUnless().
    pushSyncAuth(); // clear the sync engine's credentials
    onLogout();
  }

  // Save a note against the running session (queued server-side; offline notes
  // simply fail here — they're a convenience, not tracked time).
  async function saveNote(body: string) {
    const id = activeRef.current?.id;
    if (!id || !body.trim()) { setNoteOpen(false); return; }
    try { await api(`/sessions/${id}/notes`, { method: "POST", body: JSON.stringify({ body: body.trim() }) }); load(); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not save note"); }
    setNoteOpen(false);
  }

  function updateReminders(next: Partial<ReminderPrefs>) {
    const merged = { ...reminders.current, ...next };
    reminders.current = merged;
    setRemPrefs(merged);
    try { localStorage.setItem("trax_reminders", JSON.stringify(merged)); } catch { /* ignore */ }
  }

  /**
   * Answer the away-time prompt.
   *
   * The away stretch is ALREADY off the clock and already recorded as an
   * IdleDiscard by the time this runs, so the two answers are:
   *
   * discard → confirm. Nothing to do but re-sync; the deduction stands. If the
   *           POST at detection failed (offline), retry it here.
   * keep    → undo. Credit the seconds back to the local timer and delete the
   *           server-side discard.
   *
   * Inverted from how this used to work, where the time was kept unless the member
   * objected — and an unanswered prompt auto-kept after an hour, silently billing
   * a lunch break or an overnight suspend. Time is now credited only by an explicit
   * Keep. Never touches the activity hash-chain either way.
   */
  async function resolveIdle(discard: boolean) {
    const p = idlePrompt;
    setIdlePrompt(null);
    setResumed(null); // dismiss the associated wake-from-sleep banner if any
    const cur = activeRef.current;
    if (!p || !cur) return;
    try {
      if (discard) {
        // Idempotent server-side on the exact span, so re-posting is safe.
        await api("/sync/discard-idle", { method: "POST", body: JSON.stringify({ sessionId: cur.id, fromISO: p.fromISO, toISO: p.toISO }) });
        if (reminders.current.idle) notify("TraxStaff", `Discarded ~${p.minutes} min of idle time`);
      } else {
        // Local first: the member sees the clock jump back immediately even if the
        // network call fails, and Rust is the source of truth for the timer.
        await invoke("keep_away_time", { secs: p.deductedSecs ?? 0 }).catch(() => {});
        const fromMs = new Date(p.fromISO).getTime();
        const toMs = new Date(p.toISO).getTime();
        setAwaySpans((prev) => prev.filter((s) => !(s.fromMs === fromMs && s.toMs === toMs)));
        await api("/sync/keep-idle", { method: "POST", body: JSON.stringify({ sessionId: cur.id, fromISO: p.fromISO, toISO: p.toISO }) });
        if (reminders.current.idle) notify("TraxStaff", `Kept ~${p.minutes} min of away time`);
      }
      load();
    } catch {
      // Best-effort: the local decision has already been applied, and the server
      // copy converges on the next successful call.
    }
  }

  // Server + local sessions, deduped by id, limited to this week. This is what
  // every total below is computed from, so local/offline time always counts.
  const mergedWeek = useMemo(() => {
    // Kept by overlap, not by start instant: a session that began before the
    // week boundary and ran past it still owns time inside this week, and
    // filtering on startedAt discarded all of it.
    const weekStartMs = startOfWeek().getTime();
    const nowMs = Date.now();
    return mergeSessions(week, localSessions).filter((s) => overlapSecs(s, weekStartMs, nowMs) > 0);
  }, [week, localSessions]);
  // Completed sessions (exclude the live one — its time is added via `elapsed`,
  // and it may also appear as an open row once it has registered server-side).
  const notActive = (s: Session) => !active || s.id !== active.id;
  // Re-read every render. `elapsed` ticks once a second while tracking, so these
  // windows are re-evaluated continuously — which is what actually rolls the
  // total over the moment the clock passes 00:00.
  const nowMs = Date.now();
  const dayStartMs = startOfToday().getTime();
  const weekStartMs = startOfWeek().getTime();

  const today = mergedWeek.filter((s) => notActive(s) && overlapSecs(s, dayStartMs, nowMs) > 0);
  const workedToday = mergedWeek.filter(notActive).reduce((a, s) => a + overlapSecs(s, dayStartMs, nowMs), 0);
  const workedWeekClosed = mergedWeek.filter(notActive).reduce((a, s) => a + overlapSecs(s, weekStartMs, nowMs), 0);

  // The live session's DURATION still comes from the monotonic counter — the
  // wall clock is only consulted to work out how much of that duration predates
  // the boundary. Deriving it from wall-clock arithmetic instead would hand back
  // the clock-tampering hole the monotonic anchor exists to close.
  const activeStartMs = active ? new Date(active.startedAt).getTime() : 0;
  /** Seconds of away time deducted from the live session that fall inside a window. */
  const awayInWindow = (fromMs: number, toMs: number) =>
    awaySpans.reduce(
      (a, s) => a + Math.max(0, Math.min(s.toMs, toMs) - Math.max(s.fromMs, fromMs)) / 1000,
      0
    );
  const awayTotal = awaySpans.reduce((a, s) => a + s.secs, 0);
  /**
   * The part of the live session that belongs after `boundaryMs`.
   *
   * `elapsed` arrives already net of away time, and a single number can't say when
   * that time was — so the away deduction has to be re-applied per window rather
   * than assumed to sit after the boundary. Add the total back to recover the raw
   * monotonic duration, cut it at the boundary, then subtract only the absence that
   * actually falls inside the window.
   *
   * Without this, a session running from 22:00 through an overnight suspend had the
   * entire night deducted from *today*, and today read hours short.
   */
  const activeSince = (boundaryMs: number) => {
    if (!active) return 0;
    const rawSinceBoundary =
      elapsed + awayTotal - Math.max(0, (boundaryMs - activeStartMs) / 1000);
    return Math.max(0, rawSinceBoundary - awayInWindow(boundaryMs, nowMs));
  };

  const liveToday = workedToday + activeSince(dayStartMs);
  const workedWeek = workedWeekClosed + activeSince(weekStartMs);

  async function toggleExpand() {
    const next = !expanded;
    setExpanded(next);
    try {
      const { getCurrentWindow, LogicalSize } = await import("@tauri-apps/api/window");
      const win = getCurrentWindow();
      await win.setSize(new LogicalSize(next ? 1120 : 400, next ? 720 : 680));
    } catch {
      /* browser preview — CSS handles it */
    }
  }

  trayHandlers.current = {
    start: () => start(),
    stop: () => stop(),
    note: () => { if (activeRef.current) setNoteOpen(true); },
    signout: () => { signOut(); },
    dashboard: () => { if (!expanded) toggleExpand(); },
    // Tray "Check for updates" installs directly: the window is usually hidden
    // when the tray is used, so a dialog nobody can see would be a dead end.
    updates: async () => {
      const found = await findUpdate(false);
      if (found.status === "available") await installUpdateNow();
      else if (found.status === "current") setError("You're on the latest version.");
      else setError("Couldn't check for updates. Check your connection.");
    },
  };

  return (
    <div className={`app-shell ${expanded ? "is-expanded" : "is-collapsed"}`}>
      {/* Exit: three-way dialog instead of silently dropping unsynced records. */}
      {closeInfo && (
        <div className="close-overlay">
          <div className="close-dialog">
            {closingRemaining !== null ? (
              <>
                <div className="close-spinner" />
                <h3 className="close-title">Uploading your data…</h3>
                <p className="close-sub">Saving tracked time before closing.</p>
                <div className="close-remaining">Records remaining: <strong>{closingRemaining}</strong></div>
              </>
            ) : (
              <>
                <h3 className="close-title">Close TraxStaff?</h3>
                <p className="close-sub">
                  {closeInfo.capturing ? "A timer is still running. " : ""}
                  {closeInfo.pending > 0 ? `${closeInfo.pending} record${closeInfo.pending > 1 ? "s" : ""} haven't synced yet.` : "Your tracked time will be saved."}
                </p>
                <div className="close-actions">
                  <button className="close-primary" onClick={closeStopAndSync}>Stop &amp; sync</button>
                  <button className="close-ghost" onClick={closeQuitAnyway}>Quit anyway</button>
                  <button className="close-cancel" onClick={closeCancel}>Cancel</button>
                </div>
                {closeInfo.pending > 0 && <p className="close-fine">“Quit anyway” keeps your records — they upload next time you open TraxStaff.</p>}
              </>
            )}
          </div>
        </div>
      )}

      {/* An unfinished session from a previous run.
          Shown INSTEAD of resuming it, which is what the app used to do silently —
          adopting Monday evening's abandoned session on Wednesday morning and
          putting 39 hours on the clock before anyone had pressed anything. Both
          answers close the row; the only question is whether the work up to the
          last sign of life counts. */}
      {orphanSession && !active && (
        <div className="idle-banner">
          <span>
            We found an unfinished session on {orphanSession.project?.name ?? "a project"} from{" "}
            {fmtD(orphanSession.startedAt)} at {fmtT(orphanSession.startedAt)} — TraxStaff closed
            before it could stop. Keep the {fmtShort(secs(orphanSession))} it recorded?
          </span>
          <div className="idle-actions">
            <button className="idle-keep" onClick={() => resolveOrphan(true)}>Keep it</button>
            <button className="idle-stop" onClick={() => resolveOrphan(false)}>Discard</button>
          </div>
        </div>
      )}

      {/* Idle keep/discard prompt on return from being away or waking from sleep.
          Prioritize this over the informational "woke from sleep" banner since
          this one is actionable and covers both idle + sleep scenarios. */}
      {/* The away time is already OFF the clock — the wording has to say so, or
          "Keep" reads as "leave things as they are" when it actually adds time
          back. */}
      {idlePrompt && active && (
        <div className="idle-banner">
          <span>
            You were away for ~{idlePrompt.minutes} min, so it&rsquo;s not counted. Add it back?
          </span>
          <div className="idle-actions">
            <button className="idle-keep" onClick={() => resolveIdle(false)}>Add it back</button>
            <button className="idle-stop" onClick={() => resolveIdle(true)}>Leave it out</button>
          </div>
        </div>
      )}

      {/* Machine woke from sleep (informational only — the actionable keep/discard
          prompt above handles the accounting decision). Hidden when the idle prompt
          is showing to avoid duplicate alerts. */}
      {resumed !== null && active && !idlePrompt && (
        <div className="idle-banner">
          <span>Your computer was asleep for ~{resumed} min — that time isn&rsquo;t counted.</span>
          <div className="idle-actions">
            <button className="idle-keep" onClick={() => setResumed(null)}>Keep tracking</button>
            <button className="idle-stop" onClick={() => { setResumed(null); stop(); }}>Stop</button>
          </div>
        </div>
      )}

      {/* Informational: currently idle (the actionable prompt shows on return). */}
      {idleBanner !== null && active && !idlePrompt && (
        <div className="warn-banner subtle">You appear to be away (~{idleBanner} min idle).</div>
      )}

      {/* The native capture engine refused to start. Time is being counted but
          NOTHING is being recorded — this must never be silent. */}
      {captureFailed && active && (
        <div className="warn-banner">
          Monitoring didn&rsquo;t start — your time is counting, but no screenshots or activity are being recorded. Restart TraxStaff to retry.
        </div>
      )}

      {/* Activity sampling unavailable (input hook dead) — time still counts. */}
      {!hookOk && active && !captureFailed && (
        <div className="warn-banner">Activity tracking is unavailable — your time still counts, but activity % will read 0.</div>
      )}

      {/* Screenshot capture failing (e.g. no display / denied) — time still counts. */}
      {!shotsOk && active && (
        <div className="warn-banner">Screenshots couldn&rsquo;t be captured on this screen — time and activity still record.</div>
      )}

      {/* Transient action toast (tracking started/stopped/switched, screenshot). */}
      <AnimatePresence>
        {toast && (
          <motion.div
            className="toast" initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
          >
            {toast}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Add a note to the running session. */}
      <AnimatePresence>
        {noteOpen && <NoteModal onSave={saveNote} onClose={() => setNoteOpen(false)} />}
      </AnimatePresence>

      <aside className="widget-pane">
        <TrackingWidget
          projects={projects} projectId={projectId}
          active={active} workedToday={liveToday} workedWeek={workedWeek}
          dayTarget={dayTarget} weekTarget={weekTarget}
          today={today} elapsed={elapsed} onStart={start} onStop={stop} error={error}
          onSignOut={() => { void signOut(); }}
          onRefresh={load} lastUpdated={lastUpdated} expanded={expanded} onToggleExpand={toggleExpand}
          sync={sync} onAddNote={() => setNoteOpen(true)}
          settingsOpen={settingsOpen} onToggleSettings={() => setSettingsOpen((s) => !s)}
          reminders={remPrefs} onUpdateReminders={updateReminders}
          shotCount={shotCount}
          onCheckUpdates={() => { void checkForUpdates(); }} checkingUpdate={checkingUpdate}
        />
      </aside>
      {expanded && (
        <main className="dash-pane">
          <DashNav tab={tab} setTab={setTab} onSignOut={signOut} />
          <div className="dash-scroll">
            {tab === "dashboard" && <DesktopDashboard projects={projects} week={mergedWeek} workedWeek={workedWeek} weekTarget={weekTarget} onViewActivity={() => setTab("activity")} />}
            {tab === "timesheets" && <TimesheetsPage week={mergedWeek} />}
            {tab === "activity" && <ActivityPage />}
            {tab === "reports" && <ReportsPage week={mergedWeek} />}
            {tab === "projects" && <ProjectsPageDesktop projects={projects} onChange={load} />}
          </div>
        </main>
      )}
    </div>
  );
}

function TrackingWidget(props: {
  projects: Project[]; projectId: string;
  active: Session | null; workedToday: number; workedWeek: number; today: Session[];
  dayTarget: number; weekTarget: number;
  /** Live seconds on the running session — added to the active project's own total. */
  elapsed: number;
  onStart: (pid?: string) => void; onStop: () => void; error: string | null; onSignOut: () => void;
  onRefresh: () => void; lastUpdated: string | null; expanded: boolean; onToggleExpand: () => void;
  sync: SyncState | null; onAddNote: () => void;
  settingsOpen: boolean; onToggleSettings: () => void;
  reminders: ReminderPrefs; onUpdateReminders: (n: Partial<ReminderPrefs>) => void;
  shotCount: number;
  onCheckUpdates: () => void; checkingUpdate: boolean;
}) {
  const { projects, active, workedToday, workedWeek, today, dayTarget, weekTarget, elapsed, onStart, onStop, error, onRefresh, lastUpdated, expanded, onToggleExpand, sync, onAddNote, settingsOpen, onToggleSettings, reminders, onUpdateReminders, shotCount, onCheckUpdates, checkingUpdate } = props;
  const [q, setQ] = useState("");

  // This project's time TODAY.
  //
  // By overlap, not `secs(s)`. `today` holds every session that overlaps today —
  // including one that began yesterday and ran through midnight — and summing
  // whole durations charged all of that to today. A session left open on Monday
  // and closed on Wednesday put its entire 39h50m on this row, which is where the
  // "39:57:14" against a project came from.
  const dayStartMs = startOfToday().getTime();
  const nowMs = Date.now();
  const secsToday = (pid: string) =>
    today
      .filter((s) => s.projectId === pid)
      .reduce((a, s) => a + overlapSecs(s, dayStartMs, nowMs), 0);

  const list = projects
    .filter((p) => !p.archivedAt && p.name.toLowerCase().includes(q.toLowerCase()))
    // active project first, then by today's time
    .sort((a, b) => (a.id === active?.projectId ? -1 : b.id === active?.projectId ? 1 : secsToday(b.id) - secsToday(a.id)));

  return (
    <div className="widget">
      <div className="widget-brand"><img src="/brand/icon-badge.svg" alt="TraxStaff" className="brand-mark" /></div>

      {/* Today's total, Hubstaff-style — not the session clock. It rolls over at
          local midnight; see the minute ticker in Tracker(). */}
      <CircularTimer seconds={workedToday} targetSeconds={dayTarget} active={Boolean(active)} onToggle={() => (active ? onStop() : onStart())} />

      {active && (
        <div className="track-chip">
          <span className="track-dot" /> Tracking · screenshots on{shotCount > 0 ? ` · ${shotCount} this session` : ""}
        </div>
      )}

      {/* The ring above IS today's total, and it resets at midnight. "Tracked
          today" used to sit here repeating it digit for digit, so the two could
          never disagree — which is exactly why cross-checking them revealed
          nothing when a phantom session was inflating both. "This session" is the
          live clock instead: a session total that disagrees with the day total is
          now visible on sight. */}
      <div className="widget-stats">
        <div className="ws-item"><span className="wm-label">This week</span><span className="wm-val">{fmtClock(workedWeek)}</span></div>
        <div className="ws-item">
          <span className="wm-label">This session</span>
          <span className="wm-val">{active ? fmtClock(elapsed) : "—"}</span>
        </div>
      </div>

      <div className="proj-search">
        <span className="proj-search-ico">⌕</span>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search projects" />
      </div>

      {error && <div className="error">{error}</div>}

      <div className="proj-list">
        {list.length === 0 && <div className="muted small proj-empty">No projects</div>}
        {list.map((p) => {
          const isActive = active?.projectId === p.id;
          return (
            <motion.div
              key={p.id}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              whileHover={{ x: isActive ? 0 : 2 }}
              className={`proj-row ${isActive ? "active" : ""}`}
              onClick={() => (isActive ? onStop() : onStart(p.id))}
            >
              <PlayStop active={isActive} />
              <span className="proj-name">{p.name}</span>
              {/* This project's own time — not the whole day's. The active row
                  adds the live elapsed on top of what it already logged today. */}
              <span className="proj-time tnum">
                {isActive ? fmtClock(secsToday(p.id) + elapsed) : fmtShort(secsToday(p.id)) || "0m"}
              </span>
            </motion.div>
          );
        })}
      </div>

      <SyncBadge sync={sync} />

      <div className="widget-foot">
        <button className="foot-refresh" onClick={onRefresh} title="Refresh">
          <span className="foot-refresh-ico">↻</span>
          {lastUpdated ? `Updated ${lastUpdated}` : "Refresh"}
        </button>
        {active && (
          <button className="foot-icon" onClick={onAddNote} title="Add a note" aria-label="Add a note">✎</button>
        )}
        {/* Check for updates. Until now this only existed in the tray menu, which is
            invisible to anyone using the window — so an update was something that
            happened to you, never something you could go and ask about. */}
        <button
          className={`foot-icon ${checkingUpdate ? "is-busy" : ""}`}
          onClick={onCheckUpdates}
          disabled={checkingUpdate}
          title={checkingUpdate ? "Checking for updates…" : "Check for updates"}
          aria-label={checkingUpdate ? "Checking for updates" : "Check for updates"}
        >
          <UpdateIcon />
        </button>
        <div className="foot-settings-wrap">
          <button className="foot-icon" onClick={onToggleSettings} title="Reminders" aria-label="Reminders">⚙</button>
          {settingsOpen && (
            <div className="foot-settings">
              <div className="foot-settings-title">Reminders</div>
              <label className="foot-toggle">
                <input type="checkbox" checked={reminders.idle} onChange={(e) => onUpdateReminders({ idle: e.target.checked })} />
                <span>Notify when I go idle while tracking</span>
              </label>
              <label className="foot-toggle">
                <input type="checkbox" checked={reminders.notTracking} onChange={(e) => onUpdateReminders({ notTracking: e.target.checked })} />
                <span>Remind me if I&rsquo;m not tracking (work hours)</span>
              </label>
              <label className="foot-toggle">
                <input type="checkbox" checked={reminders.screenshots} onChange={(e) => onUpdateReminders({ screenshots: e.target.checked })} />
                <span>Notify me when a screenshot is taken</span>
              </label>
              <label className="foot-toggle">
                <input type="checkbox" checked={reminders.timer} onChange={(e) => onUpdateReminders({ timer: e.target.checked })} />
                <span>Notify me when the timer starts or stops</span>
              </label>
              <label className="foot-toggle">
                <input type="checkbox" checked={reminders.sync} onChange={(e) => onUpdateReminders({ sync: e.target.checked })} />
                <span>Notify me about sync / connection problems</span>
              </label>
              <label className="foot-toggle">
                <input type="checkbox" checked={reminders.updates} onChange={(e) => onUpdateReminders({ updates: e.target.checked })} />
                <span>Notify me when an update is available</span>
              </label>
            </div>
          )}
        </div>
        <button className="foot-icon" onClick={onToggleExpand} title={expanded ? "Collapse" : "Expand"} aria-label={expanded ? "Collapse" : "Expand"}>
          <ChevronIcon dir={expanded ? "left" : "right"} />
        </button>
      </div>
    </div>
  );
}

// Sync status: green when synced, amber with a pending count when offline, red
// on a sync error (tooltip shows the reason).
function SyncBadge({ sync }: { sync: SyncState | null }) {
  if (!sync) return null;
  const cls = sync.lastError ? "err" : sync.pending > 0 ? "offline" : "ok";
  const label = sync.lastError
    ? "Sync error"
    : sync.pending > 0
      ? `Offline · ${sync.pending} pending`
      : sync.lastSyncedAt
        ? `Synced ${new Date(sync.lastSyncedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
        : "Synced";
  return (
    <div className={`sync-badge ${cls}`} title={sync.lastError ?? label}>
      <span className="sync-dot" />
      <span className="sync-label">{label}</span>
    </div>
  );
}

// Add-a-note modal for the running session.
function NoteModal({ onSave, onClose }: { onSave: (body: string) => void; onClose: () => void }) {
  const [body, setBody] = useState("");
  return (
    <motion.div className="note-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <motion.div
        className="note-modal"
        initial={{ scale: 0.96, y: 8 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.96, y: 8 }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="note-title">Add a time note</h3>
        <textarea
          className="note-input" autoFocus maxLength={500} value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="What are you working on?"
        />
        <div className="note-actions">
          <button className="note-cancel" onClick={onClose}>Cancel</button>
          <button className="note-save" onClick={() => onSave(body)} disabled={!body.trim()}>Save note</button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// Morphing play ⇄ stop control with a soft pulse while active.
function PlayStop({ active }: { active: boolean }) {
  return (
    <span className={`playstop ${active ? "on" : ""}`}>
      {active && <motion.span className="playstop-pulse" animate={{ scale: [1, 1.6], opacity: [0.5, 0] }} transition={{ duration: 1.6, repeat: Infinity, ease: "easeOut" }} />}
      <motion.svg width="14" height="14" viewBox="0 0 14 14" initial={false}>
        {active ? (
          <motion.rect key="stop" x="3" y="3" width="8" height="8" rx="2" fill="currentColor" initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} />
        ) : (
          <motion.path key="play" d="M4 2.5v9l7-4.5z" fill="currentColor" initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} />
        )}
      </motion.svg>
    </span>
  );
}

const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function DesktopDashboard({ projects, week, workedWeek, weekTarget, onViewActivity }: { projects: Project[]; week: Session[]; workedWeek: number; weekTarget: number; onViewActivity: () => void }) {
  const [name, setName] = useState("");
  const [avgActivity, setAvgActivity] = useState<number | null>(null);
  const [activeSecs, setActiveSecs] = useState<number | null>(null);
  const [shots, setShots] = useState<{ id: string; url: string | null; activityPct: number; project: string }[]>([]);

  useEffect(() => {
    api<{ email: string }>("/auth/me").then((u) => setName(u.email.split("@")[0])).catch(() => {});
    api<{ avgActivityPct: number | null; activitySeconds: number }>(`/reports/summary?from=${startOfWeek().toISOString()}`)
      .then((s) => {
        setAvgActivity(s.avgActivityPct);
        setActiveSecs(s.activitySeconds);
      })
      .catch(() => {});
    // Ask for exactly the six tiles this strip shows — the endpoint is paginated,
    // so there's no reason to pull (and presign) a whole week of URLs for them.
    api<{ items: typeof shots }>(`/screenshots?from=${startOfWeek().toISOString()}&limit=6`)
      .then((r) => setShots(r.items))
      .catch(() => {});
  }, [week]);

  // Hours per weekday, split across the days a session actually spans.
  //
  // This used to charge `secs(s)` entirely to the day the session STARTED. With a
  // session running from Monday evening to Wednesday morning, that put ~40 hours on
  // a single Monday bar and left Tuesday and Wednesday empty — the spike-then-flat
  // shape in the performance chart. A day boundary is not a bucketing detail here;
  // it is the whole point of a per-day chart.
  const daily = useMemo(() => {
    const days = new Array(7).fill(0);
    const base = startOfWeek().getTime();
    const nowMs = Date.now();
    for (let i = 0; i < 7; i++) {
      const from = base + i * 86400000;
      const to = Math.min(from + 86400000, nowMs);
      if (to <= from) continue;
      for (const s of week) days[i] += overlapSecs(s, from, to) / 3600;
    }
    return days;
  }, [week]);

  const perProject = useMemo(() => {
    const by = new Map<string, { name: string; secs: number; last: number }>();
    const weekStartMs = startOfWeek().getTime();
    const nowMs = Date.now();
    for (const s of week) {
      const e = by.get(s.projectId) ?? { name: s.project.name, secs: 0, last: 0 };
      // Only this week's share — `week` now includes sessions that began before
      // the week and ran into it, so whole-session totals would import last
      // week's hours into this week's breakdown.
      e.secs += overlapSecs(s, weekStartMs, nowMs);
      // Last activity, used below to show a project as currently active. Bounded
      // by the server's view of the end, so an abandoned session doesn't leave a
      // project looking live indefinitely.
      e.last = Math.max(e.last, endMs(s));
      by.set(s.projectId, e);
    }
    return [...by.values()].sort((a, b) => b.secs - a.secs);
  }, [week]);

  const tasks = useMemo(() => {
    const all = projects.flatMap((p) => (p.tasks ?? []).map((t) => ({ ...t, project: p.name })));
    const rank = { in_progress: 0, todo: 1, done: 2 } as Record<string, number>;
    return all.sort((a, b) => (rank[a.status] ?? 3) - (rank[b.status] ?? 3)).slice(0, 6);
  }, [projects]);

  /* Straight from the server, which sums each activity block's own active
     portion. This used to be `workedWeek * (avgActivity / 100)`, which mixed two
     denominators: `avgActivity` is weighted over the seconds the tracker actually
     sampled, while `workedWeek` is session wall-clock computed here on the
     client. Blocks cover less ground than wall-clock, so applying the
     block-weighted percentage to the wall-clock total overstated activity time —
     that's why this tile could read higher than the time actually worked at the
     keyboard. Falls back to nothing rather than to `workedWeek`, which would
     claim 100% active. */
  const activitySecs = activeSecs;
  const activeProjects = projects.filter((p) => !p.archivedAt).length;
  const doneTasks = projects.reduce((a, p) => a + (p.tasks?.filter((t) => t.status === "done").length ?? 0), 0);

  return (
    <div className="dash">
      <div className="dash-greet">
        <div className="dash-greet-l">
          <span className="dash-avatar">{(name || "U").slice(0, 1).toUpperCase()}</span>
          <div>
            <div className="dash-hi">Welcome back, {name || "there"} <span className="wave">👋</span></div>
            <div className="muted small">Here&rsquo;s your week at a glance</div>
          </div>
        </div>
      </div>

      <div className="dash-stats">
        <DashStat label="Total working hours" value={fmtShort(workedWeek)} accent="brand" bars={daily} />
        <DashStat label="Activity time" value={activitySecs != null ? fmtShort(activitySecs) : "—"} accent="accent" sub={avgActivity != null ? `${avgActivity}% active` : undefined} />
        <DashStat label="Active projects" value={String(activeProjects)} accent="teal" />
        <DashStat label="Tasks completed" value={String(doneTasks)} accent="brand" />
      </div>

      <div className="dash-grid">
        <div className="dash-chart">
          <div className="dash-card-head"><span className="dc-label">Your performance</span><span className="muted small">This week · hours/day</span></div>
          <PerformanceChart daily={daily} />
          <div className="chart-x">{DOW.map((d) => <span key={d}>{d}</span>)}</div>
        </div>
        <div className="dash-gauge">
          <div className="dc-label mb">Weekly activity</div>
          <Gauge value={activitySecs ?? 0} max={weekTarget} centerLabel={activitySecs != null ? fmtShort(activitySecs) : "—"} />
          <div className="muted small center">of {fmtShort(weekTarget)} target</div>
        </div>
      </div>

      <div className="dash-heat">
        <div className="dash-card-head">
          <span className="dc-label">Recent activity</span>
          <button className="link-btn" onClick={onViewActivity}>View activity →</button>
        </div>
        {shots.length === 0 ? (
          <div className="muted small pad">No screenshots yet — they appear here while tracking.</div>
        ) : (
          <div className="recent-shots">
            {shots.map((s) => (
              <div className="recent-shot" key={s.id} onClick={onViewActivity}>
                {s.url ? <img src={s.url} alt="" /> : <div className="shot-empty">n/a</div>}
                <span className={`recent-shot-pct ${s.activityPct >= 50 ? "hi" : "lo"}`}>{Math.round(s.activityPct)}%</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="dash-heat">
        <div className="dc-label mb">Work by hours</div>
        <DashHeatmap week={week} />
      </div>

      <div className="dash-grid">
        <div className="dash-table">
          <div className="dash-card-head"><span className="dc-label">Tasks</span></div>
          {tasks.length === 0 && <div className="muted small pad">No tasks yet.</div>}
          {tasks.map((t) => (
            <div className="task-line" key={t.id}>
              <span className={`task-status ${t.status}`}>{t.status === "done" ? "◉" : t.status === "in_progress" ? "◐" : "○"}</span>
              <div className="task-line-body">
                <div className="task-line-title">{t.title}</div>
                <div className="muted small">{t.project}</div>
              </div>
              <span className={`chip-prio ${t.priority}`}>{t.priority}</span>
            </div>
          ))}
        </div>
        <div className="dash-table">
          <div className="dash-card-head"><span className="dc-label">Projects</span></div>
          {perProject.length === 0 && <div className="muted small pad">No tracked time this week.</div>}
          {perProject.slice(0, 6).map((p) => {
            const active = Date.now() - p.last < 6 * 60 * 1000;
            const pct = workedWeek ? Math.round((p.secs / workedWeek) * 100) : 0;
            return (
              <div className="proj-line" key={p.name}>
                <span className="proj-line-dot" style={{ background: active ? "#1f9d63" : "var(--border-strong, #c3cad9)" }} />
                <div className="proj-line-body">
                  <div className="proj-line-title">{p.name}</div>
                  <div className="proj-bar"><span style={{ width: `${pct}%` }} /></div>
                </div>
                <span className="muted small">{fmtShort(p.secs)}</span>
              </div>
            );
          })}
        </div>
      </div>

    </div>
  );
}

function DashStat({ label, value, sub, accent, bars }: { label: string; value: string; sub?: string; accent: "brand" | "accent" | "teal"; bars?: number[] }) {
  return (
    <div className="dash-card">
      <div className="dc-label">{label}</div>
      <div className="dc-value">{value}</div>
      {sub && <div className="dc-sub">{sub}</div>}
      {bars && <MiniBars data={bars} accent={accent} />}
    </div>
  );
}

function MiniBars({ data, accent }: { data: number[]; accent: string }) {
  const max = Math.max(1, ...data);
  const color = accent === "accent" ? "var(--accent)" : accent === "teal" ? "#12b5a5" : "var(--brand)";
  return (
    <div className="minibars">
      {data.map((v, i) => <span key={i} style={{ height: `${Math.max(8, (v / max) * 100)}%`, background: color }} />)}
    </div>
  );
}

function Gauge({ value, max, centerLabel }: { value: number; max: number; centerLabel: string }) {
  const pct = Math.max(0, Math.min(1, value / max));
  const w = 200, h = 110, cx = w / 2, cy = 100, r = 82, sw = 16;
  const a0 = Math.PI, a1 = Math.PI * (1 - pct); // left → up as pct grows
  const pt = (a: number) => [cx + r * Math.cos(a), cy - r * Math.sin(a)];
  const [sx, sy] = pt(Math.PI);
  const [ex, ey] = pt(a1);
  const large = pct > 0.5 ? 1 : 0;
  const [tx, ty] = pt(0);
  return (
    <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`}>
      <defs>
        <linearGradient id="gaugeGrad" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#3b5bff" /><stop offset="1" stopColor="#000065" />
        </linearGradient>
      </defs>
      <path d={`M ${sx} ${sy} A ${r} ${r} 0 0 1 ${tx} ${ty}`} fill="none" stroke="#eceef5" strokeWidth={sw} strokeLinecap="round" />
      {pct > 0.01 && <path d={`M ${sx} ${sy} A ${r} ${r} 0 ${large} 1 ${ex} ${ey}`} fill="none" stroke="url(#gaugeGrad)" strokeWidth={sw} strokeLinecap="round" />}
      <text x={cx} y={cy - 20} textAnchor="middle" className="gauge-val">{centerLabel}</text>
    </svg>
  );
}

function DashHeatmap({ week }: { week: Session[] }) {
  const HOURS = Array.from({ length: 11 }, (_, i) => 8 + i);
  const { grid, max } = useMemo(() => {
    const g: number[][] = HOURS.map(() => new Array(7).fill(0));
    const base = startOfWeek().getTime();
    for (const s of week) {
      let cur = new Date(s.startedAt);
      const end = s.endedAt ? new Date(s.endedAt) : new Date();
      while (cur < end) {
        const nxt = new Date(cur); nxt.setMinutes(60, 0, 0);
        const mins = (Math.min(end.getTime(), nxt.getTime()) - cur.getTime()) / 60000;
        const hi = HOURS.indexOf(cur.getHours());
        const di = Math.floor((new Date(cur).setHours(0, 0, 0, 0) - base) / 86400000);
        if (hi >= 0 && di >= 0 && di < 7) g[hi][di] += mins;
        cur = nxt;
      }
    }
    return { grid: g, max: Math.max(1, ...g.flat()) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [week]);
  return (
    <div className="heat-grid">
      <div />
      {DOW.map((d) => <div key={d} className="heat-dow">{d}</div>)}
      {HOURS.map((hr, hi) => (
        <span key={hr} style={{ display: "contents" }}>
          <div className="heat-hr">{hr}</div>
          {grid[hi].map((m, di) => {
            const a = m === 0 ? 0 : 0.18 + (m / max) * 0.82;
            return <div key={di} className="heat-cell" title={m > 0 ? `${DOW[di]} ${hr}:00 · ${Math.round(m)}m` : ""} style={{ background: m === 0 ? "var(--canvas)" : `color-mix(in srgb, var(--accent) ${Math.round(a * 100)}%, transparent)` }} />;
          })}
        </span>
      ))}
    </div>
  );
}

function PerformanceChart({ daily }: { daily: number[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const w = 640, h = 170; const max = Math.max(1, ...daily);
  const step = w / (daily.length - 1);
  const pts = daily.map((v, i) => [i * step, h - (v / max) * (h - 30) - 14]);
  const line = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" ");
  const area = `${line} L ${w} ${h} L 0 ${h} Z`;
  return (
    <div className="perf-wrap">
      <svg width="100%" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" onMouseLeave={() => setHover(null)}>
        <defs>
          <linearGradient id="perf" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#000065" stopOpacity="0.22" /><stop offset="1" stopColor="#000065" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill="url(#perf)" />
        <path d={line} fill="none" stroke="#000065" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        {pts.map((p, i) => (
          <g key={i} onMouseEnter={() => setHover(i)}>
            <rect x={i * step - step / 2} y={0} width={step} height={h} fill="transparent" />
            {hover === i && <>
              <circle cx={p[0]} cy={p[1]} r="4.5" fill="#000065" stroke="#fff" strokeWidth="2" />
              <line x1={p[0]} y1={p[1] + 6} x2={p[0]} y2={h} stroke="#000065" strokeOpacity="0.2" strokeDasharray="3 3" />
            </>}
          </g>
        ))}
      </svg>
      {hover != null && (
        <div className="perf-tip" style={{ left: `${(hover / (daily.length - 1)) * 100}%` }}>
          {DOW[hover]} · {fmtShort(daily[hover] * 3600)}
        </div>
      )}
    </div>
  );
}

// ---------- staff dashboard tabs (embedded in the app's right pane) ----------

const DASH_TABS: { id: DashTab; label: string }[] = [
  { id: "dashboard", label: "Dashboard" },
  { id: "timesheets", label: "Timesheets" },
  { id: "activity", label: "Activity" },
  { id: "reports", label: "Reports" },
  { id: "projects", label: "Projects" },
];

function DashNav({ tab, setTab, onSignOut }: { tab: DashTab; setTab: (t: DashTab) => void; onSignOut: () => void }) {
  return (
    <div className="dashnav">
      <div className="dashnav-tabs">
        {DASH_TABS.map((t) => (
          <button key={t.id} className={`dashnav-tab ${tab === t.id ? "on" : ""}`} onClick={() => setTab(t.id)}>
            {tab === t.id && <motion.span layoutId="navpill" className="dashnav-pill" transition={{ type: "spring", stiffness: 380, damping: 30 }} />}
            <span className="dashnav-label">{t.label}</span>
          </button>
        ))}
      </div>
      <button className="dash-logout" onClick={onSignOut}><PowerIcon /> Sign out</button>
    </div>
  );
}

function SubTabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: string }[]; value: T; onChange: (t: T) => void }) {
  return (
    <div className="subtabs">
      {tabs.map((t) => (
        <button key={t.id} className={`subtab ${value === t.id ? "on" : ""}`} onClick={() => onChange(t.id)}>{t.label}</button>
      ))}
    </div>
  );
}

// horizontal timeline bar for a single day (06:00 → 24:00 window)
function DayTimeline({ list }: { list: Session[] }) {
  const START_H = 6; // window start hour
  const SPAN = 24 - START_H;
  const segs = list.map((s) => {
    const st = new Date(s.startedAt);
    const en = s.endedAt ? new Date(s.endedAt) : new Date();
    const startH = st.getHours() + st.getMinutes() / 60;
    const endH = Math.min(24, en.getHours() + en.getMinutes() / 60 + (en.getDate() !== st.getDate() ? 24 : 0));
    const left = ((Math.max(START_H, startH) - START_H) / SPAN) * 100;
    const width = Math.max(1, ((Math.min(24, endH) - Math.max(START_H, startH)) / SPAN) * 100);
    return { id: s.id, left, width, manual: s.isManual };
  });
  return (
    <div className="ts-timeline">
      <div className="ts-tl-track">
        {segs.map((g) => (
          <span key={g.id} className={`ts-tl-seg ${g.manual ? "manual" : ""}`} style={{ left: `${g.left}%`, width: `${g.width}%` }} />
        ))}
      </div>
      <div className="ts-tl-ticks">
        {[6, 9, 12, 15, 18, 21, 24].map((h) => (
          <span key={h}>{h === 24 ? "12a" : h > 12 ? `${h - 12}p` : `${h}a`}</span>
        ))}
      </div>
    </div>
  );
}

type RangeKey = "today" | "yesterday" | "week" | "last7" | "month" | "lastmonth" | "custom";
function rangeFor(key: RangeKey, cf?: string, ct?: string): { from: Date; to: Date } {
  const now = new Date();
  const sod = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
  const eod = (d: Date) => { const x = new Date(d); x.setHours(23, 59, 59, 999); return x; };
  switch (key) {
    case "today": return { from: sod(now), to: eod(now) };
    case "yesterday": { const y = new Date(now); y.setDate(y.getDate() - 1); return { from: sod(y), to: eod(y) }; }
    case "week": return { from: startOfWeek(), to: eod(now) };
    case "last7": { const f = new Date(now); f.setDate(f.getDate() - 6); return { from: sod(f), to: eod(now) }; }
    case "month": return { from: sod(new Date(now.getFullYear(), now.getMonth(), 1)), to: eod(now) };
    case "lastmonth": return { from: sod(new Date(now.getFullYear(), now.getMonth() - 1, 1)), to: eod(new Date(now.getFullYear(), now.getMonth(), 0)) };
    case "custom": return { from: cf ? sod(new Date(cf)) : sod(now), to: ct ? eod(new Date(ct)) : eod(now) };
  }
}

// Responsive date-range filter: preset chips + a custom from/to picker.
function DateRangePicker({ value, custom, onChange }: {
  value: RangeKey; custom: { from?: string; to?: string };
  onChange: (k: RangeKey, from?: string, to?: string) => void;
}) {
  const presets: { k: RangeKey; label: string }[] = [
    { k: "today", label: "Today" }, { k: "yesterday", label: "Yesterday" }, { k: "week", label: "This week" },
    { k: "last7", label: "Last 7 days" }, { k: "month", label: "This month" }, { k: "lastmonth", label: "Last month" },
  ];
  return (
    <div className="range-picker">
      <div className="range-chips">
        {presets.map((p) => (
          <button key={p.k} className={`range-chip ${value === p.k ? "on" : ""}`} onClick={() => onChange(p.k)}>{p.label}</button>
        ))}
        <button className={`range-chip ${value === "custom" ? "on" : ""}`} onClick={() => onChange("custom", custom.from, custom.to)}>Custom</button>
      </div>
      {value === "custom" && (
        <div className="range-custom">
          <DatePicker
            value={custom.from}
            max={custom.to}
            placeholder="Start date"
            onChange={(v) => onChange("custom", v, custom.to)}
          />
          <span className="range-arrow" aria-hidden>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
          </span>
          <DatePicker
            value={custom.to}
            min={custom.from}
            placeholder="End date"
            onChange={(v) => onChange("custom", custom.from, v)}
          />
        </div>
      )}
    </div>
  );
}

function TimesheetsPage({ week }: { week: Session[] }) {
  const [sub, setSub] = useState<"edit" | "approvals">("edit");
  const [rangeKey, setRangeKey] = useState<RangeKey>("week");
  const [custom, setCustom] = useState<{ from?: string; to?: string }>({});
  const range = useMemo(() => rangeFor(rangeKey, custom.from, custom.to), [rangeKey, custom]);
  const [fetched, setFetched] = useState<Session[]>(week);
  const [loading, setLoading] = useState(false);

  // "This week" reuses the already-loaded, merged (incl. local/unsynced) data;
  // any other range fetches from the server for that window.
  useEffect(() => {
    if (rangeKey === "week") { setFetched(week); return; }
    setLoading(true);
    api<Session[]>(`/sessions?from=${range.from.toISOString()}&to=${range.to.toISOString()}`)
      .then(setFetched).catch(() => setFetched([])).finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangeKey, range.from.getTime(), range.to.getTime(), week]);

  // Admit anything that OVERLAPS the range, not just what started inside it — a
  // shift begun the previous evening belongs on this timesheet, and filtering by
  // start instant hid it completely.
  //
  // Durations here stay per-ENTRY rather than per-range share: this is a list of
  // time entries showing each one's real start and end, so a row must show the
  // duration between those two times, and the day subtotals must sum the rows
  // above them. The range-scoped view of the same data is the Reports page.
  const inRange = (s: Session) =>
    overlapSecs(s, range.from.getTime(), range.to.getTime()) > 0;
  // What "awaiting review" means, now that the server actually tracks it: an
  // entry still pending, or one the tracker flagged. `approvalState` is absent
  // on a locally-created row and on an older backend, so those fall back to the
  // old rule — every manual entry counts as unreviewed — rather than silently
  // emptying this tab.
  const needsReview = (s: Session) =>
    s.tamperSuspected || (s.approvalState ? s.approvalState === "pending" : Boolean(s.isManual));
  const rows = (sub === "approvals" ? fetched.filter(needsReview) : fetched).filter(inRange);
  // Rejected time is excluded from every total, matching the server (which keeps
  // it out of reports) and the dashboard. The row stays visible and marked.
  const counted = rows.filter((s) => s.approvalState !== "rejected");
  const total = counted.reduce((a, s) => a + secs(s), 0);
  const trackedTotal = counted.filter((s) => !s.isManual).reduce((a, s) => a + secs(s), 0);
  const manualTotal = counted.filter((s) => s.isManual).reduce((a, s) => a + secs(s), 0);

  const byDay = useMemo(() => {
    const g = new Map<string, Session[]>();
    for (const s of [...rows].sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())) {
      const k = new Date(s.startedAt).toDateString();
      (g.get(k) ?? g.set(k, []).get(k)!).push(s);
    }
    return [...g.entries()];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows]);

  const Table = ({ list }: { list: Session[] }) => (
    <div className="ts-table">
      <div className="ts-thead"><span>Project · Task</span><span>Type</span><span>Time</span><span>Duration</span></div>
      {list.map((s) => (
        <div className="ts-row" key={s.id}>
          <span className="ts-proj">{s.project.name}{s.project.clientTag ? <em className="ts-client"> · {s.project.clientTag}</em> : ""}{s.task ? ` — ${s.task.title}` : ""}</span>
          {/* A manual entry now says where it stands, not just that it is
              manual — "Manual" on a row an admin rejected reads as time that
              counts, and the totals above say otherwise. */}
          <span className={`chip-prio ${s.tamperSuspected || s.approvalState === "rejected" ? "urgent" : s.isManual ? "" : "lowest"}`}>
            {s.tamperSuspected
              ? "Review"
              : !s.isManual
                ? "Tracked"
                : s.approvalState === "pending"
                  ? "Pending"
                  : s.approvalState === "rejected"
                    ? "Rejected"
                    : "Manual"}
          </span>
          {/* An open row is only "running" if it is still proving it — otherwise it
              was left behind, and the server tells us where it really ended. */}
          <span className="ts-time">
            {fmtT(s.startedAt)}
            {s.endedAt ? `–${fmtT(s.endedAt)}` : isLive(s) ? " · running" : `–${fmtT(new Date(endMs(s)).toISOString())} · unfinished`}
          </span>
          <span className="ts-dur">{fmtShort(secs(s))}</span>
        </div>
      ))}
    </div>
  );

  return (
    <div className="page">
      <div className="page-head">
        <h2>Timesheets</h2>
        <span className="muted small">{fmtD(range.from.toISOString())} – {fmtD(range.to.toISOString())} · {fmtShort(total)} total</span>
      </div>

      <div className="ts-controls">
        <SubTabs tabs={[{ id: "edit", label: "View & edit" }, { id: "approvals", label: "Approvals" }]} value={sub} onChange={setSub} />
      </div>

      <DateRangePicker
        value={rangeKey}
        custom={custom}
        onChange={(k, f, t) => { setRangeKey(k); if (k === "custom") setCustom({ from: f, to: t }); }}
      />

      <div className="ts-summary">
        <div><div className="dc-label">Total</div><div className="act-bench-val">{fmtShort(total)}</div></div>
        <div><div className="dc-label">Tracked</div><div className="act-bench-val">{fmtShort(trackedTotal)}</div></div>
        <div><div className="dc-label">Manual</div><div className="act-bench-val">{manualTotal > 0 ? fmtShort(manualTotal) : "—"}</div></div>
        <div><div className="dc-label">Entries</div><div className="act-bench-val">{rows.length}</div></div>
      </div>

      {loading ? (
        <div className="empty">Loading…</div>
      ) : byDay.length === 0 ? (
        <div className="empty">{sub === "approvals" ? "Nothing awaiting review in this range." : "No time tracked in this range."}</div>
      ) : (
        byDay.map(([k, list]) => (
          <div className="ts-day" key={k}>
            <div className="ts-day-head"><span>{new Date(k).toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" })}</span><span>{fmtShort(list.reduce((a, s) => a + secs(s), 0))}</span></div>
            <DayTimeline list={list} />
            <Table list={list} />
          </div>
        ))
      )}
    </div>
  );
}

interface GalleryShot {
  id: string;
  url: string | null;
  takenAt: string;
  activityPct: number;
  project: string;
  monitorIndex: number;
}

const DENSITIES = [3, 4, 5, 6] as const;
type Density = (typeof DENSITIES)[number];
const SHOTS_PER_PAGE = 36;

function ActivityPage() {
  const [sub, setSub] = useState<"screenshots" | "apps" | "urls">("screenshots");
  const [freq, setFreq] = useState<"ten" | "all">("all");
  const [view, setView] = useState<"grid" | "list">("grid");
  const [cols, setCols] = useState<Density>(3);
  const [rangeKey, setRangeKey] = useState<RangeKey>("week");
  const [custom, setCustom] = useState<{ from?: string; to?: string }>({});
  const range = useMemo(() => rangeFor(rangeKey, custom.from, custom.to), [rangeKey, custom]);

  const [apps, setApps] = useState<{ appName: string; seconds: number }[]>([]);
  const [urls, setUrls] = useState<{ domain: string; seconds: number }[]>([]);
  const [summary, setSummary] = useState<{ totalSeconds: number; avgActivityPct: number | null; trackedSeconds?: number; discardedSeconds?: number } | null>(null);
  // Screenshots captured on THIS device, shown instantly from the local cache —
  // no waiting for a block boundary or upload.
  const [localShots, setLocalShots] = useState<{ takenAt: string; monitorIndex: number; dataUrl: string; status?: ShotStatus }[]>([]);
  const [lightbox, setLightbox] = useState<string | null>(null); // full-size image src
  // Re-read per render rather than captured once: load() refreshes the cached
  // policy, so an admin turning blur on takes effect here without a restart.
  const localsViewable = canViewOwnCaptures();

  const reduce = useReducedMotion();

  // Newest first, one page at a time. The gallery used to pull every shot in the
  // week in a single request and slice it client-side, which meant the server
  // presigned hundreds of R2 URLs nobody scrolled to.
  const buildPath = useCallback(
    (cursor: string | null) => {
      const p = new URLSearchParams({
        from: range.from.toISOString(),
        to: range.to.toISOString(),
        limit: String(SHOTS_PER_PAGE),
      });
      if (cursor) p.set("cursor", cursor);
      return `/screenshots?${p.toString()}`;
    },
    [range.from, range.to]
  );
  const { items: shots, loading, loadingMore, error, done, sentinelRef } = useInfiniteList<GalleryShot>(buildPath);

  useEffect(() => {
    const from = range.from.toISOString();
    const to = range.to.toISOString();
    api<typeof apps>(`/reports/app-usage?from=${from}&to=${to}`).then(setApps).catch(() => {});
    api<typeof urls>(`/reports/url-usage?from=${from}&to=${to}`).then(setUrls).catch(() => {});
    api<typeof summary>(`/reports/summary?from=${from}&to=${to}`).then(setSummary).catch(() => {});
    invoke<typeof localShots>("local_shots").then(setLocalShots).catch(() => {});
  }, [range.from, range.to]);

  const maxApp = Math.max(1, ...apps.map((a) => a.seconds));
  const maxUrl = Math.max(1, ...urls.map((u) => u.seconds));

  // Group the loaded pages into hour blocks. Already newest-first from the
  // server, so no re-sort is needed — appending a page just extends the tail.
  const blocks = useMemo(() => {
    let list = shots;
    if (freq === "ten") {
      const seen = new Set<string>();
      list = list.filter((s) => {
        const d = new Date(s.takenAt);
        const key = `${d.toISOString().slice(0, 13)}-${Math.floor(d.getMinutes() / 10)}-${s.monitorIndex}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }
    const g = new Map<string, GalleryShot[]>();
    for (const s of list) {
      const d = new Date(s.takenAt);
      const k = `${d.toLocaleDateString([], { month: "short", day: "numeric" })} · ${d.getHours()}:00`;
      (g.get(k) ?? g.set(k, []).get(k)!).push(s);
    }
    return [...g.entries()];
  }, [shots, freq]);

  const gridStyle = { "--shot-cols": cols } as CSSProperties;

  return (
    <div className="page">
      <div className="page-head"><h2>Activity</h2></div>
      <SubTabs tabs={[{ id: "screenshots", label: "Screenshots" }, { id: "apps", label: "Apps" }, { id: "urls", label: "URLs" }]} value={sub} onChange={setSub} />

      <DateRangePicker
        value={rangeKey}
        custom={custom}
        onChange={(k, f, t) => { setRangeKey(k); if (k === "custom") setCustom({ from: f, to: t }); }}
      />

      {sub === "screenshots" && (
        <>
          <div className="act-bench">
            {/* "Worked time" and the timer's "Tracked today" are not the same
                quantity, and side by side with no explanation they read as the
                same number disagreeing with itself. Worked time is the clock
                MINUS idle you discarded, so it is legitimately smaller — say so
                inline, with the arithmetic, instead of leaving people to guess. */}
            <div>
              <div className="dc-label">Worked time</div>
              <div className="act-bench-val">{summary ? fmtShort(summary.totalSeconds) : "—"}</div>
              {summary && summary.discardedSeconds != null && summary.discardedSeconds > 0 && (
                <div className="dc-label act-bench-sub">
                  {fmtShort(summary.trackedSeconds ?? 0)} tracked − {fmtShort(summary.discardedSeconds)} idle removed
                </div>
              )}
            </div>
            <div><div className="dc-label">Avg. activity</div><div className="act-bench-val">{summary?.avgActivityPct != null ? `${summary.avgActivityPct}%` : "—"}</div></div>
            <div className="act-toggle">
              <SubTabs tabs={[{ id: "ten", label: "Every 10 min" }, { id: "all", label: "All screenshots" }]} value={freq} onChange={setFreq} />
            </div>
          </div>

          <div className="gallery-controls">
            <SubTabs tabs={[{ id: "grid", label: "Grid" }, { id: "list", label: "List" }]} value={view} onChange={setView} />
            {view === "grid" && (
              <div className="density" role="group" aria-label="Grid density">
                {DENSITIES.map((d) => (
                  <button
                    key={d}
                    className={`density-btn ${cols === d ? "on" : ""}`}
                    aria-pressed={cols === d}
                    title={`${d} per row`}
                    onClick={() => setCols(d)}
                  >
                    ×{d}
                  </button>
                ))}
              </div>
            )}
            <span className="muted small gallery-count">{shots.length} loaded{done ? "" : "…"}</span>
          </div>

          {localShots.length > 0 && (
            <div className="shot-block">
              <div className="shot-block-head">
                <span className="shot-block-time">On this device</span>
                <span className="muted small">
                  {localShots.length} recent · not yet uploaded shown here too
                  {!localsViewable && " · hidden while your organisation has blur on"}
                </span>
              </div>
              <div className="shot-grid" style={gridStyle}>
                {localShots.map((s, i) => (
                  // Only clickable when the image is actually shown — opening a
                  // lightbox onto a withheld capture would defeat the point.
                  <div className="shot" key={`local-${i}`} onClick={() => localsViewable && setLightbox(s.dataUrl)}>
                    <UploadTag status={s.status} />
                    {localsViewable
                      ? <img src={s.dataUrl} alt="" loading="lazy" decoding="async" />
                      : <div className="shot-empty">Hidden — blur is on</div>}
                    <div className="shot-foot"><span>{fmtT(s.takenAt)}</span><span className="muted small">mon {s.monitorIndex + 1}</span></div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {loading ? (
            <div className="shot-block">
              <div className="shot-grid" style={gridStyle}>
                {Array.from({ length: cols * 2 }).map((_, i) => <div className="shot-skel" key={i} />)}
              </div>
            </div>
          ) : error ? (
            <div className="empty">Couldn&rsquo;t load screenshots — {error}</div>
          ) : blocks.length === 0 && localShots.length === 0 ? (
            <div className="empty">No screenshots captured yet — they appear within a minute of tracking.</div>
          ) : view === "list" ? (
            <div className="shot-list">
              {shots.map((s) => (
                <div className="shot-list-row" key={s.id} onClick={() => s.url && setLightbox(s.url)}>
                  <div className="shot-list-thumb">
                    {s.url ? <img src={s.url} alt="" loading="lazy" decoding="async" /> : <div className="shot-empty">n/a</div>}
                  </div>
                  <span className="shot-list-proj">{s.project}</span>
                  <span className="muted small">{fmtD(s.takenAt)} · {fmtT(s.takenAt)}</span>
                  <div className="shot-actbar"><span className={s.activityPct >= 50 ? "hi" : "lo"} style={{ width: `${s.activityPct}%` }} /></div>
                  <span className="shot-list-pct">{Math.round(s.activityPct)}%</span>
                  <span className="muted small">mon {s.monitorIndex + 1}</span>
                </div>
              ))}
            </div>
          ) : (
            blocks.map(([label, list]) => (
              <div className="shot-block" key={label}>
                <div className="shot-block-head"><span className="shot-block-time">{label}</span><span className="muted small">{list.length} screenshot{list.length > 1 ? "s" : ""}</span></div>
                <div className="shot-grid" style={gridStyle}>
                  {list.map((s, i) => (
                    <motion.div
                      className="shot"
                      key={s.id}
                      onClick={() => s.url && setLightbox(s.url)}
                      initial={reduce ? false : { opacity: 0, transform: "translateY(6px)" }}
                      animate={{ opacity: 1, transform: "translateY(0px)" }}
                      transition={{ duration: reduce ? 0 : 0.18, delay: reduce ? 0 : Math.min(i, 8) * 0.02 }}
                    >
                      <div className="shot-proj">{s.project}</div>
                      {s.url ? <img src={s.url} alt="" loading="lazy" decoding="async" /> : <div className="shot-empty">n/a</div>}
                      <div className="shot-foot">
                        <span>{fmtT(s.takenAt)}</span>
                        <div className="shot-actbar"><span className={s.activityPct >= 50 ? "hi" : "lo"} style={{ width: `${s.activityPct}%` }} /></div>
                        <span>{Math.round(s.activityPct)}%</span>
                      </div>
                    </motion.div>
                  ))}
                </div>
              </div>
            ))
          )}

          {/* Next-page placeholders keep the scroll position stable while loading. */}
          {loadingMore && (
            <div className="shot-block">
              <div className="shot-grid" style={gridStyle}>
                {Array.from({ length: cols }).map((_, i) => <div className="shot-skel" key={i} />)}
              </div>
            </div>
          )}

          {/* Sentinel — entering the viewport requests the next page. */}
          {!done && !loading && !error && <div ref={sentinelRef} className="scroll-sentinel" aria-hidden />}
          {done && shots.length > 0 && <div className="muted small gallery-end">That&rsquo;s everything in this range.</div>}
        </>
      )}
      {sub === "apps" && (
        apps.length === 0 ? <div className="empty">No app usage captured yet.</div> : (
          <div className="bars">
            {apps.slice(0, 14).map((a) => (
              <div className="bar-row" key={a.appName}>
                <span className="bar-name">{a.appName}</span>
                <div className="bar-track"><span style={{ width: `${(a.seconds / maxApp) * 100}%` }} /></div>
                <span className="bar-val">{fmtShort(a.seconds)}</span>
              </div>
            ))}
          </div>
        )
      )}
      {sub === "urls" && (
        urls.length === 0 ? (
          <div className="empty">
            No website activity captured yet.
            <div className="muted small" style={{ marginTop: 8 }}>
              Domains are sampled from the address bar of a supported browser while it&rsquo;s the
              foreground window. Windows only.
            </div>
          </div>
        ) : (
          <div className="bars">
            {urls.slice(0, 14).map((u) => (
              <div className="bar-row" key={u.domain}>
                <span className="bar-name">{u.domain}</span>
                <div className="bar-track"><span style={{ width: `${(u.seconds / maxUrl) * 100}%` }} /></div>
                <span className="bar-val">{fmtShort(u.seconds)}</span>
              </div>
            ))}
          </div>
        )
      )}

      {/* Full-size screenshot viewer. */}
      <AnimatePresence>
        {lightbox && (
          <motion.div className="lightbox" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reduce ? 0 : 0.15 }} onClick={() => setLightbox(null)}>
            <motion.img
              src={lightbox}
              alt="Screenshot"
              initial={reduce ? false : { opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.96 }}
              transition={{ duration: reduce ? 0 : 0.18 }}
              onClick={(e) => e.stopPropagation()}
            />
            <button className="lightbox-close" onClick={() => setLightbox(null)} aria-label="Close">✕</button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

type GroupBy = "project" | "day" | "task";

function ReportsPage({ week }: { week: Session[] }) {
  const [summary, setSummary] = useState<{ totalSeconds: number; avgActivityPct: number | null; sessions: number } | null>(null);
  const [byProj, setByProj] = useState<{ project: string; totalSeconds: number; avgActivityPct: number | null }[]>([]);
  const [group, setGroup] = useState<GroupBy>("project");
  useEffect(() => {
    const from = startOfWeek().toISOString();
    api<typeof summary>(`/reports/summary?from=${from}`).then(setSummary).catch(() => {});
    api<typeof byProj>(`/reports/by-project?from=${from}`).then(setByProj).catch(() => {});
  }, []);

  const weekStart = useMemo(() => startOfWeek(), []);
  // This is a RANGE report, so every figure is the range's share — `week` now
  // includes sessions that began before the week and ran into it, and summing
  // whole durations would import last week's hours into this week's totals.
  const weekStartMs = weekStart.getTime();
  const nowMs = Date.now();
  const trackedTotal = week.filter((s) => !s.isManual).reduce((a, s) => a + overlapSecs(s, weekStartMs, nowMs), 0);
  const manualTotal = week.filter((s) => s.isManual).reduce((a, s) => a + overlapSecs(s, weekStartMs, nowMs), 0);

  // per-day tracked-vs-manual stacked bars, split across the days each session
  // actually spans rather than charged whole to the day it started
  const daily = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => {
      const from = weekStartMs + i * 86400000;
      const to = Math.min(from + 86400000, nowMs);
      const share = (s: Session) => (to > from ? overlapSecs(s, from, to) : 0);
      return {
        dow: DOW[i],
        tracked: week.filter((s) => !s.isManual).reduce((a, s) => a + share(s), 0),
        manual: week.filter((s) => s.isManual).reduce((a, s) => a + share(s), 0),
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [week, weekStartMs]);
  const maxDay = Math.max(1, ...daily.map((d) => d.tracked + d.manual));

  // grouped table rows
  const grouped = useMemo(() => {
    if (group === "project") {
      return byProj.map((p) => ({ label: p.project, seconds: p.totalSeconds, meta: p.avgActivityPct != null ? `${p.avgActivityPct}%` : "—" }))
        .sort((a, b) => b.seconds - a.seconds);
    }
    const g = new Map<string, { seconds: number; count: number }>();
    if (group === "day") {
      // A day row must hold the time worked ON that day. Grouping by the session's
      // start day put a whole multi-day session on one date — the same defect that
      // produced a 40-hour Monday in the chart above.
      for (let i = 0; i < 7; i++) {
        const from = weekStartMs + i * 86400000;
        const to = Math.min(from + 86400000, nowMs);
        if (to <= from) continue;
        const key = new Date(from).toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" });
        for (const s of week) {
          const share = overlapSecs(s, from, to);
          if (share <= 0) continue;
          const cur = g.get(key) ?? { seconds: 0, count: 0 };
          cur.seconds += share; cur.count += 1;
          g.set(key, cur);
        }
      }
    } else {
      for (const s of week) {
        const key = s.task?.title ?? `${s.project.name} (no task)`;
        const cur = g.get(key) ?? { seconds: 0, count: 0 };
        cur.seconds += overlapSecs(s, weekStartMs, nowMs); cur.count += 1;
        g.set(key, cur);
      }
    }
    return [...g.entries()].map(([label, v]) => ({ label, seconds: v.seconds, meta: `${v.count} session${v.count > 1 ? "s" : ""}` }))
      .sort((a, b) => b.seconds - a.seconds);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group, byProj, week, weekStartMs]);
  const maxRow = Math.max(1, ...grouped.map((r) => r.seconds));

  return (
    <div className="page">
      <div className="page-head"><h2>Reports</h2><span className="muted small">Week of {fmtD(weekStart.toISOString())}</span></div>
      <div className="dash-stats">
        <div className="dash-card"><div className="dc-label">Total time</div><div className="dc-value">{summary ? fmtShort(summary.totalSeconds) : "—"}</div></div>
        <div className="dash-card"><div className="dc-label">Avg. activity</div><div className="dc-value">{summary?.avgActivityPct != null ? `${summary.avgActivityPct}%` : "—"}</div></div>
        <div className="dash-card"><div className="dc-label">Tracked</div><div className="dc-value">{fmtShort(trackedTotal)}</div></div>
        <div className="dash-card"><div className="dc-label">Manual</div><div className="dc-value">{manualTotal > 0 ? fmtShort(manualTotal) : "—"}</div></div>
      </div>

      <div className="dash-chart" style={{ marginTop: 14 }}>
        <div className="dash-card-head">
          <span className="dc-label">Tracked vs. manual · by day</span>
          <span className="rp-legend"><i className="dot tracked" /> Tracked <i className="dot manual" /> Manual</span>
        </div>
        <div className="rp-bars">
          {daily.map((d) => (
            <div className="rp-bar-col" key={d.dow}>
              <div className="rp-bar-stack">
                <span className="rp-seg manual" style={{ height: `${(d.manual / maxDay) * 100}%` }} />
                <span className="rp-seg tracked" style={{ height: `${(d.tracked / maxDay) * 100}%` }} />
              </div>
              <span className="rp-bar-label">{d.dow}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="dash-table" style={{ marginTop: 14 }}>
        <div className="dash-card-head">
          <span className="dc-label">Data grouped by</span>
          <Select<GroupBy>
            value={group}
            onChange={setGroup}
            ariaLabel="Group data by"
            options={[
              { value: "project", label: "Project" },
              { value: "day", label: "Day" },
              { value: "task", label: "Task" },
            ]}
          />
        </div>
        {grouped.length === 0 ? <div className="empty">No tracked time this week.</div> : grouped.map((r) => (
          <div className="proj-line" key={r.label}>
            <div className="proj-line-body">
              <div className="proj-line-title">{r.label}</div>
              <div className="proj-bar"><span style={{ width: `${(r.seconds / maxRow) * 100}%` }} /></div>
            </div>
            <span className="muted small">{fmtShort(r.seconds)} · {r.meta}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ProjectsPageDesktop({ projects, onChange }: { projects: Project[]; onChange: () => void }) {
  const COLS = [
    { key: "todo", label: "To Do" },
    { key: "in_progress", label: "In Progress" },
    { key: "done", label: "Done" },
  ] as const;
  const [busy, setBusy] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);

  async function move(id: string, status: string) {
    setBusy(id);
    setErr(null);
    try {
      await api(`/tasks/${id}`, { method: "PATCH", body: JSON.stringify({ status }) });
      onChange();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't update the task");
    } finally {
      setBusy(null);
    }
  }

  async function addTask(projectId: string) {
    const title = (draft[projectId] ?? "").trim();
    if (!title) return;
    setBusy(projectId);
    setErr(null);
    try {
      await api(`/projects/${projectId}/tasks`, { method: "POST", body: JSON.stringify({ title }) });
      setDraft((d) => ({ ...d, [projectId]: "" }));
      onChange();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't create the task");
    } finally {
      setBusy(null);
    }
  }

  const active = projects.filter((p) => !p.archivedAt);

  return (
    <div className="page">
      <div className="page-head"><h2>Projects &amp; Tasks</h2></div>
      {err && <div className="error" style={{ marginBottom: 10 }}>{err}</div>}
      {active.length === 0 && <div className="empty">No projects yet.</div>}
      {active.map((p) => {
        const tasks = p.tasks ?? [];
        const done = tasks.filter((t) => t.status === "done").length;
        return (
          <div className="proj-card" key={p.id}>
            <div className="proj-card-head">
              <span className="proj-card-title">{p.name}</span>
              <span className="muted small">{done}/{tasks.length} done</span>
            </div>

            {/* Staff can add their own tasks — the API never required admin. */}
            <form className="kb-add" onSubmit={(e) => { e.preventDefault(); addTask(p.id); }}>
              <input
                value={draft[p.id] ?? ""}
                onChange={(e) => setDraft((d) => ({ ...d, [p.id]: e.target.value }))}
                placeholder="Add a task…"
                aria-label={`Add a task to ${p.name}`}
              />
              <button type="submit" disabled={busy === p.id || !(draft[p.id] ?? "").trim()} aria-label="Add task">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" aria-hidden><path d="M12 5v14M5 12h14" /></svg>
              </button>
            </form>

            <div className="kb">
              {COLS.map((c) => {
                const items = tasks.filter((t) => t.status === c.key);
                return (
                  <div className="kb-col" key={c.key}>
                    <div className="kb-col-head">{c.label} <span>{items.length}</span></div>
                    {items.map((t) => (
                      <div className={`kb-task ${c.key === "done" ? "is-done" : ""}`} key={t.id}>
                        {/* One-click complete/reopen, instead of stepping a task
                            through every column just to mark it finished. */}
                        <button
                          className={`kb-check ${c.key === "done" ? "on" : ""}`}
                          disabled={busy === t.id}
                          onClick={() => move(t.id, c.key === "done" ? "todo" : "done")}
                          aria-label={c.key === "done" ? `Reopen ${t.title}` : `Mark ${t.title} done`}
                          title={c.key === "done" ? "Reopen" : "Mark done"}
                        >
                          {c.key === "done" && (
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M4 12.5l5 5L20 6.5" /></svg>
                          )}
                        </button>
                        <span className="kb-task-title">{t.title}</span>
                        <div className="kb-move">
                          {c.key !== "todo" && (
                            <button disabled={busy === t.id} onClick={() => move(t.id, c.key === "done" ? "in_progress" : "todo")} aria-label="Move left">
                              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M15 6l-6 6 6 6" /></svg>
                            </button>
                          )}
                          {c.key !== "done" && (
                            <button disabled={busy === t.id} onClick={() => move(t.id, c.key === "todo" ? "in_progress" : "done")} aria-label="Move right">
                              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M9 6l6 6-6 6" /></svg>
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                    {items.length === 0 && <div className="kb-empty">—</div>}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
