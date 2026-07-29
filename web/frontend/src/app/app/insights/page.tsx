"use client";

import { useCallback, useEffect, useState } from "react";
import {
  BarChart, Bar, AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Cell, PieChart, Pie,
} from "recharts";
import { api } from "@/lib/api";
import type { LeaderRow, PresenceRow, UnusualFlag, ByProjectRow, TimesheetDay } from "@/lib/reports";
import { Badge, Card, PageHeader, Skeleton, StatTile } from "@/components/ui";
import { DateRange, FilterBar, rangeToParams, type DateRangeValue } from "@/components/filters";
import { formatDurationShort } from "@/lib/format";

const FLAG_LABELS: Record<string, string> = {
  sustained_high_activity: "Sustained high activity",
  low_variance_robotic: "Robotic / low variance",
  input_channel_imbalance: "Input channel imbalance",
  jiggler_process_detected: "Mouse-jiggler detected",
  clock_skew_detected: "System clock changed",
  exceeds_elapsed_cap: "Claimed more time than elapsed",
  block_outside_session_window: "Activity outside session window",
};

const FLAG_COLORS: Record<string, string> = {
  sustained_high_activity: "accent",
  low_variance_robotic: "red",
  input_channel_imbalance: "red",
  jiggler_process_detected: "red",
  clock_skew_detected: "accent",
  exceeds_elapsed_cap: "red",
  block_outside_session_window: "accent",
};

const PROJ_COLORS = ["var(--color-cat-focus)", "#ff6600", "#12b5a5", "#8a5cf6", "#e0457b", "#0ea5e9", "#84cc16"];

function initials(email: string) {
  return email.substring(0, 2).toUpperCase();
}

function Avatar({ email, online, size = 8 }: { email: string; online?: boolean; size?: number }) {
  const colors = ["bg-blue-700", "bg-orange-600", "bg-teal-600", "bg-violet-600", "bg-rose-600"];
  let h = 0;
  for (const c of email) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const color = colors[h % colors.length];
  return (
    <div className="relative inline-block">
      <div className={`flex items-center justify-center rounded-full text-white font-bold text-xs ${color}`}
        style={{ width: `${size * 4}px`, height: `${size * 4}px`, fontSize: `${size * 1.4}px` }}>
        {initials(email)}
      </div>
      {online !== undefined && (
        <span className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-surface ${online ? "bg-green-500" : "bg-border"}`} />
      )}
    </div>
  );
}

export default function InsightsPage() {
  const [presence, setPresence] = useState<PresenceRow[]>([]);
  const [flags, setFlags] = useState<UnusualFlag[]>([]);
  const [board, setBoard] = useState<LeaderRow[]>([]);
  const [projects, setProjects] = useState<ByProjectRow[]>([]);
  const [timesheet, setTimesheet] = useState<TimesheetDay[]>([]);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState<DateRangeValue>({ type: "preset", preset: "week" });

  const load = useCallback(() => {
    setLoading(true);
    const { from, to } = rangeToParams(range);
    const qs = new URLSearchParams();
    if (from) qs.set("from", from);
    if (to) qs.set("to", to);
    // See reports/page.tsx — day buckets are computed in this zone, not UTC.
    qs.set("tz", Intl.DateTimeFormat().resolvedOptions().timeZone);
    const qStr = qs.toString();
    Promise.all([
      api<PresenceRow[]>("/insights/presence"),
      api<UnusualFlag[]>("/insights/unusual-activity"),
      api<LeaderRow[]>(`/insights/leaderboard?${qStr}`),
      api<ByProjectRow[]>(`/reports/by-project?${qStr}`),
      api<TimesheetDay[]>(`/reports/timesheet?${qStr}`),
    ])
      .then(([p, f, b, proj, ts]) => {
        setPresence(p);
        setFlags(f);
        setBoard(b);
        setProjects(proj);
        setTimesheet(ts.slice(0, 14).reverse());
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [range]);

  useEffect(() => {
    load();
  }, [load]);

  async function acknowledge(id: string) {
    await api(`/insights/unusual-activity/${id}/acknowledge`, { method: "POST" }).catch(() => {});
    setFlags((fs) => fs.map((f) => (f.id === id ? { ...f, acknowledgedAt: new Date().toISOString() } : f)));
  }

  // Derived stats
  const onlineCount = presence.filter((p) => p.online).length;
  const trackingCount = presence.filter((p) => p.tracking).length;
  const totalHours = board.reduce((a, r) => a + r.totalSeconds, 0);
  const avgActivity = board.length
    ? Math.round(board.reduce((a, r) => a + r.avgActivityPct, 0) / board.length)
    : 0;
  const openFlags = flags.filter((f) => !f.acknowledgedAt).length;
  const topProject = projects[0];

  // Pie chart data
  const pieData = projects.slice(0, 6).map((p, i) => ({
    name: p.project,
    value: p.totalSeconds,
    color: PROJ_COLORS[i],
  }));

  return (
    <div>
      <PageHeader title="Insights" subtitle="Admin overview — productivity, presence, and risk signals" />

      <FilterBar>
        <DateRange value={range} onChange={setRange} />
      </FilterBar>

      {/* ── KPI stat row ── */}
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile icon="🟢" tone="teal" label="Online now" value={String(onlineCount)} />
        <StatTile icon="⏱" tone="brand" label="Tracking now" value={String(trackingCount)} />
        <StatTile icon="📊" tone="teal" label="Avg activity" value={`${avgActivity}%`} />
        <StatTile icon="🚨" tone={openFlags > 0 ? "accent" : "muted"} label="Open flags" value={String(openFlags)} />
      </div>

      {loading ? (
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-56" />)}
        </div>
      ) : (
        <div className="space-y-5">

          {/* ── Row 1: Presence + Leaderboard ── */}
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">

            {/* Live presence */}
            <Card className="p-5">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="font-heading text-base font-semibold">Live Presence</h2>
                <Badge tone={onlineCount > 0 ? "green" : "muted"} dot>{onlineCount} online</Badge>
              </div>
              <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                {presence.length === 0 && <p className="text-sm text-muted">No active members.</p>}
                {presence.map((m) => (
                  <div key={m.userId} className="flex items-center justify-between rounded-xl px-3 py-2.5 hover:bg-canvas transition">
                    <div className="flex items-center gap-3">
                      <Avatar email={m.email} online={m.online} size={8} />
                      <div>
                        <div className="text-sm font-medium truncate max-w-[160px]">{m.email.split("@")[0]}</div>
                        <div className="text-[11px] text-muted truncate max-w-[160px]">{m.email.split("@")[1]}</div>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      {m.tracking ? (
                        <>
                          <div className="text-[11px] font-semibold text-brand truncate max-w-[120px]">{m.tracking.project}</div>
                          <div className="text-[10px] text-muted">Tracking</div>
                        </>
                      ) : m.online ? (
                        <Badge tone="muted">Online</Badge>
                      ) : (
                        <Badge tone="muted">Offline</Badge>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </Card>

            {/* Leaderboard */}
            <Card className="p-5">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="font-heading text-base font-semibold">Productivity Ranking</h2>
                <span className="text-[11px] text-muted">Hours · Activity%</span>
              </div>
              <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                {board.length === 0 && <p className="text-sm text-muted">No tracked time in this period.</p>}
                {board.map((r, i) => {
                  const maxSecs = board[0]?.totalSeconds || 1;
                  const barPct = (r.totalSeconds / maxSecs) * 100;
                  const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : null;
                  return (
                    <div key={r.userId} className="group rounded-xl px-3 py-2.5 hover:bg-canvas transition">
                      <div className="flex items-center justify-between mb-1.5">
                        <div className="flex items-center gap-2.5">
                          <span className="text-[13px] w-5 text-center">{medal ?? <span className="text-[11px] font-semibold text-faint">{i + 1}</span>}</span>
                          <Avatar email={r.email} size={7} />
                          <span className="text-sm font-medium truncate max-w-[120px]">{r.email.split("@")[0]}</span>
                        </div>
                        <div className="text-right shrink-0">
                          <span className="text-sm font-semibold">{formatDurationShort(r.totalSeconds)}</span>
                          {r.avgActivityPct > 0 && (
                            <span className="ml-2 text-[11px] text-muted">{r.avgActivityPct}%</span>
                          )}
                        </div>
                      </div>
                      <div className="ml-[2.5rem] h-1 rounded-full bg-canvas overflow-hidden">
                        <div
                          className="h-full rounded-full bg-brand/60 transition-all duration-700"
                          style={{ width: `${barPct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
          </div>

          {/* ── Row 2: Daily trend chart + Project time breakdown ── */}
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">

            {/* Daily hours area chart */}
            <Card className="p-5 lg:col-span-2">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="font-heading text-base font-semibold">Daily Hours Trend</h2>
                <span className="text-[11px] text-muted">Team total per day</span>
              </div>
              {timesheet.length === 0 ? (
                <p className="text-sm text-muted">No sessions in this period.</p>
              ) : (
                <div className="h-48">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={timesheet} margin={{ top: 6, right: 4, bottom: 0, left: -20 }}>
                      <defs>
                        <linearGradient id="insightFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="var(--color-brand)" stopOpacity={0.35} />
                          <stop offset="90%" stopColor="var(--color-brand)" stopOpacity={0.02} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--color-border)" />
                      <XAxis
                        dataKey="date"
                        tickLine={false}
                        axisLine={false}
                        tick={{ fontSize: 10, fill: "var(--color-faint)" }}
                        tickFormatter={(v: string) => v.slice(5)}
                        interval={Math.max(0, Math.floor(timesheet.length / 7) - 1)}
                      />
                      <YAxis hide domain={[0, "dataMax"]} />
                      <Tooltip
                        cursor={{ stroke: "var(--color-brand)", strokeWidth: 1, strokeDasharray: "3 3" }}
                        contentStyle={{ borderRadius: 12, border: "1px solid var(--color-border)", background: "var(--color-surface)", fontSize: 12 }}
                        formatter={(v: number) => [formatDurationShort(v), "Worked"]}
                      />
                      <Area
                        type="monotone"
                        dataKey="totalSeconds"
                        stroke="var(--color-brand)"
                        strokeWidth={2}
                        fill="url(#insightFill)"
                        dot={false}
                        activeDot={{ r: 4, fill: "var(--color-brand)", stroke: "var(--color-surface)", strokeWidth: 2 }}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              )}
            </Card>

            {/* Project time split (pie) */}
            <Card className="p-5">
              <div className="mb-4">
                <h2 className="font-heading text-base font-semibold">Time by Project</h2>
                <p className="text-[11px] text-muted">Top 6 this period</p>
              </div>
              {pieData.length === 0 ? (
                <p className="text-sm text-muted">No data.</p>
              ) : (
                <div className="flex flex-col gap-3">
                  <div className="flex justify-center">
                    <PieChart width={120} height={120}>
                      <Pie data={pieData} cx={55} cy={55} innerRadius={32} outerRadius={55} dataKey="value" strokeWidth={2} stroke="var(--color-surface)">
                        {pieData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                      </Pie>
                    </PieChart>
                  </div>
                  <div className="space-y-1.5">
                    {pieData.map((p) => (
                      <div key={p.name} className="flex items-center justify-between text-[12px]">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: p.color }} />
                          <span className="truncate text-ink">{p.name}</span>
                        </div>
                        <span className="ml-2 shrink-0 font-semibold text-muted">{formatDurationShort(p.value)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </Card>
          </div>

          {/* ── Row 3: Activity per member bar chart + Risk signals ── */}
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">

            {/* Activity% bar chart */}
            <Card className="p-5">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="font-heading text-base font-semibold">Activity Rate per Member</h2>
                <span className="text-[11px] text-muted">Avg keyboard + mouse %</span>
              </div>
              {board.length === 0 ? (
                <p className="text-sm text-muted">No data for this period.</p>
              ) : (
                <div className="h-52">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={board.slice(0, 10).map((r) => ({ name: r.email.split("@")[0], pct: r.avgActivityPct }))}
                      margin={{ top: 4, right: 4, bottom: 24, left: -20 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--color-border)" />
                      <XAxis
                        dataKey="name"
                        tickLine={false}
                        axisLine={false}
                        tick={{ fontSize: 10, fill: "var(--color-faint)" }}
                        angle={-30}
                        textAnchor="end"
                        interval={0}
                      />
                      <YAxis hide domain={[0, 100]} />
                      <Tooltip
                        cursor={{ fill: "var(--color-canvas)" }}
                        contentStyle={{ borderRadius: 12, border: "1px solid var(--color-border)", background: "var(--color-surface)", fontSize: 12 }}
                        formatter={(v: number) => [`${v}%`, "Activity"]}
                      />
                      <Bar dataKey="pct" radius={[6, 6, 0, 0]} maxBarSize={40}>
                        {board.slice(0, 10).map((_, i) => (
                          <Cell key={i} fill={PROJ_COLORS[i % PROJ_COLORS.length]} fillOpacity={0.85} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </Card>

            {/* Unusual activity flags */}
            <Card className="p-5">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="font-heading text-base font-semibold">Risk & Anomaly Flags</h2>
                {openFlags > 0 && (
                  <Badge tone="accent" dot>{openFlags} open</Badge>
                )}
              </div>
              {flags.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 gap-2 text-center">
                  <span className="text-3xl">🎉</span>
                  <p className="text-sm font-medium text-ink">All clear</p>
                  <p className="text-xs text-muted">No unusual activity detected in your team.</p>
                </div>
              ) : (
                <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                  {flags.slice(0, 15).map((f) => (
                    <div
                      key={f.id}
                      className={`flex items-start justify-between gap-3 rounded-xl p-3 transition ${
                        f.acknowledgedAt ? "opacity-40 bg-canvas/50" : "bg-canvas hover:bg-canvas/80"
                      }`}
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <Badge tone={(FLAG_COLORS[f.type] as "red" | "accent") ?? "red"} dot={false}>
                            {FLAG_LABELS[f.type] ?? f.type}
                          </Badge>
                        </div>
                        <div className="text-[12px] text-ink font-medium truncate">{f.session.user.email.split("@")[0]}</div>
                        <div className="text-[11px] text-muted">{f.session.project.name} · {new Date(f.detectedAt).toLocaleDateString()}</div>
                      </div>
                      <div className="shrink-0 pt-0.5">
                        {f.acknowledgedAt ? (
                          <span className="text-[10px] text-muted">Done</span>
                        ) : (
                          <button
                            onClick={() => acknowledge(f.id)}
                            className="text-[11px] font-semibold text-brand hover:underline whitespace-nowrap"
                          >
                            Dismiss
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>

          {/* ── Row 4: Project health overview ── */}
          {projects.length > 0 && (
            <Card className="p-5">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="font-heading text-base font-semibold">Project Health</h2>
                <span className="text-[11px] text-muted">Hours tracked per project this period</span>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
                {projects.map((p, i) => {
                  const maxSecs = projects[0]?.totalSeconds || 1;
                  const pct = Math.round((p.totalSeconds / maxSecs) * 100);
                  const activity = p.avgActivityPct ?? 0;
                  const color = PROJ_COLORS[i % PROJ_COLORS.length];
                  const healthTone: "green" | "accent" | "red" | "muted" =
                    activity >= 60 ? "green" : activity >= 35 ? "accent" : activity > 0 ? "red" : "muted";
                  return (
                    <div key={p.projectId} className="rounded-xl border border-border bg-canvas/40 p-4 hover:bg-canvas transition">
                      <div className="flex items-start justify-between mb-3">
                        <div className="min-w-0">
                          <div className="text-sm font-semibold truncate">{p.project}</div>
                          <div className="text-[11px] text-muted">{p.clientTag || "Internal"}</div>
                        </div>
                        <Badge tone={healthTone} dot={activity > 0}>
                          {activity > 0 ? `${activity}%` : "No data"}
                        </Badge>
                      </div>
                      <div className="mb-1.5">
                        <div className="h-1.5 rounded-full bg-border overflow-hidden">
                          <div
                            className="h-full rounded-full transition-all duration-700"
                            style={{ width: `${pct}%`, backgroundColor: color }}
                          />
                        </div>
                      </div>
                      <div className="text-[12px] font-semibold text-muted">{formatDurationShort(p.totalSeconds)}</div>
                    </div>
                  );
                })}
              </div>
            </Card>
          )}

        </div>
      )}
    </div>
  );
}

