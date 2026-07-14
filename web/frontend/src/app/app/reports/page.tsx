"use client";

import { useCallback, useEffect, useState } from "react";
import { motion } from "motion/react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { ByProjectRow, ReportSummary, TimesheetDay } from "@/lib/reports";
import { Button, Card, PageHeader, Skeleton } from "@/components/ui";
import CountUp from "@/components/CountUp";
import { DateRange, MemberFilter, FilterBar, rangeToParams, type RangeKey } from "@/components/filters";
import { formatDurationShort } from "@/lib/format";

export default function ReportsPage() {
  const { user } = useAuth();
  const isPrivileged = user?.role === "owner" || user?.role === "admin";
  const [summary, setSummary] = useState<ReportSummary | null>(null);
  const [days, setDays] = useState<TimesheetDay[]>([]);
  const [projects, setProjects] = useState<ByProjectRow[]>([]);
  const [apps, setApps] = useState<{ appName: string; seconds: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState<RangeKey>("week");
  const [member, setMember] = useState("");

  const load = useCallback(() => {
    setLoading(true);
    const { from, to } = rangeToParams(range);
    const qs = new URLSearchParams();
    if (from) qs.set("from", from);
    if (to) qs.set("to", to);
    if (member) qs.set("userId", member);
    const q = qs.toString() ? `?${qs.toString()}` : "";
    Promise.all([
      api<ReportSummary>(`/reports/summary${q}`),
      api<TimesheetDay[]>(`/reports/timesheet${q}`),
      api<ByProjectRow[]>(`/reports/by-project${q}`),
      api<{ appName: string; seconds: number }[]>(`/reports/app-usage${q}`),
    ])
      .then(([s, d, p, a]) => {
        setSummary(s);
        setDays(d);
        setProjects(p);
        setApps(a);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [range, member]);

  useEffect(() => {
    load();
  }, [load]);

  const maxProj = Math.max(1, ...projects.map((p) => p.totalSeconds));

  function exportCsv() {
    const rows = [
      ["Project", "Client", "Hours", "Avg activity %"],
      ...projects.map((p) => [
        p.project,
        p.clientTag ?? "",
        (p.totalSeconds / 3600).toFixed(2),
        p.avgActivityPct != null ? String(p.avgActivityPct) : "",
      ]),
    ];
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `trax-report-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div>
      <PageHeader
        title="Reports"
        subtitle="Hours, activity, and time by project"
        actions={
          <Button variant="ghost" onClick={exportCsv} disabled={projects.length === 0}>
            ↓ Export CSV
          </Button>
        }
      />

      <FilterBar>
        <DateRange value={range} onChange={setRange} />
        <MemberFilter value={member} onChange={setMember} enabled={isPrivileged} />
      </FilterBar>

      {loading ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-24" />)}
          </div>
          <Skeleton className="h-64" />
        </div>
      ) : (
        <>
          <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-4">
            <Stat label="Total hours" value={(summary?.totalSeconds ?? 0) / 3600} suffix="h" decimals={1} i={0} />
            <Stat label="Avg activity" value={summary?.avgActivityPct ?? 0} suffix="%" i={1} />
            <Stat label="Sessions" value={summary?.sessions ?? 0} i={2} />
            <Stat label="Flagged" value={summary?.flaggedSessions ?? 0} i={3} />
          </div>

          <Card className="mb-6 p-5">
            <h2 className="mb-4 text-lg">Time by project</h2>
            {projects.length === 0 ? (
              <p className="text-sm text-muted">No tracked time yet.</p>
            ) : (
              <div className="space-y-3">
                {projects.map((p) => (
                  <div key={p.projectId}>
                    <div className="mb-1 flex items-center justify-between text-sm">
                      <span className="font-medium">
                        {p.project}
                        {p.clientTag && <span className="ml-2 text-xs text-muted">{p.clientTag}</span>}
                      </span>
                      <span className="text-muted">
                        {formatDurationShort(p.totalSeconds)}
                        {p.avgActivityPct != null && ` · ${p.avgActivityPct}%`}
                      </span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-canvas">
                      <motion.div
                        className="h-full rounded-full bg-brand"
                        initial={{ width: 0 }}
                        animate={{ width: `${(p.totalSeconds / maxProj) * 100}%` }}
                        transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card className="mb-6 p-5">
            <h2 className="mb-4 text-lg">App &amp; website usage</h2>
            {apps.length === 0 ? (
              <p className="text-sm text-muted">No app usage captured yet (the desktop tracker records this while tracking).</p>
            ) : (
              <div className="space-y-3">
                {apps.slice(0, 12).map((a) => {
                  const maxApp = Math.max(1, ...apps.map((x) => x.seconds));
                  return (
                    <div key={a.appName}>
                      <div className="mb-1 flex items-center justify-between text-sm">
                        <span className="font-medium">{a.appName}</span>
                        <span className="text-muted">{formatDurationShort(a.seconds)}</span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-canvas">
                        <motion.div
                          className="h-full rounded-full bg-accent"
                          initial={{ width: 0 }}
                          animate={{ width: `${(a.seconds / maxApp) * 100}%` }}
                          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>

          <Card className="p-5">
            <h2 className="mb-4 text-lg">Daily timesheet</h2>
            {days.length === 0 ? (
              <p className="text-sm text-muted">No entries yet.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                    <th className="pb-2 font-medium">Date</th>
                    <th className="pb-2 font-medium">Tracked</th>
                    <th className="pb-2 font-medium">Manual</th>
                    <th className="pb-2 font-medium">Total</th>
                    <th className="pb-2 font-medium">Sessions</th>
                  </tr>
                </thead>
                <tbody>
                  {days.map((d) => (
                    <tr key={d.date} className="border-b border-border/60 last:border-0">
                      <td className="py-2.5 font-medium">{d.date}</td>
                      <td className="py-2.5 text-muted">{formatDurationShort(d.trackedSeconds)}</td>
                      <td className="py-2.5 text-muted">{formatDurationShort(d.manualSeconds)}</td>
                      <td className="py-2.5">{formatDurationShort(d.totalSeconds)}</td>
                      <td className="py-2.5 text-muted">{d.sessions}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, suffix = "", decimals = 0, i }: { label: string; value: number; suffix?: string; decimals?: number; i: number }) {
  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, delay: i * 0.06 }}>
      <Card className="p-5">
        <div className="text-sm text-muted">{label}</div>
        <div className="mt-1 flex items-baseline gap-0.5 font-heading text-2xl font-bold text-brand">
          <CountUp to={Number(value.toFixed(decimals))} duration={1} />
          {suffix && <span className="text-lg">{suffix}</span>}
        </div>
      </Card>
    </motion.div>
  );
}
