"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { Project, Session } from "@/lib/types";
import type { ReportSummary } from "@/lib/reports";
import { Badge, Card } from "@/components/ui";
import { Donut } from "@/components/Donut";
import CountUp from "@/components/CountUp";
import { formatDurationShort, formatTime, sessionSeconds } from "@/lib/format";

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}
function startOfWeek(): Date {
  const d = startOfToday();
  const day = (d.getDay() + 6) % 7; // Monday=0
  d.setDate(d.getDate() - day);
  return d;
}

const DONUT_COLORS = ["#000065", "#FF6600", "#1f9d63", "#8a93a8"];
const WORKDAY = Array.from({ length: 11 }, (_, i) => 8 + i); // 8:00–18:00

export default function DashboardPage() {
  const { user } = useAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [week, setWeek] = useState<Session[]>([]);
  const [summary, setSummary] = useState<ReportSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api<Project[]>("/projects"),
      api<Session[]>(`/sessions?from=${startOfWeek().toISOString()}`),
      api<ReportSummary>(`/reports/summary?from=${startOfToday().toISOString()}`),
    ])
      .then(([p, s, sum]) => {
        setProjects(p);
        setWeek(s);
        setSummary(sum);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const today = useMemo(
    () => week.filter((s) => new Date(s.startedAt) >= startOfToday()),
    [week]
  );

  const activeProjects = projects.filter((p) => !p.archivedAt).length;
  const ongoingTasks = projects.reduce((a, p) => a + (p.tasks?.filter((t) => t.status !== "done").length ?? 0), 0);
  const completedTasks = projects.reduce((a, p) => a + (p.tasks?.filter((t) => t.status === "done").length ?? 0), 0);
  const workedWeek = week.reduce((a, s) => a + sessionSeconds(s.startedAt, s.endedAt), 0);
  const workedToday = today.reduce((a, s) => a + sessionSeconds(s.startedAt, s.endedAt), 0);
  const running = today.find((s) => !s.endedAt);
  const firstStart = today.length ? today[today.length - 1].startedAt : null;

  // Hourly worked-minutes for today's timeline.
  const hourly = useMemo(() => {
    const mins = new Array(24).fill(0);
    for (const s of today) {
      const start = new Date(s.startedAt);
      const end = s.endedAt ? new Date(s.endedAt) : new Date();
      let cur = new Date(start);
      while (cur < end) {
        const h = cur.getHours();
        const next = new Date(cur);
        next.setMinutes(60, 0, 0);
        const slice = (Math.min(end.getTime(), next.getTime()) - cur.getTime()) / 60000;
        mins[h] += slice;
        cur = next;
      }
    }
    return mins;
  }, [today]);
  const maxHour = Math.max(1, ...WORKDAY.map((h) => hourly[h]));

  // Top projects today → the four rings.
  const topToday = useMemo(() => {
    const by = new Map<string, { name: string; secs: number }>();
    for (const s of today) {
      const e = by.get(s.projectId) ?? { name: s.project.name, secs: 0 };
      e.secs += sessionSeconds(s.startedAt, s.endedAt);
      by.set(s.projectId, e);
    }
    return [...by.values()].sort((a, b) => b.secs - a.secs).slice(0, 4);
  }, [today]);

  return (
    <div>
      {/* Timer status bar */}
      <Card className="mb-5 flex items-center justify-between px-5 py-3">
        <div className="flex items-center gap-2 text-sm">
          <span className={`h-2 w-2 rounded-full ${running ? "bg-green-500" : "bg-border"}`} />
          <span className="font-medium">
            {running ? `Tracking · ${running.project.name}` : "Not tracking"}
          </span>
        </div>
        <div className="flex items-center gap-4 text-sm text-muted">
          <span>Today · {formatDurationShort(workedToday)}</span>
          {firstStart && <span>Start {formatTime(firstStart)}</span>}
        </div>
      </Card>

      <div className="mb-5 flex items-end justify-between">
        <div>
          <h1 className="text-2xl">
            {new Date().toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })}
          </h1>
          <p className="text-sm text-muted">Welcome back, {user?.email}</p>
        </div>
      </div>

      {/* Stat cards */}
      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard i={0} icon="📁" value={activeProjects} label="Active projects" />
        <StatCard i={1} icon="⏳" value={ongoingTasks} label="Ongoing tasks" />
        <StatCard i={2} icon="✅" value={completedTasks} label="Completed tasks" />
        <StatCard i={3} icon="⏱" valueText={formatDurationShort(workedWeek)} label="Worked this week" />
      </div>

      {loading ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
          {/* Timeline */}
          <Card className="p-5 lg:col-span-2">
            <div className="mb-4 flex items-center gap-2">
              <span>🕐</span>
              <h2 className="text-lg">Timeline</h2>
            </div>
            <div className="mb-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Metric label="Work of day" value={summary?.avgActivityPct != null ? `${summary.avgActivityPct}%` : "—"} />
              <Metric label="Total worked" value={formatDurationShort(workedToday)} />
              <Metric label="Project" value={topToday[0]?.name ?? "—"} />
              <Metric label="Time start" value={firstStart ? formatTime(firstStart) : "—"} />
            </div>

            {/* Hourly bars */}
            <div className="flex h-40 items-end gap-2">
              {WORKDAY.map((h) => (
                <div key={h} className="flex flex-1 flex-col items-center gap-1">
                  <div className="flex w-full flex-1 items-end">
                    <motion.div
                      className="w-full rounded-md bg-brand/80"
                      initial={{ height: 0 }}
                      animate={{ height: `${(hourly[h] / maxHour) * 100}%` }}
                      transition={{ duration: 0.5, delay: 0.03 * (h - 8) }}
                    />
                  </div>
                  <span className="text-[10px] text-muted">{h}:00</span>
                </div>
              ))}
            </div>

            {/* Four rings */}
            <div className="mt-5 grid grid-cols-2 gap-4 border-t border-border pt-4 sm:grid-cols-4">
              {topToday.length === 0 ? (
                <p className="col-span-4 text-sm text-muted">No time tracked today yet.</p>
              ) : (
                topToday.map((p, i) => (
                  <Donut
                    key={p.name}
                    value={workedToday ? (p.secs / workedToday) * 100 : 0}
                    color={DONUT_COLORS[i]}
                    label={`${Math.round(workedToday ? (p.secs / workedToday) * 100 : 0)}%`}
                    sublabel={p.name}
                  />
                ))
              )}
            </div>
          </Card>

          {/* Project & Tasks */}
          <Card className="p-5">
            <div className="mb-4 flex items-center gap-2">
              <span>🗂</span>
              <h2 className="text-lg">Projects &amp; Tasks</h2>
            </div>
            <div className="space-y-4">
              {projects.slice(0, 5).map((p) => {
                const total = p.tasks?.length ?? 0;
                const done = p.tasks?.filter((t) => t.status === "done").length ?? 0;
                const pct = total ? Math.round((done / total) * 100) : 0;
                return (
                  <div key={p.id}>
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-sm font-medium">{p.name}</span>
                      <Donut value={pct} size={34} stroke={5} label={undefined} />
                    </div>
                    <div className="space-y-1.5">
                      {(p.tasks ?? []).slice(0, 3).map((t) => (
                        <div key={t.id} className="flex items-center gap-2 text-sm">
                          <span className={t.status === "done" ? "text-green-600" : "text-border"}>
                            {t.status === "done" ? "☑" : "☐"}
                          </span>
                          <span className={t.status === "done" ? "text-muted line-through" : ""}>{t.title}</span>
                        </div>
                      ))}
                      {total === 0 && <p className="text-xs text-muted">No tasks</p>}
                    </div>
                  </div>
                );
              })}
              {projects.length === 0 && <p className="text-sm text-muted">No projects yet.</p>}
            </div>
          </Card>
        </div>
      )}

      {/* Project History */}
      <Card className="mt-5 p-5">
        <div className="mb-4 flex items-center gap-2">
          <span>📜</span>
          <h2 className="text-lg">Project History</h2>
        </div>
        {week.length === 0 ? (
          <p className="text-sm text-muted">No sessions yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                  <th className="pb-2 font-medium">Project</th>
                  <th className="pb-2 font-medium">Member</th>
                  <th className="pb-2 font-medium">Date</th>
                  <th className="pb-2 font-medium">Work hour</th>
                  <th className="pb-2 font-medium">Total</th>
                </tr>
              </thead>
              <tbody>
                {week.slice(0, 8).map((s) => (
                  <tr key={s.id} className="border-b border-border/60 last:border-0">
                    <td className="py-2.5 font-medium">
                      {s.project.name}
                      {s.task && <span className="ml-2 text-xs text-muted">{s.task.title}</span>}
                    </td>
                    <td className="py-2.5">
                      <Badge tone="brand">{s.user.email.split("@")[0]}</Badge>
                    </td>
                    <td className="py-2.5 text-muted">{new Date(s.startedAt).toLocaleDateString()}</td>
                    <td className="py-2.5 text-muted">
                      {formatTime(s.startedAt)}
                      {s.endedAt ? ` – ${formatTime(s.endedAt)}` : ""}
                    </td>
                    <td className="py-2.5">{formatDurationShort(sessionSeconds(s.startedAt, s.endedAt))}</td>
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

function StatCard({ i, icon, value, valueText, label }: { i: number; icon: string; value?: number; valueText?: string; label: string }) {
  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, delay: i * 0.06 }}>
      <Card className="flex items-center gap-3 p-4">
        <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-canvas text-lg">{icon}</span>
        <div>
          <div className="font-heading text-2xl font-bold text-ink">
            {valueText ?? <CountUp to={value ?? 0} duration={1} />}
          </div>
          <div className="text-xs text-muted">{label}</div>
        </div>
      </Card>
    </motion.div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-muted">{label}</div>
      <div className="mt-0.5 font-heading text-base font-semibold">{value}</div>
    </div>
  );
}
