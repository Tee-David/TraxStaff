"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Reorder } from "motion/react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api, asArray } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useActingOrg } from "@/lib/acting-org";
import type { Project, Session } from "@/lib/types";
import { DELETED_USER_LABEL, type ReportSummary } from "@/lib/reports";
import { Badge, EmptyState, PageHeader, Section, Skeleton, StatTile } from "@/components/ui";
import { Donut } from "@/components/Donut";
import { WorkHeatmap } from "@/components/WorkHeatmap";
import CountUp from "@/components/CountUp";
import { formatDurationShort, formatTime, overlapSeconds, ownerName, sessionEnd, sessionSeconds } from "@/lib/format";

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
const WEEK_TARGET_SECONDS = 40 * 3600;
const PROJ_DOTS = ["var(--color-cat-focus)", "#ff6600", "#12b5a5", "#8a5cf6", "#e0457b"];

// Customizable dashboard widgets — order + column span are user-editable and
// persisted. Keep the id list in sync with renderWidget()'s switch.
const WIDGET_IDS = ["timeline", "projects", "heatmap", "weekly", "topweek", "history"] as const;
type WidgetId = (typeof WIDGET_IDS)[number];
const DEFAULT_ORDER: WidgetId[] = ["timeline", "projects", "heatmap", "weekly", "topweek", "history"];
const DEFAULT_SPANS: Record<WidgetId, number> = { timeline: 2, projects: 1, heatmap: 1, weekly: 1, topweek: 1, history: 3 };
const LAYOUT_KEY = "trax_dash_layout_v2";
function spanClass(n: number) {
  return `col-span-1 ${n >= 3 ? "md:col-span-2 lg:col-span-3" : n === 2 ? "md:col-span-2 lg:col-span-2" : ""}`;
}
const CHIP = ["brand", "accent", "teal", "green", "red"] as const;
function chipTone(email: string) {
  let h = 0;
  for (const c of email) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return CHIP[h % CHIP.length];
}

export default function DashboardPage() {
  const { user } = useAuth();
  const router = useRouter();
  const { orgId: actingOrgId } = useActingOrg();

  /**
   * A super admin in their own org has nothing to see here.
   *
   * The platform organization exists only to hold the staff account — no
   * projects, no tracked time — so the dashboard renders a page of zeroes and
   * empty widgets, which reads as "the app is broken" rather than "you are in
   * the wrong org". Sent to the console instead, but only while they are NOT
   * operating on a customer org: once they have switched, this page is showing
   * that org and is exactly where they should be able to stay.
   */
  useEffect(() => {
    if (user?.isSuperAdmin && !actingOrgId) router.replace("/app/platform");
  }, [user?.isSuperAdmin, actingOrgId, router]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [week, setWeek] = useState<Session[]>([]);
  const [summary, setSummary] = useState<ReportSummary | null>(null);
  const [loading, setLoading] = useState(true);

  // Dashboard layout (drag-to-reorder + resize), persisted per browser.
  const [customize, setCustomize] = useState(false);
  const [order, setOrder] = useState<WidgetId[]>(DEFAULT_ORDER);
  const [spans, setSpans] = useState<Record<WidgetId, number>>(DEFAULT_SPANS);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(LAYOUT_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as { order?: WidgetId[]; spans?: Record<WidgetId, number> };
      // Keep only known ids, then append any newly-added widgets.
      const valid = (saved.order ?? []).filter((id): id is WidgetId => WIDGET_IDS.includes(id as WidgetId));
      const merged = [...valid, ...DEFAULT_ORDER.filter((id) => !valid.includes(id))];
      setOrder(merged);
      if (saved.spans) setSpans({ ...DEFAULT_SPANS, ...saved.spans });
    } catch {}
  }, []);

  function persist(nextOrder: WidgetId[], nextSpans: Record<WidgetId, number>) {
    try { localStorage.setItem(LAYOUT_KEY, JSON.stringify({ order: nextOrder, spans: nextSpans })); } catch {}
  }
  function reorder(next: WidgetId[]) { setOrder(next); persist(next, spans); }
  function cycleSpan(id: WidgetId) {
    const next = { ...spans, [id]: (spans[id] % 3) + 1 };
    setSpans(next); persist(order, next);
  }
  function resetLayout() {
    setOrder(DEFAULT_ORDER); setSpans(DEFAULT_SPANS);
    try { localStorage.removeItem(LAYOUT_KEY); } catch {}
  }

  useEffect(() => {
    Promise.all([
      api<Project[]>("/projects"),
      api<Session[]>(`/sessions?from=${startOfWeek().toISOString()}`),
      api<ReportSummary>(`/reports/summary?from=${startOfToday().toISOString()}`),
    ])
      .then(([p, s, sum]) => {
        // Both feed `.map`/`.reduce` below; `api<T[]>` only casts the type.
        setProjects(asArray<Project>(p));
        setWeek(asArray<Session>(s));
        setSummary(sum);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // Windows re-read each render so the day boundary is respected, and membership
  // is decided by OVERLAP rather than by start instant: a session that began
  // before midnight still owns time today, and filtering on `startedAt` showed
  // nothing at all to someone who started their shift the previous evening.
  const nowMs = Date.now();
  const dayStartMs = startOfToday().getTime();
  const weekStartMs = startOfWeek().getTime();
  const today = useMemo(
    () => week.filter((s) => overlapSeconds(s, dayStartMs, nowMs) > 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [week, dayStartMs]
  );
  const activeProjects = projects.filter((p) => !p.archivedAt).length;
  const ongoingTasks = projects.reduce((a, p) => a + (p.tasks?.filter((t) => t.status !== "done").length ?? 0), 0);
  const completedTasks = projects.reduce((a, p) => a + (p.tasks?.filter((t) => t.status === "done").length ?? 0), 0);
  // By overlap, not whole sessions: /sessions now returns anything that overlaps
  // the requested window, so a session that started last week would otherwise add
  // its pre-week hours to this week's total.
  const workedWeek = week.reduce((a, s) => a + overlapSeconds(s, weekStartMs, nowMs), 0);
  const workedToday = today.reduce((a, s) => a + overlapSeconds(s, dayStartMs, nowMs), 0);
  // "Running" means still tracking, which an open row alone does not prove: a
  // session abandoned by a crash stays open forever and used to be reported here
  // as live. The server marks those `abandoned`.
  const running = today.find((s) => !s.endedAt && !s.abandoned);
  const firstStart = today.length ? today[today.length - 1].startedAt : null;

  const hourly = useMemo(() => {
    const mins = new Array(24).fill(0);
    for (const s of today) {
      let cur = new Date(s.startedAt);
      const end = sessionEnd(s);
      while (cur < end) {
        const next = new Date(cur);
        next.setMinutes(60, 0, 0);
        mins[cur.getHours()] += (Math.min(end.getTime(), next.getTime()) - cur.getTime()) / 60000;
        cur = next;
      }
    }
    return mins;
  }, [today]);

  const topToday = useMemo(() => {
    const by = new Map<string, { name: string; secs: number }>();
    for (const s of today) {
      const e = by.get(s.projectId) ?? { name: s.project.name, secs: 0 };
      e.secs += overlapSeconds(s, dayStartMs, nowMs);
      by.set(s.projectId, e);
    }
    return [...by.values()].sort((a, b) => b.secs - a.secs).slice(0, 4);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [today, dayStartMs]);

  const topWeek = useMemo(() => {
    const by = new Map<string, { name: string; secs: number }>();
    for (const s of week) {
      const e = by.get(s.projectId) ?? { name: s.project.name, secs: 0 };
      e.secs += overlapSeconds(s, weekStartMs, nowMs);
      by.set(s.projectId, e);
    }
    return [...by.values()].sort((a, b) => b.secs - a.secs).slice(0, 5);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [week, weekStartMs]);

  const daysActive = useMemo(() => new Set(week.map((s) => new Date(s.startedAt).toDateString())).size, [week]);
  const weekGoalPct = Math.min(100, Math.round((workedWeek / WEEK_TARGET_SECONDS) * 100));
  const timelineData = WORKDAY.map((h) => ({ hour: `${h}:00`, mins: Math.round(hourly[h]) }));

  // Today's sessions as positioned segments across a 7:00–21:00 window (the strip under the graph).
  const DAY_START = 7;
  const DAY_END = 21;
  const todaySegments = useMemo(() => {
    const toH = (d: Date) => d.getHours() + d.getMinutes() / 60;
    const span = DAY_END - DAY_START;
    return today
      .map((s) => {
        const st = new Date(s.startedAt);
        const en = sessionEnd(s);
        const live = !s.endedAt && !s.abandoned;
        const a = Math.max(DAY_START, toH(st));
        const b = Math.min(DAY_END, toH(en));
        // An abandoned session gets a definite end like any closed one — drawing it
        // as still running stretched the bar to the right edge of the day.
        return { id: s.id, name: s.project.name, start: st, end: live ? null : en, running: live, left: ((a - DAY_START) / span) * 100, width: ((b - a) / span) * 100 };
      })
      .filter((g) => g.width > 0);
  }, [today]);

  const resizeAction = (id: WidgetId) =>
    customize ? (
      <button
        onClick={() => cycleSpan(id)}
        title="Resize (columns)"
        className="rounded-lg border border-border px-2 py-1 text-[11px] font-semibold text-muted transition hover:bg-canvas"
      >
        ⤢ {spans[id]}/3
      </button>
    ) : undefined;

  function renderWidget(id: WidgetId) {
    switch (id) {
      case "timeline":
        return (
          <div data-tour="dash-timeline">
          <Section title="Timeline" icon="🕐" bodyClassName="p-5" action={resizeAction("timeline")}>
            <div className="mb-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Metric label="Activity today" value={summary?.avgActivityPct != null ? `${summary.avgActivityPct}%` : "—"} />
              <Metric label="Total worked" value={formatDurationShort(workedToday)} />
              <Metric label="Top project" value={topToday[0]?.name ?? "—"} />
              <Metric label="First start" value={firstStart ? formatTime(firstStart) : "—"} />
            </div>
            <div className="h-52">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={timelineData} margin={{ top: 10, right: 8, bottom: 0, left: -22 }}>
                  <defs>
                    <linearGradient id="tlfill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--color-brand)" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="var(--color-brand)" stopOpacity={0.02} />
                    </linearGradient>
                    <linearGradient id="tlstroke" x1="0" y1="0" x2="1" y2="0">
                      <stop offset="0%" stopColor="var(--color-brand-600)" />
                      <stop offset="100%" stopColor="var(--color-brand)" />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--color-border)" />
                  <XAxis dataKey="hour" tickLine={false} axisLine={false} interval={1} tick={{ fontSize: 11, fill: "var(--color-faint)" }} />
                  <YAxis hide domain={[0, "dataMax"]} />
                  <Tooltip
                    cursor={{ stroke: "var(--color-brand)", strokeWidth: 1, strokeDasharray: "3 3" }}
                    contentStyle={{ borderRadius: 12, border: "1px solid var(--color-border)", background: "var(--color-surface)", fontSize: 12, boxShadow: "var(--shadow-soft)" }}
                    labelStyle={{ color: "var(--color-muted)" }}
                    formatter={(v: number) => [`${v} min`, "Worked"]}
                  />
                  <Area
                    type="monotone"
                    dataKey="mins"
                    stroke="url(#tlstroke)"
                    strokeWidth={2.5}
                    fill="url(#tlfill)"
                    dot={false}
                    activeDot={{ r: 4, fill: "var(--color-brand)", stroke: "var(--color-surface)", strokeWidth: 2 }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>

            {/* Session timeline strip — when today's work actually happened */}
            <div className="mt-4">
              <div className="mb-1.5 flex items-center justify-between text-[11px] font-medium text-faint">
                <span>Today&rsquo;s sessions</span>
                {running && (
                  <span className="flex items-center gap-1 text-[var(--color-positive)]">
                    <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-positive)]" /> Live
                  </span>
                )}
              </div>
              <div className="relative h-8 overflow-hidden rounded-lg bg-canvas">
                {todaySegments.length === 0 ? (
                  <div className="flex h-full items-center justify-center text-[11px] text-faint">No sessions yet today</div>
                ) : (
                  todaySegments.map((g, i) => (
                    <div
                      key={g.id}
                      title={`${g.name} · ${formatTime(g.start.toISOString())}${g.end ? `–${formatTime(g.end.toISOString())}` : " · running"}`}
                      className={`absolute bottom-1 top-1 rounded-md ${g.running ? "animate-pulse" : ""}`}
                      style={{ left: `${g.left}%`, width: `${Math.max(1.5, g.width)}%`, background: CAT[i % CAT.length] }}
                    />
                  ))
                )}
              </div>
              <div className="mt-1 flex justify-between text-[10px] text-faint">
                {[7, 10, 13, 16, 19, 21].map((h) => (
                  <span key={h}>{h === 12 ? "12p" : h > 12 ? `${h - 12}p` : `${h}a`}</span>
                ))}
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-4 sm:gap-6 border-t border-border pt-4 justify-start">
              {topToday.length === 0 ? (
                <p className="w-full text-sm text-muted">No time tracked today yet.</p>
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
          </div>
        );
      case "projects":
        return (
          <div data-tour="dash-projects">
          <Section title="Projects & Tasks" icon="🗂" bodyClassName="p-5" action={resizeAction("projects")}>
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
        );
      case "heatmap":
        return (
          <div data-tour="dash-heatmap">
          <Section title="Work by hours" icon="▦" bodyClassName="p-5" action={resizeAction("heatmap")}>
            {week.length === 0 ? (
              <p className="text-sm text-muted">No sessions this week yet.</p>
            ) : (
              <>
                <WorkHeatmap sessions={week} />
                <div className="mt-4 flex items-center justify-end gap-1.5 text-[11px] text-faint">
                  Less
                  {[0.15, 0.4, 0.65, 0.9].map((a) => (
                    <span key={a} className="h-3 w-3 rounded" style={{ background: `color-mix(in srgb, var(--color-brand) ${a * 100}%, transparent)` }} />
                  ))}
                  More
                </div>
              </>
            )}
          </Section>
          </div>
        );
      case "weekly":
        return (
          <div data-tour="dash-weekly">
          <Section title="Weekly goal" icon="🎯" bodyClassName="p-5" action={resizeAction("weekly")}>
            <div className="flex flex-col items-center gap-4 py-1">
              <Donut value={weekGoalPct} size={148} stroke={13} color="var(--color-brand)" label={`${weekGoalPct}%`} sublabel={`${formatDurationShort(workedWeek)} of 40h`} />
              <div className="grid w-full grid-cols-2 gap-3 border-t border-border pt-4 text-center">
                <div>
                  <div className="font-heading text-lg font-semibold">{daysActive}</div>
                  <div className="text-xs text-muted">Days active</div>
                </div>
                <div>
                  <div className="font-heading text-lg font-semibold">{summary?.avgActivityPct != null ? `${summary.avgActivityPct}%` : "—"}</div>
                  <div className="text-xs text-muted">Activity today</div>
                </div>
              </div>
            </div>
          </Section>
          </div>
        );
      case "topweek":
        return (
          <Section title="Top projects · this week" icon="🏆" bodyClassName="p-5" action={resizeAction("topweek")}>
            {topWeek.length === 0 ? (
              <p className="text-sm text-muted">No time tracked this week.</p>
            ) : (
              <div className="space-y-3.5">
                {topWeek.map((p, i) => (
                  <div key={p.name} className="flex items-center gap-3 text-sm">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: PROJ_DOTS[i % PROJ_DOTS.length] }} />
                    <span className="w-24 shrink-0 truncate font-medium">{p.name}</span>
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-canvas">
                      <div className="h-full rounded-full" style={{ width: `${(p.secs / (topWeek[0].secs || 1)) * 100}%`, background: PROJ_DOTS[i % PROJ_DOTS.length] }} />
                    </div>
                    <span className="tnum w-14 shrink-0 text-right text-muted">{formatDurationShort(p.secs)}</span>
                  </div>
                ))}
              </div>
            )}
          </Section>
        );
      case "history":
        return (
          <div data-tour="dash-history">
          {week.length === 0 ? (
          <EmptyState icon="🗓" title="No sessions yet" hint="Start tracking from the TraxStaff desktop app and your activity will appear here." />
        ) : (
          <Section title="Project History" icon="📜" bodyClassName="p-0" action={resizeAction("history")}>
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
                    <tr key={s.id} className="border-b border-border/60 transition last:border-0 hover:bg-canvas">
                      <td className="px-5 py-3 font-medium">
                        {s.project.name}
                        {s.task && <span className="ml-2 text-xs text-muted">{s.task.title}</span>}
                      </td>
                      <td className="px-5 py-3">
                        {/* GET /sessions pins where.userId today, so an orphaned
                            session can't reach this table — but the relation is
                            nullable and one scope change away from arriving here,
                            and this is a render path with no boundary above it. */}
                        <Badge tone={chipTone(s.user?.email ?? DELETED_USER_LABEL)} dot>
                          {ownerName(s.user)}
                        </Badge>
                      </td>
                      <td className="px-5 py-3 text-muted">{new Date(s.startedAt).toLocaleDateString()}</td>
                      <td className="px-5 py-3 tnum text-muted">
                        {formatTime(s.startedAt)}
                        {s.endedAt ? ` – ${formatTime(s.endedAt)}` : ""}
                      </td>
                      <td className="px-5 py-3 tnum font-medium">{formatDurationShort(sessionSeconds(s))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
          )}
          </div>
        );
    }
  }

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

      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4" data-tour="dash-kpis">
        <StatTile icon="📁" tone="brand" label="Active projects" value={<CountUp to={activeProjects} duration={1} />} />
        <StatTile icon="⏳" tone="accent" label="Ongoing tasks" value={<CountUp to={ongoingTasks} duration={1} />} />
        <StatTile icon="✅" tone="teal" label="Completed tasks" value={<CountUp to={completedTasks} duration={1} />} />
        <div className="relative">
          <StatTile icon="⏱" tone="muted" label="Worked this week" value={<span className="text-[22px]">{formatDurationShort(workedWeek)}</span>} />
        </div>
      </div>

      {/* Customize toolbar */}
      <div className="mb-4 flex items-center justify-between gap-3" data-tour="dash-customize">
        <div className="text-sm text-muted">
          {customize ? "Drag cards to rearrange · use ⤢ to resize" : ""}
        </div>
        <div className="flex items-center gap-2">
          {customize && (
            <button onClick={resetLayout} className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-muted transition hover:bg-canvas">
              Reset
            </button>
          )}
          <button
            onClick={() => setCustomize((c) => !c)}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
              customize ? "bg-brand text-brand-fg" : "border border-border text-muted hover:bg-canvas"
            }`}
          >
            {customize ? "✓ Done" : "⚙ Customize"}
          </button>
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
          <Skeleton className="h-80 md:col-span-2 lg:col-span-2" />
          <Skeleton className="h-80 col-span-1" />
          <Skeleton className="h-64 md:col-span-2 lg:col-span-2" />
          <Skeleton className="h-64 col-span-1" />
        </div>
      ) : (
        <Reorder.Group
          as="div"
          axis="y"
          values={order}
          onReorder={(v) => reorder(v as WidgetId[])}
          className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3"
        >
          {order.map((id) => (
            <Reorder.Item
              key={id}
              value={id}
              drag={customize}
              dragListener={customize}
              whileDrag={{ scale: 1.02, zIndex: 30, cursor: "grabbing" }}
              className={`${spanClass(spans[id])} ${customize ? "cursor-grab rounded-2xl ring-2 ring-brand/30 ring-offset-2 ring-offset-canvas" : ""}`}
            >
              {renderWidget(id)}
            </Reorder.Item>
          ))}
        </Reorder.Group>
      )}
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


