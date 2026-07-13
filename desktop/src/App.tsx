import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import CircularTimer from "./CircularTimer";
import LightRays from "./LightRays";
import {
  api,
  clearToken,
  getToken,
  setToken,
  type Project,
  type Session,
} from "./api";

type View = "home" | "timer" | "productivity";

const TILE_COLORS = ["#000065", "#FF6600", "#1f9d63", "#7a34c9", "#c9346b", "#2a7fd4"];
function tileColor(id: string): string {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return TILE_COLORS[h % TILE_COLORS.length];
}

function startOfToday(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function fmtShort(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function fmtClock(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s
    .toString()
    .padStart(2, "0")}`;
}

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
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await api<{ token: string }>("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      setToken(res.token);
      onLogin();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
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
          <button type="submit" disabled={loading}>
            {loading ? "Signing in…" : "Log in"}
          </button>
        </form>
      </div>
    </div>
  );
}

function Tracker({ onLogout }: { onLogout: () => void }) {
  const [view, setView] = useState<View>("home");
  const [projects, setProjects] = useState<Project[]>([]);
  const [today, setToday] = useState<Session[]>([]);
  const [active, setActive] = useState<Session | null>(null);
  const [activeProject, setActiveProject] = useState<Project | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const deviceId = useRef<string | null>(null);
  const heartbeat = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    try {
      const [p, s] = await Promise.all([
        api<Project[]>("/projects"),
        api<Session[]>(`/sessions?from=${startOfToday()}`),
      ]);
      setProjects(p);
      setToday(s);
      const open = s.find((x) => !x.endedAt);
      if (open) {
        setActive(open);
        setActiveProject(p.find((pr) => pr.id === open.projectId) ?? null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    }
  }, []);

  useEffect(() => {
    invoke<string>("get_device_id").then((id) => (deviceId.current = id)).catch(() => {});
    load();
  }, [load]);

  // Tick elapsed while a session is active.
  useEffect(() => {
    if (!active) return;
    const start = new Date(active.startedAt).getTime();
    const tick = () => setElapsed((Date.now() - start) / 1000);
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [active]);

  function beginHeartbeat(sessionId: string) {
    stopHeartbeat();
    heartbeat.current = setInterval(() => {
      api(`/sessions/${sessionId}/heartbeat`, { method: "POST" }).catch(() => {});
    }, 60_000);
  }
  function stopHeartbeat() {
    if (heartbeat.current) clearInterval(heartbeat.current);
    heartbeat.current = null;
  }

  async function start(project: Project) {
    setError(null);
    try {
      const s = await api<Session>("/sessions/start", {
        method: "POST",
        body: JSON.stringify({
          projectId: project.id,
          taskId: project.tasks?.find((t) => t.status !== "done")?.id,
          deviceId: deviceId.current ?? undefined,
          platform: "windows",
          appVersion: "0.1.0",
        }),
      });
      setActive(s);
      setActiveProject(project);
      beginHeartbeat(s.id);
      setView("timer");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start");
    }
  }

  async function stop() {
    if (!active) return;
    try {
      await api(`/sessions/${active.id}/stop`, {
        method: "POST",
        body: JSON.stringify({ endReason: "stopped" }),
      });
    } catch {
      /* ignore — will reconcile on next load */
    }
    stopHeartbeat();
    setActive(null);
    setActiveProject(null);
    setElapsed(0);
    setView("home");
    load();
  }

  // Per-project seconds tracked today (closed + the live one).
  function projectSecondsToday(projectId: string): number {
    return today
      .filter((s) => s.projectId === projectId)
      .reduce((acc, s) => {
        const end = s.endedAt ? new Date(s.endedAt).getTime() : Date.now();
        return acc + (end - new Date(s.startedAt).getTime()) / 1000;
      }, 0);
  }

  return (
    <div className="screen">
      <header className="topbar">
        <span className="topbar-brand">
          <img src="/brand/icon-badge.svg" alt="" className="topbar-mark" />
          Trax
        </span>
        <button className="link" onClick={() => { clearToken(); onLogout(); }}>Sign out</button>
      </header>

      {error && <div className="error">{error}</div>}

      {view === "home" && (
        <Home
          projects={projects}
          active={active}
          activeProject={activeProject}
          elapsed={elapsed}
          onOpenTimer={() => setView("timer")}
          onStart={start}
          secondsToday={projectSecondsToday}
        />
      )}

      {view === "timer" && (
        <TimerView
          active={active}
          project={activeProject}
          elapsed={elapsed}
          onStop={stop}
          onBack={() => setView("home")}
        />
      )}

      {view === "productivity" && <Productivity today={today} />}

      <nav className="tabbar">
        <button className={view === "home" ? "tab active" : "tab"} onClick={() => setView("home")} aria-label="Home">🏠</button>
        <button className="tab fab" onClick={() => setView(active ? "timer" : "home")} aria-label="Timer">⏱</button>
        <button className={view === "productivity" ? "tab active" : "tab"} onClick={() => setView("productivity")} aria-label="Productivity">📊</button>
      </nav>
    </div>
  );
}

function Home({
  projects, active, activeProject, elapsed, onOpenTimer, onStart, secondsToday,
}: {
  projects: Project[];
  active: Session | null;
  activeProject: Project | null;
  elapsed: number;
  onOpenTimer: () => void;
  onStart: (p: Project) => void;
  secondsToday: (id: string) => number;
}) {
  return (
    <div className="home">
      {active && activeProject && (
        <button className="running-card" onClick={onOpenTimer}>
          <div>
            <div className="running-time">{fmtClock(elapsed)}</div>
            <div className="running-proj"><span className="dot" /> {activeProject.name}</div>
          </div>
          <span className="chip work">Tracking</span>
        </button>
      )}

      <div className="section-head">
        <h2>Today</h2>
      </div>

      <div className="task-list">
        {projects.length === 0 && <div className="muted">No projects yet. Ask your admin to add one.</div>}
        {projects.map((p) => {
          const isActive = active?.projectId === p.id;
          return (
            <div key={p.id} className="task-card">
              <span className="task-icon" style={{ background: tileColor(p.id) }}>
                {p.name.slice(0, 1).toUpperCase()}
              </span>
              <div className="task-meta">
                <div className="task-name">{p.name}</div>
                <div className="task-chips">
                  {p.clientTag && <span className="chip">{p.clientTag}</span>}
                  {p.tasks?.some((t) => t.status !== "done") && <span className="chip alt">In progress</span>}
                </div>
              </div>
              <div className="task-right">
                <div className="task-time">{fmtShort(secondsToday(p.id))}</div>
                <button
                  className={isActive ? "play playing" : "play"}
                  disabled={Boolean(active) && !isActive}
                  onClick={() => (isActive ? onOpenTimer() : onStart(p))}
                >
                  {isActive ? "▮▮" : "▶"}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TimerView({
  active, project, elapsed, onStop, onBack,
}: {
  active: Session | null;
  project: Project | null;
  elapsed: number;
  onStop: () => void;
  onBack: () => void;
}) {
  if (!active || !project) {
    return (
      <div className="timer-view">
        <p className="muted">No active session.</p>
        <button className="ghost" onClick={onBack}>Back</button>
      </div>
    );
  }
  const task = project.tasks?.find((t) => t.id === active.taskId);
  return (
    <div className="timer-view">
      <div className="timer-head">
        <button className="link" onClick={onBack}>←</button>
        <span className="timer-title">{project.name}</span>
        <span className="chip work">Work</span>
      </div>
      {task && <div className="timer-task"><span className="dot" /> {task.title}</div>}
      <CircularTimer seconds={elapsed} label={task?.title ?? ""} />
      <div className="timer-controls">
        <button className="control stop" onClick={onStop}>
          <span>◼</span>
          <small>Stop</small>
        </button>
      </div>
    </div>
  );
}

function Productivity({ today }: { today: Session[] }) {
  const totalSeconds = today.reduce((acc, s) => {
    const end = s.endedAt ? new Date(s.endedAt).getTime() : Date.now();
    return acc + (end - new Date(s.startedAt).getTime()) / 1000;
  }, 0);
  const completed = today.filter((s) => s.endedAt).length;

  return (
    <div className="productivity">
      <h2>My Productivity</h2>
      <div className="stat-row">
        <div className="stat-tile">
          <div className="stat-ico green">✓</div>
          <div className="stat-label">Sessions</div>
          <div className="stat-value">{completed}</div>
        </div>
        <div className="stat-tile">
          <div className="stat-ico">◷</div>
          <div className="stat-label">Time Duration</div>
          <div className="stat-value">{fmtShort(totalSeconds)}</div>
        </div>
      </div>
      <p className="muted small">Detailed daily/weekly charts appear in the web dashboard.</p>
    </div>
  );
}
