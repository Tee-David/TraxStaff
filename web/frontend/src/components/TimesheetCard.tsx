"use client";

import type { ReactNode } from "react";
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card } from "@/components/ui";
import { formatDurationShort, sessionSeconds } from "@/lib/format";

export interface WeekdayHours {
  /** "Sun" .. "Sat" */
  day: string;
  hours: number;
}

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Bucket a set of sessions into hours-per-weekday (Sun→Sat), entirely
 * client-side — no backend change needed. Each session's own weekday (in the
 * viewer's local time) determines its bucket, regardless of which date range
 * was used to fetch the sessions. */
export function weekdayHoursFromSessions(sessions: { startedAt: string; endedAt: string | null }[]): WeekdayHours[] {
  const secondsByDay = new Array(7).fill(0);
  for (const s of sessions) {
    const day = new Date(s.startedAt).getDay(); // 0=Sun..6=Sat
    secondsByDay[day] += sessionSeconds(s.startedAt, s.endedAt);
  }
  return WEEKDAY_LABELS.map((day, i) => ({ day, hours: secondsByDay[i] / 3600 }));
}

/**
 * A vertical bar chart, one bar per weekday, with a total-hours count in the
 * header — the "Timesheet" card from the reference dashboard. `action` is the
 * header-right slot (e.g. a "This Week"/"Last Week" picker).
 */
export function TimesheetCard({
  data,
  action,
  className = "",
}: {
  data: WeekdayHours[];
  action?: ReactNode;
  className?: string;
}) {
  const totalHours = data.reduce((a, d) => a + d.hours, 0);
  const totalSeconds = totalHours * 3600;
  const hasData = totalHours > 0;

  return (
    <Card className={`p-5 ${className}`}>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-heading text-[15px] font-semibold text-ink">
          Timesheet ({formatDurationShort(totalSeconds)})
        </h2>
        {action}
      </div>

      {!hasData ? (
        <p className="text-sm text-muted">No tracked time in this period.</p>
      ) : (
        <div className="h-40">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
              <XAxis
                dataKey="day"
                tickLine={false}
                axisLine={false}
                tick={{ fontSize: 11, fill: "var(--color-faint)" }}
              />
              <YAxis hide domain={[0, "dataMax"]} />
              <Tooltip
                cursor={{ fill: "var(--color-canvas)" }}
                contentStyle={{ borderRadius: 12, border: "1px solid var(--color-border)", background: "var(--color-surface)", fontSize: 12 }}
                formatter={(v: number) => [`${v.toFixed(1)}h`, "Tracked"]}
              />
              <Bar dataKey="hours" radius={[6, 6, 0, 0]} maxBarSize={32}>
                {data.map((d, i) => (
                  <Cell key={i} fill="var(--color-brand)" fillOpacity={d.hours > 0 ? 0.85 : 0.15} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  );
}
