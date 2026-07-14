import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { motion } from "motion/react";
import CircularTimer from "./CircularTimer";
import LightRays from "./LightRays";
import {
  api,
  API_BASE,
  clearToken,
  getToken,
  setToken,
  type Project,
  type Session,
} from "./api";

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
  return <Tracker onLogout={() => setAuthed(false)} />;
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
  const [idleMin, setIdleMin] = useState<number | null>(null);
  const [closing, setClosing] = useState<number | null>(null); // remaining records while flushing on exit
  const deviceId = useRef<string | null>(null);
  const heartbeat = useRef<ReturnType<typeof setInterval> | null>(null);
  // Latest active session, readable from event listeners that register once.
  const activeRef = useRef<Session | null>(null);
  activeRef.current = active;

  // Idle prompt from the native capture engine.
  useEffect(() => {
    const un = listen<number>("trax:idle", (e) => setIdleMin(e.payload));
    return () => { un.then((f) => f()); };
  }, []);

  // Exit flow: Rust holds the window open while a session is live or the sync
  // queue isn't empty, and emits "app-closing". Like Hubstaff, closing the app
  // stops tracking: we stop the session server-side, flush the local queue
  // (finalizing the last block), show an "Uploading data" dialog, then close.
  const onClosingRef = useRef<() => Promise<void>>(async () => {});
  onClosingRef.current = async () => {
    setClosing(await invoke<number>("queue_count").catch(() => 0));
    try {
      // Anchor the stop on the server so the timer doesn't resume on next launch.
      if (activeRef.current) {
        await api(`/sessions/${activeRef.current.id}/stop`, { method: "POST", body: JSON.stringify({ endReason: "stopped" }) }).catch(() => {});
      }
      const remaining = await invoke<number>("flush_now", { token: getToken() ?? "", backend: API_BASE });
      setClosing(remaining);
    } catch { /* offline — close anyway; queue persists on disk for next launch */ }
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().destroy();
  };
  useEffect(() => {
    const un = listen("app-closing", () => onClosingRef.current());
    return () => { un.then((f) => f()); };
  }, []);

  // System-tray menu actions → app handlers (via a ref so listeners register once).
  const trayHandlers = useRef<Record<string, () => void>>({});
  useEffect(() => {
    const events = ["start", "stop", "signout", "dashboard", "updates"];
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

  useEffect(() => {
    if (!active) return;
    const start = new Date(active.startedAt).getTime();
    const tick = () => setElapsed((Date.now() - start) / 1000);
    tick();
    const id = setInterval(tick, 1000);
    // Browsers throttle intervals in the background — recompute on focus/visibility
    // so the clock never appears frozen after the window sleeps.
    const onWake = () => tick();
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
      const s = await api<Session>("/sessions/start", { method: "POST", body: JSON.stringify({ projectId: useProject, taskId: (pid ? firstTask : taskId) || undefined, deviceId: deviceId.current ?? undefined, platform: "windows", appVersion: "0.1.0" }) });
      setActive(s); beginHeartbeat(s.id);
      // Kick off native capture (activity sampling + screenshots + sync) in Rust.
      let perBlock = 1, blur = false, idleMinutes = 5;
      try {
        const o = await api<{ screenshotsPerBlock: number; blurScreenshots: boolean; idleTimeoutMinutes: number }>("/orgs/settings");
        perBlock = o.screenshotsPerBlock; blur = o.blurScreenshots; idleMinutes = o.idleTimeoutMinutes;
      } catch { /* use defaults */ }
      invoke("begin_capture", {
        token: getToken() ?? "",
        backend: API_BASE,
        sessionId: s.id,
        screenshotsPerBlock: perBlock,
        blur,
        idleMinutes,
      }).catch(() => {});
    } catch (e) { setError(e instanceof Error ? e.message : "Could not start"); }
  }
  async function stop() {
    if (!active) return;
    invoke("end_capture").catch(() => {});
    try { await api(`/sessions/${active.id}/stop`, { method: "POST", body: JSON.stringify({ endReason: "stopped" }) }); } catch { /* reconcile later */ }
    stopHeartbeat(); setActive(null); setElapsed(0); load();
  }
  // Signing out stops tracking first — otherwise the session stays open on the
  // server and the timer would resume the next time you sign in.
  async function signOut() {
    if (activeRef.current) { try { await stop(); } catch { /* stop best-effort */ } }
    clearToken();
    onLogout();
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
      {closing !== null && (
        <div className="close-overlay">
          <div className="close-dialog">
            <div className="close-spinner" />
            <h3 className="close-title">Uploading data…</h3>
            <p className="close-sub">Saving your latest tracked time before closing.</p>
            <div className="close-remaining">Remaining records: <strong>{closing}</strong></div>
          </div>
        </div>
      )}
      {idleMin !== null && active && (
        <div className="idle-banner">
          <span>You&rsquo;ve been idle for ~{idleMin} min. Keep tracking this time?</span>
          <div className="idle-actions">
            <button className="idle-keep" onClick={() => setIdleMin(null)}>Keep</button>
            <button className="idle-stop" onClick={() => { setIdleMin(null); stop(); }}>Stop</button>
          </div>
        </div>
      )}
      <aside className="widget-pane">
        <TrackingWidget
          projects={projects} projectId={projectId}
          active={active} workedToday={liveToday} workedWeek={workedWeek}
          today={today} onStart={start} onStop={stop} error={error}
          onSignOut={() => { clearToken(); onLogout(); }}
          onRefresh={load} lastUpdated={lastUpdated} expanded={expanded} onToggleExpand={toggleExpand}
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
}) {
  const { projects, active, workedToday, workedWeek, today, onStart, onStop, error, onSignOut, onRefresh, lastUpdated, expanded, onToggleExpand } = props;
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

      <div className="widget-foot">
        <button className="foot-refresh" onClick={onRefresh} title="Refresh">
          <span className="foot-refresh-ico">↻</span>
          {lastUpdated ? `Updated ${lastUpdated}` : "Refresh"}
        </button>
        <button className="foot-icon" onClick={onToggleExpand} title={expanded ? "Collapse" : "Expand"} aria-label={expanded ? "Collapse" : "Expand"}>
          {expanded ? "»" : "«"}
        </button>
      </div>
    </div>
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
  const [summary, setSummary] = useState<{ totalSeconds: number; avgActivityPct: number | null } | null>(null);
  useEffect(() => {
    const from = startOfWeek().toISOString();
    api<typeof shots>(`/screenshots?from=${from}`).then(setShots).catch(() => {});
    api<typeof apps>(`/reports/app-usage?from=${from}`).then(setApps).catch(() => {});
    api<typeof summary>(`/reports/summary?from=${from}`).then(setSummary).catch(() => {});
  }, []);
  const maxApp = Math.max(1, ...apps.map((a) => a.seconds));

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
      {sub === "urls" && <div className="empty">URL tracking needs a browser extension — coming later.</div>}
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
