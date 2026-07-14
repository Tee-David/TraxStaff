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
  const [error, setError] = useState<string | null>(null);
  const [idleMin, setIdleMin] = useState<number | null>(null);
  const deviceId = useRef<string | null>(null);
  const heartbeat = useRef<ReturnType<typeof setInterval> | null>(null);

  // Idle prompt from the native capture engine.
  useEffect(() => {
    const un = listen<number>("trax:idle", (e) => setIdleMin(e.payload));
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
    tick(); const id = setInterval(tick, 1000); return () => clearInterval(id);
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
    signout: () => { clearToken(); onLogout(); },
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
          <DesktopDashboard projects={projects} week={week} workedWeek={workedWeek} />
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
      <div className="widget-brand"><img src="/brand/icon-badge.svg" alt="" /> Trax</div>

      <CircularTimer seconds={workedToday} targetSeconds={DAY_TARGET_SECONDS} active={Boolean(active)} />

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
        <div className="foot-actions">
          <button className="link" onClick={onSignOut}>Sign out</button>
          <button className="foot-icon" onClick={onToggleExpand} title={expanded ? "Collapse" : "Expand"} aria-label={expanded ? "Collapse" : "Expand"}>
            {expanded ? "»" : "«"}
          </button>
        </div>
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

function DesktopDashboard({ projects, week, workedWeek }: { projects: Project[]; week: Session[]; workedWeek: number }) {
  const progress = Math.min(100, Math.round((workedWeek / WEEK_TARGET_SECONDS) * 100));
  // daily hours for last 7 days
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

  return (
    <div className="dash">
      <div className="dash-head">
        <h1>Performance</h1>
        <span className="muted small">This week</span>
      </div>

      <div className="dash-stats">
        <div className="dash-card"><div className="dc-label">Total working hours</div><div className="dc-value">{fmtShort(workedWeek)}</div></div>
        <div className="dash-card"><div className="dc-label">Active projects</div><div className="dc-value">{projects.filter((p) => !p.archivedAt).length}</div></div>
        <div className="dash-card"><div className="dc-label">Working progress</div><div className="dc-value">{progress}<span className="pct">%</span></div><div className="dc-sub">of 40h target</div></div>
      </div>

      <div className="dash-chart">
        <div className="dc-label mb">Your performance</div>
        <PerformanceChart daily={daily} />
        <div className="chart-x">{["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].map((d) => <span key={d}>{d}</span>)}</div>
      </div>

      <div className="dash-table">
        <div className="dt-head"><span>Project</span><span>Total time</span><span>Status</span></div>
        {perProject.length === 0 && <div className="muted small pad">No tracked time this week.</div>}
        {perProject.map((p) => {
          const active = Date.now() - p.last < 6 * 60 * 1000;
          return (
            <div className="dt-row" key={p.name}>
              <span className="dt-name">{p.name}</span>
              <span>{fmtShort(p.secs)}</span>
              <span className={active ? "status active" : "status idle"}>{active ? "Active" : "Idle"}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PerformanceChart({ daily }: { daily: number[] }) {
  const w = 640, h = 160; const max = Math.max(1, ...daily);
  const step = w / (daily.length - 1);
  const pts = daily.map((v, i) => [i * step, h - (v / max) * (h - 20) - 10]);
  const line = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" ");
  const area = `${line} L ${w} ${h} L 0 ${h} Z`;
  return (
    <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      <defs>
        <linearGradient id="perf" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#000065" stopOpacity="0.25" />
          <stop offset="1" stopColor="#000065" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#perf)" />
      <path d={line} fill="none" stroke="#000065" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
