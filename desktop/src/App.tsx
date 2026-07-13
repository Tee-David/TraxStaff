import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
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
  if (!authed) return <Login onLogin={() => setAuthed(true)} />;
  return <Tracker onLogout={() => setAuthed(false)} />;
}

function Login({ onLogin }: { onLogin: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
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
          <input type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} required />
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
  const [todo, setTodo] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [idleMin, setIdleMin] = useState<number | null>(null);
  const deviceId = useRef<string | null>(null);
  const heartbeat = useRef<ReturnType<typeof setInterval> | null>(null);

  // Idle prompt from the native capture engine.
  useEffect(() => {
    const un = listen<number>("trax:idle", (e) => setIdleMin(e.payload));
    return () => { un.then((f) => f()); };
  }, []);

  const load = useCallback(async () => {
    try {
      const [p, s] = await Promise.all([
        api<Project[]>("/projects"),
        api<Session[]>(`/sessions?from=${startOfWeek().toISOString()}`),
      ]);
      setProjects(p); setWeek(s);
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

  async function start() {
    if (!projectId) return; setError(null);
    try {
      const s = await api<Session>("/sessions/start", { method: "POST", body: JSON.stringify({ projectId, taskId: taskId || undefined, deviceId: deviceId.current ?? undefined, platform: "windows", appVersion: "0.1.0" }) });
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
  const selectedProject = projects.find((p) => p.id === projectId);

  return (
    <div className="app-shell">
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
          projects={projects} selectedProject={selectedProject}
          projectId={projectId} setProjectId={(v) => { setProjectId(v); setTaskId(""); }}
          taskId={taskId} setTaskId={setTaskId} todo={todo} setTodo={setTodo}
          active={active} elapsed={elapsed} workedToday={liveToday} workedWeek={workedWeek}
          today={today} onStart={start} onStop={stop} error={error}
          onSignOut={() => { clearToken(); onLogout(); }}
        />
      </aside>
      <main className="dash-pane">
        <DesktopDashboard projects={projects} week={week} workedWeek={workedWeek} />
      </main>
    </div>
  );
}

function Sparkline({ points, color = "#00c2b8" }: { points: number[]; color?: string }) {
  const w = 220, h = 48; const max = Math.max(1, ...points);
  const step = points.length > 1 ? w / (points.length - 1) : w;
  const path = points.map((v, i) => `${i === 0 ? "M" : "L"} ${(i * step).toFixed(1)} ${(h - (v / max) * (h - 6) - 3).toFixed(1)}`).join(" ");
  return (
    <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      <path d={path} fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function TrackingWidget(props: {
  projects: Project[]; selectedProject?: Project; projectId: string; setProjectId: (v: string) => void;
  taskId: string; setTaskId: (v: string) => void; todo: string; setTodo: (v: string) => void;
  active: Session | null; elapsed: number; workedToday: number; workedWeek: number; today: Session[];
  onStart: () => void; onStop: () => void; error: string | null; onSignOut: () => void;
}) {
  const { projects, selectedProject, projectId, setProjectId, taskId, setTaskId, todo, setTodo, active, elapsed, workedToday, workedWeek, today, onStart, onStop, error, onSignOut } = props;
  // hourly focus sparkline for today
  const hourly = useMemo(() => {
    const arr = new Array(12).fill(0); // 8..19
    for (const s of today) {
      const st = new Date(s.startedAt), en = s.endedAt ? new Date(s.endedAt) : new Date();
      let cur = new Date(st);
      while (cur < en) { const h = cur.getHours(); const nxt = new Date(cur); nxt.setMinutes(60, 0, 0); const slice = (Math.min(en.getTime(), nxt.getTime()) - cur.getTime()) / 60000; if (h >= 8 && h < 20) arr[h - 8] += slice; cur = nxt; }
    }
    return arr;
  }, [today]);
  const focusPct = Math.min(100, Math.round((workedToday / DAY_TARGET_SECONDS) * 100));

  return (
    <div className="widget">
      <div className="widget-brand"><img src="/brand/icon-badge.svg" alt="" /> Trax</div>

      <div className="widget-metrics">
        <div>
          <div className="wm-label">Progress Today</div>
          <div className="wm-timer">{fmtClock(active ? elapsed + (workedToday - elapsed) : workedToday)}</div>
        </div>
        <div className="wm-side">
          <div className="wm-label">This week</div>
          <div className="wm-val">{fmtClock(workedWeek)}</div>
        </div>
      </div>

      <div className="widget-spark">
        <Sparkline points={hourly} />
        <span className="focus-badge">Focus {focusPct}%</span>
      </div>
      <div className="wm-target">
        <span className="wm-label">Target time</span>
        <span className="wm-val small">{fmtClock(DAY_TARGET_SECONDS)}</span>
      </div>

      <label className="field-label">Project</label>
      <select className="field" value={projectId} onChange={(e) => setProjectId(e.target.value)} disabled={Boolean(active)}>
        {projects.length === 0 && <option value="">No projects</option>}
        {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>

      <label className="field-label">Main Task</label>
      <select className="field" value={taskId} onChange={(e) => setTaskId(e.target.value)} disabled={Boolean(active)}>
        <option value="">No task</option>
        {selectedProject?.tasks?.filter((t) => t.status !== "done").map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
      </select>

      <label className="field-label">To do</label>
      <textarea className="field todo" placeholder="Working on…" value={todo} onChange={(e) => setTodo(e.target.value)} rows={2} />

      {error && <div className="error">{error}</div>}

      {active ? (
        <button className="start-btn stop" onClick={onStop}>◼ Stop</button>
      ) : (
        <button className="start-btn" onClick={onStart} disabled={!projectId}>▶ Start Now</button>
      )}

      <div className="widget-foot">
        <span className="muted small">Trax Desktop</span>
        <button className="link" onClick={onSignOut}>Sign out</button>
      </div>
    </div>
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
