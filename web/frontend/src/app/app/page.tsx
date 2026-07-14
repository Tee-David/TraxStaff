"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { Project, Session } from "@/lib/types";
import type { ReportSummary } from "@/lib/reports";
import { Badge, Card, EmptyState, PageHeader, Section, Skeleton, StatTile } from "@/components/ui";
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
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}

const CAT = ["var(--color-cat-focus)", "var(--color-cat-meeting)", "var(--color-cat-other)", "var(--color-cat-break)"];
const WORKDAY = Array.from({ length: 11 }, (_, i) => 8 + i);
const CHIP = ["brand", "accent", "teal", "green", "red"] as const;
function chipTone(email: string) {
  let h = 0;
  for (const c of email) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return CHIP[h % CHIP.length];
}

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

  const today = useMemo(() => week.filter((s) => new Date(s.startedAt) >= startOfToday()), [week]);
  const activeProjects = projects.filter((p) => !p.archivedAt).length;
  const ongoingTasks = projects.reduce((a, p) => a + (p.tasks?.filter((t) => t.status !== "done").length ?? 0), 0);
  const completedTasks = projects.reduce((a, p) => a + (p.tasks?.filter((t) => t.status === "done").length ?? 0), 0);
  const workedWeek = week.reduce((a, s) => a + sessionSeconds(s.startedAt, s.endedAt), 0);
  const workedToday = today.reduce((a, s) => a + sessionSeconds(s.startedAt, s.endedAt), 0);
  const running = today.find((s) => !s.endedAt);
  const firstStart = today.length ? today[today.length - 1].startedAt : null;

  const hourly = useMemo(() => {
    const mins = new Array(24).fill(0);
    for (const s of today) {
      let cur = new Date(s.startedAt);
      const end = s.endedAt ? new Date(s.endedAt) : new Date();
      while (cur < end) {
        const next = new Date(cur);
        next.setMinutes(60, 0, 0);
        mins[cur.getHours()] += (Math.min(end.getTime(), next.getTime()) - cur.getTime()) / 60000;
        cur = next;
      }
    }
    return mins;
  }, [today]);
  const maxHour = Math.max(1, ...WORKDAY.map((h) => hourly[h]));

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
      <PageHeader
        title={new Date().toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })}
        subtitle={`Welcome back, ${user?.email ?? ""}`}
        actions={
          <Badge tone={running ? "green" : "muted"} dot>
            {running ? `Tracking · ${running.project.name}` : "Not tracking"}
          </Badge>
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile icon="📁" tone="brand" label="Active projects" value={<CountUp to={activeProjects} duration={1} />} />
        <StatTile icon="⏳" tone="accent" label="Ongoing tasks" value={<CountUp to={ongoingTasks} duration={1} />} />
        <StatTile icon="✅" tone="teal" label="Completed tasks" value={<CountUp to={completedTasks} duration={1} />} />
        <StatTile icon="⏱" tone="muted" label="Worked this week" value={<span className="text-[22px]">{formatDurationShort(workedWeek)}</span>} />
      </div>

      {loading ? (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
          <Skeleton className="h-80 lg:col-span-2" />
          <Skeleton className="h-80" />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
          {/* Timeline */}
          <Section title="Timeline" icon="🕐" className="lg:col-span-2" bodyClassName="p-5">
            <div className="mb-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Metric label="Work of day" value={summary?.avgActivityPct != null ? `${summary.avgActivityPct}%` : "—"} />
              <Metric label="Total worked" value={formatDurationShort(workedToday)} />
              <Metric label="Top project" value={topToday[0]?.name ?? "—"} />
              <Metric label="First start" value={firstStart ? formatTime(firstStart) : "—"} />
            </div>

            <div className="flex h-40 items-end gap-1.5">
              {WORKDAY.map((h) => (
                <div key={h} className="group relative flex flex-1 flex-col items-center gap-1">
                  <div className="flex w-full flex-1 items-end">
                    <motion.div
                      className="w-full rounded-md bg-brand/85 group-hover:bg-brand"
                      initial={{ height: 0 }}
                      animate={{ height: `${(hourly[h] / maxHour) * 100}%` }}
                      transition={{ duration: 0.5, delay: 0.03 * (h - 8) }}
                    />
                  </div>
                  <span className="text-[10px] text-faint">{h}</span>
                  {hourly[h] > 0 && (
                    <div className="pointer-events-none absolute -top-9 z-10 whitespace-nowrap rounded-lg bg-ink px-2.5 py-1.5 text-[11px] font-medium text-white opacity-0 shadow-lg transition group-hover:opacity-100">
                      {h}:00 · {formatDurationShort(hourly[h] * 60)}
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div className="mt-5 grid grid-cols-2 gap-4 border-t border-border pt-4 sm:grid-cols-4">
              {topToday.length === 0 ? (
                <p className="col-span-4 text-sm text-muted">No time tracked today yet.</p>
              ) : (
                topToday.map((p, i) => (
                  <Donut
                    key={p.name}
                    value={workedToday ? (p.secs / workedToday) * 100 : 0}
                    color={CAT[i]}
                    label={`${Math.round(workedToday ? (p.secs / workedToday) * 100 : 0)}%`}
                    sublabel={p.name}
                  />
                ))
              )}
            </div>
          </Section>

          {/* Projects & Tasks */}
          <Section title="Projects & Tasks" icon="🗂" bodyClassName="p-5">
            <div className="space-y-5">
              {projects.slice(0, 5).map((p) => {
                const total = p.tasks?.length ?? 0;
                const done = p.tasks?.filter((t) => t.status === "done").length ?? 0;
                const pct = total ? Math.round((done / total) * 100) : 0;
                return (
                  <div key={p.id}>
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-sm font-semibold">{p.name}</span>
                      <span className="tnum text-xs font-semibold text-brand">{pct}%</span>
                    </div>
                    <div className="space-y-1.5">
                      {(p.tasks ?? []).slice(0, 3).map((t) => (
                        <div key={t.id} className="flex items-center gap-2 text-sm">
                          <span className={t.status === "done" ? "text-[var(--color-positive)]" : "text-border-strong"}>
                            {t.status === "done" ? "◉" : "○"}
                          </span>
                          <span className={t.status === "done" ? "text-muted line-through" : ""}>{t.title}</span>
                        </div>
                      ))}
                      {total === 0 && <p className="text-xs text-faint">No tasks yet</p>}
                    </div>
                  </div>
                );
              })}
              {projects.length === 0 && <p className="text-sm text-muted">No projects yet.</p>}
            </div>
          </Section>
        </div>
      )}

      {/* Project History */}
      <div className="mt-5">
        {loading ? (
          <Skeleton className="h-48" />
        ) : week.length === 0 ? (
          <EmptyState icon="🗓" title="No sessions yet" hint="Start tracking from the Trax desktop app and your activity will appear here." />
        ) : (
          <Section title="Project History" icon="📜" bodyClassName="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-faint">
                    <th className="px-5 py-3 font-medium">Project</th>
                    <th className="px-5 py-3 font-medium">Member</th>
                    <th className="px-5 py-3 font-medium">Date</th>
                    <th className="px-5 py-3 font-medium">Work hour</th>
                    <th className="px-5 py-3 font-medium">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {week.slice(0, 8).map((s) => (
                    <tr key={s.id} className="border-b border-border/60 transition last:border-0 hover:bg-canvas/60">
                      <td className="px-5 py-3 font-medium">
                        {s.project.name}
                        {s.task && <span className="ml-2 text-xs text-muted">{s.task.title}</span>}
                      </td>
                      <td className="px-5 py-3">
                        <Badge tone={chipTone(s.user.email)} dot>
                          {s.user.email.split("@")[0]}
                        </Badge>
                      </td>
                      <td className="px-5 py-3 text-muted">{new Date(s.startedAt).toLocaleDateString()}</td>
                      <td className="px-5 py-3 tnum text-muted">
                        {formatTime(s.startedAt)}
                        {s.endedAt ? ` – ${formatTime(s.endedAt)}` : ""}
                      </td>
                      <td className="px-5 py-3 tnum font-medium">{formatDurationShort(sessionSeconds(s.startedAt, s.endedAt))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
        )}
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-muted">{label}</div>
      <div className="mt-0.5 truncate font-heading text-[15px] font-semibold">{value}</div>
    </div>
  );
}
