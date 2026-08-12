"use client";

import { useEffect, useState } from "react";
import { api, asArray } from "@/lib/api";
import { Select } from "@/components/Select";
import { DateRangePicker, type DateRangeValue, type PresetKey } from "./DateRangePicker";

export type { DateRangeValue, PresetKey };

export function rangeToParams(val: DateRangeValue): { from?: string; to?: string } {
  const now = new Date();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);

  if (val.type === "preset") {
    const key = val.preset;
    if (key === "today") return { from: start.toISOString() };
    if (key === "yesterday") {
      const d = new Date(start);
      d.setDate(d.getDate() - 1);
      const to = new Date(start);
      return { from: d.toISOString(), to: to.toISOString() };
    }
    if (key === "week") {
      const d = new Date(start);
      d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
      return { from: d.toISOString() };
    }
    if (key === "last_week") {
      const d = new Date(start);
      d.setDate(d.getDate() - ((d.getDay() + 6) % 7) - 7);
      const to = new Date(start);
      to.setDate(to.getDate() - ((to.getDay() + 6) % 7));
      return { from: d.toISOString(), to: to.toISOString() };
    }
    if (key === "month") {
      const d = new Date(start.getFullYear(), start.getMonth(), 1);
      return { from: d.toISOString() };
    }
    if (key === "last_month") {
      const d = new Date(start.getFullYear(), start.getMonth() - 1, 1);
      const to = new Date(start.getFullYear(), start.getMonth(), 1);
      return { from: d.toISOString(), to: to.toISOString() };
    }
    if (key === "year") {
      const d = new Date(start.getFullYear(), 0, 1);
      return { from: d.toISOString() };
    }
    if (key === "last_year") {
      const d = new Date(start.getFullYear() - 1, 0, 1);
      const to = new Date(start.getFullYear(), 0, 1);
      return { from: d.toISOString(), to: to.toISOString() };
    }
    // "all" returns empty
    return {};
  } else {
    // Custom range
    const from = new Date(val.from);
    from.setHours(0, 0, 0, 0);
    const to = new Date(val.to);
    to.setHours(23, 59, 59, 999);
    return { from: from.toISOString(), to: to.toISOString() };
  }
}

/** Serialise a range for the query string: "week" or "2026-01-04..2026-01-11". */
export function rangeToQuery(v: DateRangeValue): string {
  if (v.type === "preset") return v.preset;
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return `${iso(v.from)}..${iso(v.to)}`;
}

export function rangeFromQuery(raw: string, fallback: DateRangeValue): DateRangeValue {
  if (!raw) return fallback;
  if (raw.includes("..")) {
    const [a, b] = raw.split("..");
    const from = new Date(`${a}T00:00:00`);
    const to = new Date(`${b}T00:00:00`);
    if (!isNaN(from.getTime()) && !isNaN(to.getTime())) return { type: "custom", from, to };
    return fallback;
  }
  return { type: "preset", preset: raw as PresetKey };
}

export function DateRange({ value, onChange }: { value: DateRangeValue; onChange: (v: DateRangeValue) => void }) {
  return <DateRangePicker value={value} onChange={onChange} />;
}

interface Member {
  id: string;
  email: string;
  status: "invited" | "active" | "disabled" | "removed";
}

/** Member selector for admins (returns userId or ""). Renders nothing for non-admins. */
export function MemberFilter({
  value,
  onChange,
  enabled,
}: {
  value: string;
  onChange: (id: string) => void;
  enabled: boolean;
}) {
  const [members, setMembers] = useState<Member[]>([]);
  useEffect(() => {
    if (!enabled) return;
    // Mounted on Reports *and* Screenshots, and `members` is filtered during
    // render — a non-array 200 here would blank both pages.
    api<Member[]>("/members")
      .then((m) => setMembers(asArray<Member>(m)))
      .catch(() => setMembers([]));
  }, [enabled]);
  if (!enabled) return null;
  // Active staff only. Pulling up a report for someone disabled or removed is
  // not something to offer, and pending invitees have no tracked time at all —
  // listing them just padded the picker with names that report nothing.
  // Org-wide totals ("All members") still include everyone's history.
  const selectable = members.filter((m) => m.status === "active");
  return (
    <Select
      value={value}
      onChange={onChange}
      searchable
      placeholder="All members"
      options={[{ value: "", label: "All members" }, ...selectable.map((m) => ({ value: m.id, label: m.email }))]}
    />
  );
}

export function SearchInput({ value, onChange, placeholder = "Search…" }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full rounded-lg border border-border bg-surface px-3 py-1.5 text-sm outline-none focus:border-brand sm:w-56"
    />
  );
}

export function FilterBar({ children }: { children: React.ReactNode }) {
  return <div className="mb-5 flex flex-wrap items-center gap-3">{children}</div>;
}

export const PAGE_SIZES = [10, 25, 50, 100] as const;

export function Pagination({
  page,
  pageSize,
  total,
  onPage,
  onPageSize,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (p: number) => void;
  /** Omit to hide the page-size selector (fixed-size grids). */
  onPageSize?: (size: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  // Still render when there's a single page: the size selector is how the user
  // gets *back* to more rows per page, so hiding it at n<=pageSize traps them.
  if (pages <= 1 && !onPageSize) return null;
  const from = total === 0 ? 0 : page * pageSize + 1;
  const to = Math.min(total, (page + 1) * pageSize);
  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-muted">
      <div className="flex items-center gap-3">
        <span>
          {from}–{to} of {total}
        </span>
        {onPageSize && (
          <label className="flex items-center gap-1.5">
            <span className="text-[13px]">Rows</span>
            <select
              value={pageSize}
              onChange={(e) => { onPageSize(Number(e.target.value)); onPage(0); }}
              className="rounded-lg border border-border bg-surface px-2 py-1 text-[13px] text-ink outline-none focus:border-brand"
            >
              {PAGE_SIZES.map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </label>
        )}
      </div>
      <div className="flex items-center gap-1">
        <button
          disabled={page === 0}
          onClick={() => onPage(page - 1)}
          className="rounded-lg border border-border px-3 py-1 disabled:opacity-40 hover:bg-canvas"
        >
          Prev
        </button>
        <span className="px-2 tnum text-[13px]">
          {page + 1} / {pages}
        </span>
        <button
          disabled={page >= pages - 1}
          onClick={() => onPage(page + 1)}
          className="rounded-lg border border-border px-3 py-1 disabled:opacity-40 hover:bg-canvas"
        >
          Next
        </button>
      </div>
    </div>
  );
}

/** Grid density — columns per row, not items per page. */
export const DENSITIES = [3, 4, 5, 6] as const;
export type Density = (typeof DENSITIES)[number];

/** Tailwind can't see `grid-cols-${n}`, so the classes are spelled out. */
export const DENSITY_CLASS: Record<Density, string> = {
  3: "grid-cols-2 sm:grid-cols-3",
  4: "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4",
  5: "grid-cols-2 sm:grid-cols-3 lg:grid-cols-5",
  6: "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6",
};

export function DensityControl({ value, onChange }: { value: Density; onChange: (d: Density) => void }) {
  return (
    <div className="inline-flex items-center gap-1 rounded-lg border border-border bg-surface p-1" role="group" aria-label="Grid density">
      {DENSITIES.map((d) => (
        <button
          key={d}
          onClick={() => onChange(d)}
          aria-pressed={value === d}
          title={`${d} per row`}
          className={`rounded-md px-2.5 py-1 text-[12px] font-semibold tnum transition ${
            value === d ? "bg-brand text-white" : "text-muted hover:text-ink hover:bg-canvas"
          }`}
        >
          ×{d}
        </button>
      ))}
    </div>
  );
}

/** Paginate an array client-side. */
export function paginate<T>(items: T[], page: number, pageSize: number): T[] {
  return items.slice(page * pageSize, (page + 1) * pageSize);
}
