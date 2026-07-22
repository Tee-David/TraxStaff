import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { motion, AnimatePresence } from "motion/react";
import CircularTimer from "./CircularTimer";
import LightRays from "./LightRays";
import Consent from "./Consent";
import {
  api,
  API_BASE,
  clearToken,
  getToken,
  setToken,
  CONSENT_VERSION,
  type Me,
  type Project,
  type Session,
} from "./api";

// Push the sync engine our credentials so the offline queue drains even when
// no session is running. Empty token clears them (on sign-out).
function pushSyncAuth() {
  invoke("set_sync_auth", { token: getToken() ?? "", backend: API_BASE }).catch(() => {});
}

interface SyncState {
  pending: number;
  lastSyncedAt: string | null;
  online: boolean;
  lastError: string | null;
}

interface ReminderPrefs { idle: boolean; notTracking: boolean }
function loadReminders(): ReminderPrefs {
  try { return { idle: true, notTracking: false, ...JSON.parse(localStorage.getItem("trax_reminders") || "{}") }; }
  catch { return { idle: true, notTracking: false }; }
}

// The app's real version (from Tauri); falls back in browser preview.
async function getAppVersion(): Promise<string> {
  try { return await (await import("@tauri-apps/api/app")).getVersion(); }
  catch { return "0.0.0"; }
}

// Fire a native OS notification (best-effort; requests permission on first use).
async function notify(title: string, body: string) {
  try {
    const n = await import("@tauri-apps/plugin-notification");
    let granted = await n.isPermissionGranted();
    if (!granted) granted = (await n.requestPermission()) === "granted";
    if (granted) n.sendNotification({ title, body });
  } catch { /* not under Tauri / denied — ignore */ }
}

const WEEK_TARGET_SECONDS = 40 * 3600; // 40h/week target
const DAY_TARGET_SECONDS = 8 * 3600;

function startOfToday(): Date { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }
function startOfWeek(): Date { const d = startOfToday(); const day = (d.getDay() + 6) % 7; d.setDate(d.getDate() - day); return d; }
function secs(s: Session): number { const e = s.endedAt ? new Date(s.endedAt).getTime() : Date.now(); return (e - new Date(s.startedAt).getTime()) / 1000; }
function fmtClock(sec: number): string { const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = Math.floor(sec % 60); return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`; }
function fmtShort(sec: number): string { const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60); return h > 0 ? `${h}h ${m}m` : `${m}m`; }
function fmtT(iso: string): string { return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); }
function fmtD(iso: string): string { return new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" }); }

type DashTab = "dashboard" | "timesheets" | "activity" | "reports" | "projects";

export default function App() {
  const [authed, setAuthed] = useState(Boolean(getToken()));
  useUpdateCheck();
  if (!authed) return <Login onLogin={() => setAuthed(true)} />;
  return <ConsentGate onLogout={() => setAuthed(false)} />;
}

// Gate the tracker behind the consent screen. Capture code (begin_capture) is
// unreachable until the current CONSENT_VERSION is accepted for this user.
function ConsentGate({ onLogout }: { onLogout: () => void }) {
  const [state, setState] = useState<"checking" | "needed" | "ok">("checking");

  useEffect(() => {
    pushSyncAuth();
    api<Me>("/auth/me")
      .then((me) => setState(me.consentVersion != null && me.consentVersion >= CONSENT_VERSION ? "ok" : "needed"))
      // Offline: if we've accepted before on this device, don't block; else ask.
      .catch(() => setState(localStorage.getItem("trax_consent_v") === String(CONSENT_VERSION) ? "ok" : "needed"));
  }, []);

  function signOut() {
    clearToken();
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

// Check for a newer signed release on startup; if found, download + relaunch.
function useUpdateCheck() {
  useEffect(() => {
    (async () => {
      try {
        const { check } = await import("@tauri-apps/plugin-updater");
        const update = await check();
        if (update?.available) {
          await update.downloadAndInstall();
          const { relaunch } = await import("@tauri-apps/plugin-process");
          await relaunch();
        }
      } catch {
        /* not running under Tauri, offline, or no update — ignore */
      }
    })();
  }, []);
}

function Login({ onLogin }: { onLogin: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setLoading(true); setError(null);
    try {
      const res = await api<{ token: string }>("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
      setToken(res.token); onLogin();
    } catch (err) { setError(err instanceof Error ? err.message : "Login failed"); }
    finally { setLoading(false); }
  }
  return (
    <div className="login-screen">
      <div className="login-bg">
        <LightRays raysOrigin="top-center" raysColor="#ffffff" raysSpeed={1} lightSpread={0.5} rayLength={3} followMouse mouseInfluence={0.1} distortion={0.4} saturation={1} />
      </div>
      <div className="login-card">
        <img src="/brand/icon-badge.svg" alt="Trax" className="login-badge" />
        <h1 className="login-title">Welcome back</h1>
        <p className="login-sub">Sign in to start tracking.</p>
        <form onSubmit={submit} className="stack">
          <input type="email" placeholder="name@company.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <div className="pw-wrap">
            <input type={showPw ? "text" : "password"} placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            <button type="button" className="pw-toggle" onClick={() => setShowPw((s) => !s)} aria-label={showPw ? "Hide password" : "Show password"}>
              {showPw ? "🙈" : "👁"}
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
  const [active, setActive] = useState<Session | null>(null);
  const [projectId, setProjectId] = useState("");
  const [taskId, setTaskId] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [expanded, setExpanded] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [tab, setTab] = useState<DashTab>("dashboard");
  const [error, setError] = useState<string | null>(null);
  const [idleBanner, setIdleBanner] = useState<number | null>(null); // "you're idle" hint while away
  const [idlePrompt, setIdlePrompt] = useState<{ minutes: number; fromISO: string; toISO: string } | null>(null);
  const [resumed, setResumed] = useState<number | null>(null); // suspend gap (minutes)
  const [sync, setSync] = useState<SyncState | null>(null);
  const [hookOk, setHookOk] = useState(true);
  const [noteOpen, setNoteOpen] = useState(false);
  const [closeInfo, setCloseInfo] = useState<{ capturing: boolean; pending: number } | null>(null);
  const [closingRemaining, setClosingRemaining] = useState<number | null>(null);
  const deviceId = useRef<string | null>(null);
  const heartbeat = useRef<ReturnType<typeof setInterval> | null>(null);
  const reminders = useRef<ReminderPrefs>(loadReminders());
  const [remPrefs, setRemPrefs] = useState<ReminderPrefs>(reminders.current);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Latest active session, readable from event listeners that register once.
  const activeRef = useRef<Session | null>(null);
  activeRef.current = active;

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
        notify("Not tracking", "You're not tracking time right now.");
      }
    }, 5 * 60_000);
    return () => clearInterval(id);
  }, []);

  // Native capture engine → UI events. Registered once; read live state via refs.
  useEffect(() => {
    const uns = [
      // Timer truth from the monotonic clock (immune to minimize/sleep throttling).
      listen<{ elapsedSecs: number }>("trax:tick", (e) => setElapsed(e.payload.elapsedSecs)),
      // Sync engine state → badge + toast.
      listen<SyncState>("trax:sync-state", (e) => setSync(e.payload)),
      // Input-hook health → "activity unavailable" banner.
      listen<{ inputHook: boolean }>("trax:capture-health", (e) => setHookOk(e.payload.inputHook)),
      // Machine woke from sleep.
      listen<{ gapSecs: number }>("trax:resumed", (e) => setResumed(Math.round(e.payload.gapSecs / 60))),
      // Idle threshold crossed (informational) and returned from idle (actionable).
      listen<{ minutes: number }>("trax:idle", (e) => setIdleBanner(e.payload.minutes)),
      listen<{ minutes: number; fromISO: string; toISO: string }>("trax:idle-ended", (e) => {
        setIdleBanner(null);
        if (e.payload.minutes >= 1) {
          setIdlePrompt(e.payload);
          if (reminders.current.idle) notify("You were away", `Idle for ~${e.payload.minutes} min while tracking.`);
        }
      }),
    ];
    invoke<boolean>("capture_health").then(setHookOk).catch(() => {});
    return () => { uns.forEach((u) => u.then((f) => f())); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Exit flow: Rust holds the window open while a session is live or the sync
  // queue isn't empty, and emits "app-closing" with { capturing, pending }. We
  // show a three-way dialog (stop & sync / quit anyway / cancel) instead of
  // destroying the window and silently dropping unsynced records.
  useEffect(() => {
    const un = listen<{ capturing: boolean; pending: number }>("app-closing", (e) => setCloseInfo(e.payload));
    const up = listen<{ remaining: number }>("trax:flush-progress", (e) => setClosingRemaining(e.payload.remaining));
    return () => { un.then((f) => f()); up.then((f) => f()); };
  }, []);

  async function destroyWindow() {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().destroy();
  }
  // "Stop & sync": stop server-side, then drain the queue with live progress.
  async function closeStopAndSync() {
    setClosingRemaining(await invoke<number>("queue_count").catch(() => 0));
    if (activeRef.current) {
      await api(`/sessions/${activeRef.current.id}/stop`, { method: "POST", body: JSON.stringify({ endReason: "stopped" }) }).catch(() => {});
    }
    invoke("set_tracking_indicator", { active: false }).catch(() => {});
    try { await invoke<number>("flush_now_async", { token: getToken() ?? "", backend: API_BASE }); }
    catch { /* offline — queue persists for next launch */ }
    await destroyWindow();
  }
  // "Quit anyway": finalize the block into the durable queue (no network) and go.
  async function closeQuitAnyway() {
    invoke("end_capture").catch(() => {});
    invoke("set_tracking_indicator", { active: false }).catch(() => {});
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
      const [p, s] = await Promise.all([
        api<Project[]>("/projects"),
        api<Session[]>(`/sessions?from=${startOfWeek().toISOString()}`),
      ]);
      setProjects(p); setWeek(s);
      setLastUpdated(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
      if (p[0] && !projectId) setProjectId(p[0].id);
      const open = s.find((x) => !x.endedAt);
      if (open) { setActive(open); setProjectId(open.projectId); if (open.taskId) setTaskId(open.taskId); }
    } catch (e) { setError(e instanceof Error ? e.message : "Failed to load"); }
  }, [projectId]);

  useEffect(() => { invoke<string>("get_device_id").then((id) => (deviceId.current = id)).catch(() => {}); load(); /* eslint-disable-next-line */ }, []);

  // Rust drives the timer via trax:tick (monotonic, survives sleep/minimize).
  // In browser-preview (no Tauri) fall back to a local clock; and on focus we
  // hard-correct from Rust in case the webview throttled the tick stream.
  useEffect(() => {
    if (!active) { setElapsed(0); return; }
    const startMs = new Date(active.startedAt).getTime();
    const localTick = () => setElapsed((Date.now() - startMs) / 1000);
    const correct = () => invoke<number>("get_elapsed").then((s) => { if (s > 0) setElapsed(s); }).catch(localTick);
    correct();
    // Local interpolation between Rust ticks so the display is smooth at 1 Hz.
    const id = setInterval(() => setElapsed((e) => e + 1), 1000);
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

  async function start(pid?: string) {
    const useProject = pid ?? projectId;
    if (!useProject) return;
    setError(null);
    setProjectId(useProject);
    const firstTask = projects.find((p) => p.id === useProject)?.tasks?.find((t) => t.status !== "done")?.id;
    try {
      const appVersion = await getAppVersion();
      const s = await api<Session>("/sessions/start", { method: "POST", body: JSON.stringify({ projectId: useProject, taskId: (pid ? firstTask : taskId) || undefined, deviceId: deviceId.current ?? undefined, platform: "windows", appVersion }) });
      setActive(s); beginHeartbeat(s.id);
      // Kick off native capture (activity sampling + screenshots + sync) in Rust.
      let perBlock = 1, blur = false, idleMinutes = 5;
      try {
        const o = await api<{ screenshotsPerBlock: number; blurScreenshots: boolean; idleTimeoutMinutes: number }>("/orgs/settings");
        perBlock = o.screenshotsPerBlock; blur = o.blurScreenshots; idleMinutes = o.idleTimeoutMinutes;
      } catch { /* use defaults */ }
      // Seed the monotonic timer from the server-anchored start (handles a
      // session that was already open — the server is authoritative for duration).
      const baseElapsedSecs = Math.max(0, Math.floor((Date.now() - new Date(s.startedAt).getTime()) / 1000));
      try {
        await invoke("begin_capture", {
          token: getToken() ?? "", backend: API_BASE, sessionId: s.id,
          screenshotsPerBlock: perBlock, blur, idleMinutes, baseElapsedSecs,
        });
        invoke("set_tracking_indicator", { active: true }).catch(() => {});
      } catch (e) {
        // Time still counts; warn that activity/screenshots may not be captured.
        setError(`Tracking started, but capture failed to initialize: ${e instanceof Error ? e.message : e}`);
      }
    } catch (e) { setError(e instanceof Error ? e.message : "Could not start"); }
  }
  async function stop() {
    if (!active) return;
    invoke("end_capture").catch(() => {});
    invoke("set_tracking_indicator", { active: false }).catch(() => {});
    try { await api(`/sessions/${active.id}/stop`, { method: "POST", body: JSON.stringify({ endReason: "stopped" }) }); } catch { /* reconcile later */ }
    stopHeartbeat(); setActive(null); setElapsed(0); load();
  }
  // Signing out stops tracking first — otherwise the session stays open on the
  // server and the timer would resume the next time you sign in.
  async function signOut() {
    if (activeRef.current) { try { await stop(); } catch { /* stop best-effort */ } }
    clearToken();
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

  // Discard an idle stretch server-side (subtracts from worked time; never
  // touches the activity hash-chain). Keep = just dismiss.
  async function resolveIdle(discard: boolean) {
    const p = idlePrompt;
    setIdlePrompt(null);
    if (!discard || !p || !activeRef.current) return;
    try {
      await api("/sync/discard-idle", { method: "POST", body: JSON.stringify({ sessionId: activeRef.current.id, fromISO: p.fromISO, toISO: p.toISO }) });
      load();
    } catch { /* best-effort */ }
  }

  const today = useMemo(() => week.filter((s) => new Date(s.startedAt) >= startOfToday()), [week]);
  const workedToday = today.reduce((a, s) => a + secs(s), 0) + (active ? 0 : 0);
  const liveToday = workedToday + (active ? elapsed - secs(active) : 0);
  const workedWeek = week.reduce((a, s) => a + secs(s), 0);

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
    updates: async () => {
      try {
        const { check } = await import("@tauri-apps/plugin-updater");
        const u = await check();
        if (u?.available) { await u.downloadAndInstall(); const { relaunch } = await import("@tauri-apps/plugin-process"); await relaunch(); }
        else setError("You're on the latest version.");
      } catch { /* ignore */ }
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
                <h3 className="close-title">Close Trax?</h3>
                <p className="close-sub">
                  {closeInfo.capturing ? "A timer is still running. " : ""}
                  {closeInfo.pending > 0 ? `${closeInfo.pending} record${closeInfo.pending > 1 ? "s" : ""} haven't synced yet.` : "Your tracked time will be saved."}
                </p>
                <div className="close-actions">
                  <button className="close-primary" onClick={closeStopAndSync}>Stop &amp; sync</button>
                  <button className="close-ghost" onClick={closeQuitAnyway}>Quit anyway</button>
                  <button className="close-cancel" onClick={closeCancel}>Cancel</button>
                </div>
                {closeInfo.pending > 0 && <p className="close-fine">“Quit anyway” keeps your records — they upload next time you open Trax.</p>}
              </>
            )}
          </div>
        </div>
      )}

      {/* Idle keep/discard prompt on return from being away. */}
      {idlePrompt && active && (
        <div className="idle-banner">
          <span>You were away for ~{idlePrompt.minutes} min. Keep that time or discard it?</span>
          <div className="idle-actions">
            <button className="idle-keep" onClick={() => resolveIdle(false)}>Keep</button>
            <button className="idle-stop" onClick={() => resolveIdle(true)}>Discard idle</button>
          </div>
        </div>
      )}

      {/* Machine woke from sleep. */}
      {resumed !== null && active && (
        <div className="idle-banner">
          <span>Your computer was asleep for ~{resumed} min.</span>
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

      {/* Activity sampling unavailable (input hook dead) — time still counts. */}
      {!hookOk && active && (
        <div className="warn-banner">Activity tracking is unavailable — your time still counts, but activity % will read 0.</div>
      )}

      {/* Add a note to the running session. */}
      <AnimatePresence>
        {noteOpen && <NoteModal onSave={saveNote} onClose={() => setNoteOpen(false)} />}
      </AnimatePresence>

      <aside className="widget-pane">
        <TrackingWidget
          projects={projects} projectId={projectId}
          active={active} workedToday={liveToday} workedWeek={workedWeek}
          today={today} onStart={start} onStop={stop} error={error}
          onSignOut={() => { clearToken(); onLogout(); }}
          onRefresh={load} lastUpdated={lastUpdated} expanded={expanded} onToggleExpand={toggleExpand}
          sync={sync} onAddNote={() => setNoteOpen(true)}
          settingsOpen={settingsOpen} onToggleSettings={() => setSettingsOpen((s) => !s)}
          reminders={remPrefs} onUpdateReminders={updateReminders}
        />
      </aside>
      {expanded && (
        <main className="dash-pane">
          <DashNav tab={tab} setTab={setTab} onSignOut={signOut} />
          <div className="dash-scroll">
            {tab === "dashboard" && <DesktopDashboard projects={projects} week={week} workedWeek={workedWeek} onViewActivity={() => setTab("activity")} />}
            {tab === "timesheets" && <TimesheetsPage week={week} />}
            {tab === "activity" && <ActivityPage />}
            {tab === "reports" && <ReportsPage week={week} />}
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
  onStart: (pid?: string) => void; onStop: () => void; error: string | null; onSignOut: () => void;
  onRefresh: () => void; lastUpdated: string | null; expanded: boolean; onToggleExpand: () => void;
  sync: SyncState | null; onAddNote: () => void;
  settingsOpen: boolean; onToggleSettings: () => void;
  reminders: ReminderPrefs; onUpdateReminders: (n: Partial<ReminderPrefs>) => void;
}) {
  const { projects, active, workedToday, workedWeek, today, onStart, onStop, error, onRefresh, lastUpdated, expanded, onToggleExpand, sync, onAddNote, settingsOpen, onToggleSettings, reminders, onUpdateReminders } = props;
  const [q, setQ] = useState("");

  const secsToday = (pid: string) =>
    today.filter((s) => s.projectId === pid).reduce((a, s) => a + secs(s), 0);

  const list = projects
    .filter((p) => !p.archivedAt && p.name.toLowerCase().includes(q.toLowerCase()))
    // active project first, then by today's time
    .sort((a, b) => (a.id === active?.projectId ? -1 : b.id === active?.projectId ? 1 : secsToday(b.id) - secsToday(a.id)));

  return (
    <div className="widget">
      <div className="widget-brand"><img src="/brand/icon-badge.svg" alt="Trax" className="brand-mark" /></div>

      <CircularTimer seconds={workedToday} targetSeconds={DAY_TARGET_SECONDS} active={Boolean(active)} onToggle={() => (active ? onStop() : onStart())} />

      <div className="widget-stats">
        <div className="ws-item"><span className="wm-label">This week</span><span className="wm-val">{fmtClock(workedWeek)}</span></div>
        <div className="ws-item"><span className="wm-label">Daily target</span><span className="wm-val">{fmtClock(DAY_TARGET_SECONDS)}</span></div>
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
              layout
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              whileHover={{ x: isActive ? 0 : 2 }}
              className={`proj-row ${isActive ? "active" : ""}`}
              onClick={() => (isActive ? onStop() : onStart(p.id))}
            >
              <PlayStop active={isActive} />
              <span className="proj-name">{p.name}</span>
              <span className="proj-time tnum">{isActive ? fmtClock(workedToday) : fmtShort(secsToday(p.id)) || "0m"}</span>
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
            </div>
          )}
        </div>
        <button className="foot-icon" onClick={onToggleExpand} title={expanded ? "Collapse" : "Expand"} aria-label={expanded ? "Collapse" : "Expand"}>
          {expanded ? "»" : "«"}
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

function DesktopDashboard({ projects, week, workedWeek, onViewActivity }: { projects: Project[]; week: Session[]; workedWeek: number; onViewActivity: () => void }) {
  const [name, setName] = useState("");
  const [avgActivity, setAvgActivity] = useState<number | null>(null);
  const [shots, setShots] = useState<{ id: string; url: string | null; activityPct: number; project: string }[]>([]);

  useEffect(() => {
    api<{ email: string }>("/auth/me").then((u) => setName(u.email.split("@")[0])).catch(() => {});
    api<{ avgActivityPct: number | null }>(`/reports/summary?from=${startOfWeek().toISOString()}`).then((s) => setAvgActivity(s.avgActivityPct)).catch(() => {});
    api<typeof shots>(`/screenshots?from=${startOfWeek().toISOString()}`).then((s) => setShots(s.slice(0, 6))).catch(() => {});
  }, [week]);

  const daily = useMemo(() => {
    const days = new Array(7).fill(0);
    const base = startOfWeek().getTime();
    for (const s of week) {
      const idx = Math.floor((new Date(s.startedAt).getTime() - base) / 86400000);
      if (idx >= 0 && idx < 7) days[idx] += secs(s) / 3600;
    }
    return days;
  }, [week]);

  const perProject = useMemo(() => {
    const by = new Map<string, { name: string; secs: number; last: number }>();
    for (const s of week) {
      const e = by.get(s.projectId) ?? { name: s.project.name, secs: 0, last: 0 };
      e.secs += secs(s); e.last = Math.max(e.last, new Date(s.endedAt ?? s.startedAt).getTime());
      by.set(s.projectId, e);
    }
    return [...by.values()].sort((a, b) => b.secs - a.secs);
  }, [week]);

  const tasks = useMemo(() => {
    const all = projects.flatMap((p) => (p.tasks ?? []).map((t) => ({ ...t, project: p.name })));
    const rank = { in_progress: 0, todo: 1, done: 2 } as Record<string, number>;
    return all.sort((a, b) => (rank[a.status] ?? 3) - (rank[b.status] ?? 3)).slice(0, 6);
  }, [projects]);

  const activitySecs = avgActivity != null ? workedWeek * (avgActivity / 100) : workedWeek;
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
        <DashStat label="Activity time" value={fmtShort(activitySecs)} accent="accent" sub={avgActivity != null ? `${avgActivity}% active` : undefined} />
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
          <Gauge value={activitySecs} max={WEEK_TARGET_SECONDS} centerLabel={fmtShort(activitySecs)} />
          <div className="muted small center">of {fmtShort(WEEK_TARGET_SECONDS)} target</div>
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
      <button className="dash-logout" onClick={onSignOut}><span className="dash-logout-ico">⏻</span> Sign out</button>
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

function TimesheetsPage({ week }: { week: Session[] }) {
  const [sub, setSub] = useState<"edit" | "approvals">("edit");
  const [view, setView] = useState<"daily" | "weekly">("daily");
  const [dayIdx, setDayIdx] = useState(() => (new Date().getDay() + 6) % 7); // 0=Mon
  const weekStart = useMemo(() => startOfWeek(), []);
  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => { const d = new Date(weekStart); d.setDate(d.getDate() + i); return d; }),
    [weekStart],
  );

  const rows = sub === "approvals" ? week.filter((s) => s.isManual || s.tamperSuspected) : week;
  const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  const dayRows = useMemo(
    () => rows.filter((s) => sameDay(new Date(s.startedAt), days[dayIdx])).sort((a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime()),
    [rows, days, dayIdx],
  );
  const weekTotal = rows.reduce((a, s) => a + secs(s), 0);
  const dayTotal = dayRows.reduce((a, s) => a + secs(s), 0);
  const manualTotal = dayRows.filter((s) => s.isManual).reduce((a, s) => a + secs(s), 0);

  const byDay = useMemo(() => {
    return days.map((d) => ({
      date: d,
      list: rows.filter((s) => sameDay(new Date(s.startedAt), d)).sort((a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime()),
    }));
  }, [rows, days]);

  const Table = ({ list }: { list: Session[] }) => (
    <div className="ts-table">
      <div className="ts-thead"><span>Project · Task</span><span>Type</span><span>Time</span><span>Duration</span></div>
      {list.map((s) => (
        <div className="ts-row" key={s.id}>
          <span className="ts-proj">{s.project.name}{s.project.clientTag ? <em className="ts-client"> · {s.project.clientTag}</em> : ""}{s.task ? ` — ${s.task.title}` : ""}</span>
          <span className={`chip-prio ${s.tamperSuspected ? "urgent" : s.isManual ? "" : "lowest"}`}>{s.tamperSuspected ? "Review" : s.isManual ? "Manual" : "Tracked"}</span>
          <span className="ts-time">{fmtT(s.startedAt)}{s.endedAt ? `–${fmtT(s.endedAt)}` : " · running"}</span>
          <span className="ts-dur">{fmtShort(secs(s))}</span>
        </div>
      ))}
    </div>
  );

  return (
    <div className="page">
      <div className="page-head"><h2>Timesheets</h2><span className="muted small">Week of {fmtD(weekStart.toISOString())} · {fmtShort(weekTotal)} total</span></div>
      <div className="ts-controls">
        <SubTabs tabs={[{ id: "edit", label: "View & edit" }, { id: "approvals", label: "Approvals" }]} value={sub} onChange={setSub} />
        <SubTabs tabs={[{ id: "daily", label: "Daily" }, { id: "weekly", label: "Weekly" }]} value={view} onChange={setView} />
      </div>

      {view === "daily" ? (
        <>
          <div className="ts-daypick">
            {days.map((d, i) => {
              const total = rows.filter((s) => sameDay(new Date(s.startedAt), d)).reduce((a, s) => a + secs(s), 0);
              return (
                <button key={i} className={`ts-daychip ${i === dayIdx ? "on" : ""}`} onClick={() => setDayIdx(i)}>
                  <span className="ts-daychip-dow">{DOW[i]}</span>
                  <span className="ts-daychip-num">{d.getDate()}</span>
                  <span className="ts-daychip-bar" style={{ opacity: total > 0 ? 1 : 0.15 }} />
                </button>
              );
            })}
          </div>
          <div className="ts-summary">
            <div><div className="dc-label">Worked</div><div className="act-bench-val">{fmtShort(dayTotal)}</div></div>
            <div><div className="dc-label">Manual</div><div className="act-bench-val">{manualTotal > 0 ? fmtShort(manualTotal) : "—"}</div></div>
            <div><div className="dc-label">Entries</div><div className="act-bench-val">{dayRows.length}</div></div>
            <div className="ts-summary-tl"><div className="dc-label mb">Timeline</div><DayTimeline list={dayRows} /></div>
          </div>
          {dayRows.length === 0 ? (
            <div className="empty">{sub === "approvals" ? "Nothing awaiting review on this day." : "No time tracked on this day."}</div>
          ) : <Table list={dayRows} />}
        </>
      ) : (
        byDay.every((d) => d.list.length === 0) ? (
          <div className="empty">{sub === "approvals" ? "Nothing awaiting review." : "No time tracked this week."}</div>
        ) : (
          byDay.filter((d) => d.list.length > 0).map((d) => (
            <div className="ts-day" key={d.date.toISOString()}>
              <div className="ts-day-head"><span>{d.date.toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" })}</span><span>{fmtShort(d.list.reduce((a, s) => a + secs(s), 0))}</span></div>
              <DayTimeline list={d.list} />
              <Table list={d.list} />
            </div>
          ))
        )
      )}
    </div>
  );
}

function ActivityPage() {
  const [sub, setSub] = useState<"screenshots" | "apps" | "urls">("screenshots");
  const [freq, setFreq] = useState<"ten" | "all">("all");
  const [shots, setShots] = useState<{ id: string; url: string | null; takenAt: string; activityPct: number; project: string; monitorIndex: number }[]>([]);
  const [apps, setApps] = useState<{ appName: string; seconds: number }[]>([]);
  const [urls, setUrls] = useState<{ domain: string; seconds: number }[]>([]);
  const [summary, setSummary] = useState<{ totalSeconds: number; avgActivityPct: number | null } | null>(null);
  useEffect(() => {
    const from = startOfWeek().toISOString();
    api<typeof shots>(`/screenshots?from=${from}`).then(setShots).catch(() => {});
    api<typeof apps>(`/reports/app-usage?from=${from}`).then(setApps).catch(() => {});
    api<typeof urls>(`/reports/url-usage?from=${from}`).then(setUrls).catch(() => {});
    api<typeof summary>(`/reports/summary?from=${from}`).then(setSummary).catch(() => {});
  }, []);
  const maxApp = Math.max(1, ...apps.map((a) => a.seconds));
  const maxUrl = Math.max(1, ...urls.map((u) => u.seconds));

  // group screenshots into hour blocks
  const blocks = useMemo(() => {
    let list = [...shots].sort((a, b) => new Date(b.takenAt).getTime() - new Date(a.takenAt).getTime());
    if (freq === "ten") {
      const seen = new Set<string>();
      list = list.filter((s) => {
        const key = `${new Date(s.takenAt).toISOString().slice(0, 13)}-${Math.floor(new Date(s.takenAt).getMinutes() / 10)}-${s.monitorIndex}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }
    const g = new Map<string, typeof shots>();
    for (const s of list) {
      const d = new Date(s.takenAt);
      const k = `${d.toLocaleDateString([], { month: "short", day: "numeric" })} · ${d.getHours()}:00`;
      (g.get(k) ?? g.set(k, []).get(k)!).push(s);
    }
    return [...g.entries()];
  }, [shots, freq]);

  return (
    <div className="page">
      <div className="page-head"><h2>Activity</h2></div>
      <SubTabs tabs={[{ id: "screenshots", label: "Screenshots" }, { id: "apps", label: "Apps" }, { id: "urls", label: "URLs" }]} value={sub} onChange={setSub} />

      {sub === "screenshots" && (
        <>
          <div className="act-bench">
            <div><div className="dc-label">Worked time</div><div className="act-bench-val">{summary ? fmtShort(summary.totalSeconds) : "—"}</div></div>
            <div><div className="dc-label">Avg. activity</div><div className="act-bench-val">{summary?.avgActivityPct != null ? `${summary.avgActivityPct}%` : "—"}</div></div>
            <div className="act-toggle">
              <SubTabs tabs={[{ id: "ten", label: "Every 10 min" }, { id: "all", label: "All screenshots" }]} value={freq} onChange={setFreq} />
            </div>
          </div>
          {blocks.length === 0 ? <div className="empty">No screenshots captured yet — they appear while tracking.</div> : (
            blocks.map(([label, list]) => (
              <div className="shot-block" key={label}>
                <div className="shot-block-head"><span className="shot-block-time">{label}</span><span className="muted small">{list.length} screenshot{list.length > 1 ? "s" : ""}</span></div>
                <div className="shot-grid">
                  {list.map((s) => (
                    <div className="shot" key={s.id}>
                      <div className="shot-proj">{s.project}</div>
                      {s.url ? <img src={s.url} alt="" /> : <div className="shot-empty">n/a</div>}
                      <div className="shot-foot">
                        <span>{fmtT(s.takenAt)}</span>
                        <div className="shot-actbar"><span className={s.activityPct >= 50 ? "hi" : "lo"} style={{ width: `${s.activityPct}%` }} /></div>
                        <span>{Math.round(s.activityPct)}%</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
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
        urls.length === 0 ? <div className="empty">No website activity captured yet.</div> : (
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
  const trackedTotal = week.filter((s) => !s.isManual).reduce((a, s) => a + secs(s), 0);
  const manualTotal = week.filter((s) => s.isManual).reduce((a, s) => a + secs(s), 0);

  // per-day tracked-vs-manual stacked bars
  const daily = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(weekStart); d.setDate(d.getDate() + i);
      const list = week.filter((s) => new Date(s.startedAt).toDateString() === d.toDateString());
      return {
        dow: DOW[i],
        tracked: list.filter((s) => !s.isManual).reduce((a, s) => a + secs(s), 0),
        manual: list.filter((s) => s.isManual).reduce((a, s) => a + secs(s), 0),
      };
    });
  }, [week, weekStart]);
  const maxDay = Math.max(1, ...daily.map((d) => d.tracked + d.manual));

  // grouped table rows
  const grouped = useMemo(() => {
    if (group === "project") {
      return byProj.map((p) => ({ label: p.project, seconds: p.totalSeconds, meta: p.avgActivityPct != null ? `${p.avgActivityPct}%` : "—" }))
        .sort((a, b) => b.seconds - a.seconds);
    }
    const g = new Map<string, { seconds: number; count: number }>();
    for (const s of week) {
      const key = group === "day"
        ? new Date(s.startedAt).toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" })
        : s.task?.title ?? `${s.project.name} (no task)`;
      const cur = g.get(key) ?? { seconds: 0, count: 0 };
      cur.seconds += secs(s); cur.count += 1;
      g.set(key, cur);
    }
    return [...g.entries()].map(([label, v]) => ({ label, seconds: v.seconds, meta: `${v.count} session${v.count > 1 ? "s" : ""}` }))
      .sort((a, b) => b.seconds - a.seconds);
  }, [group, byProj, week]);
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
          <select className="rp-select" value={group} onChange={(e) => setGroup(e.target.value as GroupBy)}>
            <option value="project">Project</option>
            <option value="day">Day</option>
            <option value="task">Task</option>
          </select>
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
  async function move(id: string, status: string) {
    await api(`/tasks/${id}`, { method: "PATCH", body: JSON.stringify({ status }) }).catch(() => {});
    onChange();
  }
  return (
    <div className="page">
      <div className="page-head"><h2>Projects &amp; Tasks</h2></div>
      {projects.filter((p) => !p.archivedAt).length === 0 && <div className="empty">No projects yet.</div>}
      {projects.filter((p) => !p.archivedAt).map((p) => (
        <div className="proj-card" key={p.id}>
          <div className="proj-card-head">
            <span className="proj-card-title">{p.name}</span>
            <span className="muted small">{p.tasks?.length ?? 0} tasks</span>
          </div>
          <div className="kb">
            {COLS.map((c) => {
              const items = (p.tasks ?? []).filter((t) => t.status === c.key);
              return (
                <div className="kb-col" key={c.key}>
                  <div className="kb-col-head">{c.label} <span>{items.length}</span></div>
                  {items.map((t) => (
                    <div className="kb-task" key={t.id}>
                      <span>{t.title}</span>
                      <div className="kb-move">
                        {c.key !== "todo" && <button onClick={() => move(t.id, c.key === "done" ? "in_progress" : "todo")}>←</button>}
                        {c.key !== "done" && <button onClick={() => move(t.id, c.key === "todo" ? "in_progress" : "done")}>→</button>}
                      </div>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
