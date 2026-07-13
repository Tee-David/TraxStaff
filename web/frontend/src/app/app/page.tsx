"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { Session } from "@/lib/types";
import { Badge, Card } from "@/components/ui";
import CountUp from "@/components/CountUp";
import {
  formatDurationShort,
  formatTime,
  sessionSeconds,
} from "@/lib/format";

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

export default function DashboardPage() {
  const { user } = useAuth();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api<Session[]>(`/sessions?from=${startOfToday().toISOString()}`)
      .then(setSessions)
      .catch(() => setSessions([]))
      .finally(() => setLoading(false));
  }, []);

  const running = sessions.find((s) => !s.endedAt);
  const totalSeconds = useMemo(
    () => sessions.reduce((acc, s) => acc + sessionSeconds(s.startedAt, s.endedAt), 0),
    [sessions]
  );
  const activeProjects = new Set(sessions.map((s) => s.projectId)).size;

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl">Dashboard</h1>
        <p className="text-sm text-muted">Welcome back, {user?.email}</p>
      </div>

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Stat label="Worked today" value={totalSeconds / 3600} suffix="h" decimals={1} index={0} />
        <Stat label="Sessions today" value={sessions.length} index={1} />
        <Stat label="Projects worked" value={activeProjects} index={2} />
      </div>

      <Card className="mb-6 p-5">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm text-muted">Timer status</div>
            <div className="mt-1 font-heading text-lg">
              {running ? (
                <span className="text-brand">
                  Running · {running.project.name}
                  {running.task ? ` — ${running.task.title}` : ""}
                </span>
              ) : (
                <span className="text-muted">Not tracking</span>
              )}
            </div>
          </div>
          {running ? <Badge tone="green">Live</Badge> : <Badge>Idle</Badge>}
        </div>
        <p className="mt-3 text-xs text-muted">
          Start and stop tracking from the Trax desktop app. Sessions appear here automatically.
        </p>
      </Card>

      <Card className="p-5">
        <h2 className="mb-4 text-lg">Today&rsquo;s activity</h2>
        {loading ? (
          <p className="text-sm text-muted">Loading…</p>
        ) : sessions.length === 0 ? (
          <p className="text-sm text-muted">No time tracked yet today.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                  <th className="pb-2 font-medium">Project</th>
                  <th className="pb-2 font-medium">Task</th>
                  <th className="pb-2 font-medium">Start</th>
                  <th className="pb-2 font-medium">Duration</th>
                  <th className="pb-2 font-medium">Type</th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((s) => (
                  <tr key={s.id} className="border-b border-border/60 last:border-0">
                    <td className="py-2.5 font-medium">{s.project.name}</td>
                    <td className="py-2.5 text-muted">{s.task?.title ?? "—"}</td>
                    <td className="py-2.5 text-muted">{formatTime(s.startedAt)}</td>
                    <td className="py-2.5">
                      {formatDurationShort(sessionSeconds(s.startedAt, s.endedAt))}
                      {!s.endedAt && <span className="ml-1 text-xs text-green-600">(live)</span>}
                    </td>
                    <td className="py-2.5">
                      {s.isManual ? <Badge tone="accent">Manual</Badge> : <Badge tone="brand">Tracked</Badge>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function Stat({
  label,
  value,
  suffix = "",
  decimals = 0,
  index = 0,
}: {
  label: string;
  value: number;
  suffix?: string;
  decimals?: number;
  index?: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: index * 0.08, ease: [0.22, 1, 0.36, 1] }}
    >
      <Card className="p-5">
        <div className="text-sm text-muted">{label}</div>
        <div className="mt-1 flex items-baseline gap-0.5 font-heading text-3xl font-bold text-brand">
          <CountUp to={Number(value.toFixed(decimals))} duration={1} separator="," />
          {suffix && <span className="text-2xl">{suffix}</span>}
        </div>
      </Card>
    </motion.div>
  );
}
