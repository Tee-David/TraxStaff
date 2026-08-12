"use client";

import { useMemo } from "react";
import type { Session } from "@/lib/types";
import { sessionEnd } from "@/lib/format";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const HOURS = Array.from({ length: 11 }, (_, i) => 8 + i); // 8:00–18:00

function startOfWeek(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}

/** Minutes-worked heatmap: day-of-week (cols) × hour (rows), brand-tinted intensity. */
export function WorkHeatmap({ sessions }: { sessions: Session[] }) {
  const { grid, max } = useMemo(() => {
    // grid[hourIndex][dayIndex] = minutes
    const g: number[][] = HOURS.map(() => new Array(7).fill(0));
    const base = startOfWeek().getTime();
    for (const s of sessions) {
      let cur = new Date(s.startedAt);
      // Bounded by the server's decision, not by `now` — an abandoned session
      // would otherwise paint every hour since it was left open.
      const end = sessionEnd(s);
      while (cur < end) {
        const next = new Date(cur);
        next.setMinutes(60, 0, 0);
        const mins = (Math.min(end.getTime(), next.getTime()) - cur.getTime()) / 60000;
        const h = cur.getHours();
        const dayIdx = Math.floor((new Date(cur).setHours(0, 0, 0, 0) - base) / 86400000);
        const hi = HOURS.indexOf(h);
        if (hi >= 0 && dayIdx >= 0 && dayIdx < 7) g[hi][dayIdx] += mins;
        cur = next;
      }
    }
    const m = Math.max(1, ...g.flat());
    return { grid: g, max: m };
  }, [sessions]);

  return (
    <div className="overflow-x-auto">
      <div className="inline-grid gap-1" style={{ gridTemplateColumns: `36px repeat(7, minmax(28px, 1fr))` }}>
        <div />
        {DAYS.map((d) => (
          <div key={d} className="pb-1 text-center text-[10px] font-medium text-faint">{d}</div>
        ))}
        {HOURS.map((h, hi) => (
          <FragmentRow key={h} hour={h} cells={grid[hi]} max={max} />
        ))}
      </div>
    </div>
  );
}

function FragmentRow({ hour, cells, max }: { hour: number; cells: number[]; max: number }) {
  return (
    <>
      <div className="flex items-center justify-end pr-1 text-[10px] text-faint">{hour}:00</div>
      {cells.map((mins, i) => {
        const t = mins / max; // 0..1
        const alpha = mins === 0 ? 0 : 0.15 + t * 0.85;
        return (
          <div
            key={i}
            title={mins > 0 ? `${DAYS[i]} ${hour}:00 · ${Math.round(mins)}m` : ""}
            className="group relative h-6 rounded-md border border-border/60"
            style={{ background: mins === 0 ? "var(--color-canvas)" : `color-mix(in srgb, var(--color-brand) ${Math.round(alpha * 100)}%, transparent)` }}
          />
        );
      })}
    </>
  );
}
