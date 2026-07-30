"use client";

import type { ReactNode } from "react";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card } from "@/components/ui";

export interface WorkloadCounts {
  todo: number;
  inProgress: number;
  done: number;
}

/** Segments shown left→right in the bar, in this fixed order. Colors follow the
 * app's existing categorical/semantic tokens rather than the reference's palette. */
const SEGMENTS: { key: keyof WorkloadCounts; label: string; color: string }[] = [
  { key: "inProgress", label: "On Progress", color: "var(--color-brand)" },
  { key: "todo", label: "To-Do", color: "var(--color-faint)" },
  { key: "done", label: "Completed", color: "var(--color-positive)" },
];

/**
 * A single segmented horizontal bar showing task-status distribution, with a
 * count-per-segment legend below it — the "Workload" card from the reference
 * dashboard. Built on recharts (a single stacked horizontal bar, one category)
 * rather than hand-rolled divs, per the milestone's charting constraint.
 *
 * Note: the reference design shows a 4th "Under Review" segment. TraxStaff's Task
 * model only has todo/in_progress/done (see lib/types.ts) — there's no review
 * status to source that segment from, so it's omitted here rather than
 * inventing a fake backend field. Flagged in the final report.
 */
export function WorkloadCard({
  counts,
  action,
  className = "",
}: {
  counts: WorkloadCounts;
  action?: ReactNode;
  className?: string;
}) {
  const total = counts.todo + counts.inProgress + counts.done;
  const data = [
    {
      name: "tasks",
      ...counts,
    },
  ];

  return (
    <Card className={`p-5 ${className}`}>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-heading text-[15px] font-semibold text-ink">Workload ({total})</h2>
        {action}
      </div>

      {total === 0 ? (
        <p className="text-sm text-muted">No tasks yet.</p>
      ) : (
        <>
          <div className="h-9">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data} layout="vertical" barSize={28} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
                <XAxis type="number" hide domain={[0, total]} />
                <YAxis type="category" dataKey="name" hide />
                <Tooltip
                  cursor={{ fill: "transparent" }}
                  contentStyle={{ borderRadius: 12, border: "1px solid var(--color-border)", background: "var(--color-surface)", fontSize: 12 }}
                />
                {SEGMENTS.map((seg) => (
                  <Bar key={seg.key} dataKey={seg.key} stackId="workload" fill={seg.color} name={seg.label} radius={0} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2">
            {SEGMENTS.map((seg) => (
              <div key={seg.key} className="flex items-center gap-2 text-[12px]">
                <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: seg.color }} />
                <span className="text-muted">{seg.label}</span>
                <span className="font-semibold text-ink">{counts[seg.key]}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </Card>
  );
}

/** Roll Task[] up into the 3 counts this card needs. */
export function workloadCounts(tasks: { status: "todo" | "in_progress" | "done" }[]): WorkloadCounts {
  return {
    todo: tasks.filter((t) => t.status === "todo").length,
    inProgress: tasks.filter((t) => t.status === "in_progress").length,
    done: tasks.filter((t) => t.status === "done").length,
  };
}
