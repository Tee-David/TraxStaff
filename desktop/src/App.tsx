import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import Counter from "./Counter";
import {
  api,
  clearToken,
  getToken,
  setToken,
  type Project,
  type Session,
} from "./api";

function TimerClock({ seconds }: { seconds: number }) {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const opts = { fontSize: 48, textColor: "#000065", fontWeight: 700 } as const;
  return (
    <div className="clock">
      <Counter value={h} places={[10, 1]} {...opts} />
      <span className="clock-sep">:</span>
      <Counter value={m} places={[10, 1]} {...opts} />
      <span className="clock-sep">:</span>
      <Counter value={sec} places={[10, 1]} {...opts} />
    </div>
  );
}

export default function App() {
  const [authed, setAuthed] = useState(Boolean(getToken()));

  if (!authed) return <Login onLogin={() => setAuthed(true)} />;
  return <Timer onLogout={() => setAuthed(false)} />;
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
    <div className="screen">
      <div className="brand">Trax</div>
      <form onSubmit={submit} className="stack">
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        {error && <div className="error">{error}</div>}
        <button type="submit" disabled={loading}>
          {loading ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}

function Timer({ onLogout }: { onLogout: () => void }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState("");
  const [taskId, setTaskId] = useState("");
  const [session, setSession] = useState<Session | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const deviceIdRef = useRef<string | null>(null);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    invoke<string>("get_device_id")
      .then((id) => (deviceIdRef.current = id))
      .catch(() => (deviceIdRef.current = null));
    api<Project[]>("/projects")
      .then((p) => {
        setProjects(p);
        if (p[0]) setProjectId(p[0].id);
      })
      .catch((e) => setError(e.message));
  }, []);

  // Tick the elapsed clock while a session is running.
  useEffect(() => {
    if (!session) return;
    const start = new Date(session.startedAt).getTime();
    const tick = () => setElapsed((Date.now() - start) / 1000);
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [session]);

  async function start() {
    setError(null);
    try {
      const s = await api<Session>("/sessions/start", {
        method: "POST",
        body: JSON.stringify({
          projectId,
          taskId: taskId || undefined,
          deviceId: deviceIdRef.current ?? undefined,
          platform: "windows",
          appVersion: "0.1.0",
        }),
      });
      setSession(s);
      heartbeatRef.current = setInterval(() => {
        api(`/sessions/${s.id}/heartbeat`, { method: "POST" }).catch(() => {});
      }, 60_000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start");
    }
  }

  async function stop() {
    if (!session) return;
    setError(null);
    try {
      await api(`/sessions/${session.id}/stop`, {
        method: "POST",
        body: JSON.stringify({ endReason: "stopped" }),
      });
      setSession(null);
      setElapsed(0);
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not stop");
    }
  }

  const selectedProject = projects.find((p) => p.id === projectId);

  return (
    <div className="screen">
      <div className="row">
        <div className="brand">Trax</div>
        <button
          className="link"
          onClick={() => {
            clearToken();
            onLogout();
          }}
        >
          Sign out
        </button>
      </div>

      <TimerClock seconds={elapsed} />
      <div className="status">{session ? "Tracking" : "Not tracking"}</div>

      <div className="stack">
        <select
          value={projectId}
          onChange={(e) => {
            setProjectId(e.target.value);
            setTaskId("");
          }}
          disabled={Boolean(session)}
        >
          {projects.length === 0 && <option value="">No projects</option>}
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>

        <select
          value={taskId}
          onChange={(e) => setTaskId(e.target.value)}
          disabled={Boolean(session)}
        >
          <option value="">No task</option>
          {selectedProject?.tasks?.map((t) => (
            <option key={t.id} value={t.id}>
              {t.title}
            </option>
          ))}
        </select>

        {error && <div className="error">{error}</div>}

        {session ? (
          <button className="stop" onClick={stop}>
            Stop
          </button>
        ) : (
          <button className="start" onClick={start} disabled={!projectId}>
            Start
          </button>
        )}
      </div>
    </div>
  );
}
