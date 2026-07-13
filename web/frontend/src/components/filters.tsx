"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";

export type RangeKey = "today" | "week" | "month" | "all";

export function rangeToParams(key: RangeKey): { from?: string; to?: string } {
  const now = new Date();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  if (key === "today") return { from: start.toISOString() };
  if (key === "week") {
    const d = new Date(start);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return { from: d.toISOString() };
  }
  if (key === "month") {
    const d = new Date(start.getFullYear(), start.getMonth(), 1);
    return { from: d.toISOString() };
  }
  return {};
}

export const RANGE_LABELS: Record<RangeKey, string> = {
  today: "Today",
  week: "This week",
  month: "This month",
  all: "All time",
};

/** Segmented date-range control. */
export function DateRange({ value, onChange }: { value: RangeKey; onChange: (k: RangeKey) => void }) {
  return (
    <div className="inline-flex rounded-lg border border-border bg-surface p-0.5">
      {(Object.keys(RANGE_LABELS) as RangeKey[]).map((k) => (
        <button
          key={k}
          onClick={() => onChange(k)}
          className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
            value === k ? "bg-brand text-brand-fg" : "text-muted hover:text-ink"
          }`}
        >
          {RANGE_LABELS[k]}
        </button>
      ))}
    </div>
  );
}

interface Member {
  id: string;
  email: string;
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
    api<Member[]>("/members")
      .then(setMembers)
      .catch(() => {});
  }, [enabled]);
  if (!enabled) return null;
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-lg border border-border bg-surface px-3 py-1.5 text-xs outline-none focus:border-brand"
    >
      <option value="">All members</option>
      {members.map((m) => (
        <option key={m.id} value={m.id}>
          {m.email}
        </option>
      ))}
    </select>
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

export function Pagination({
  page,
  pageSize,
  total,
  onPage,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (p: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  const from = total === 0 ? 0 : page * pageSize + 1;
  const to = Math.min(total, (page + 1) * pageSize);
  return (
    <div className="mt-4 flex items-center justify-between text-sm text-muted">
      <span>
        {from}–{to} of {total}
      </span>
      <div className="flex gap-1">
        <button
          disabled={page === 0}
          onClick={() => onPage(page - 1)}
          className="rounded-lg border border-border px-3 py-1 disabled:opacity-40 hover:bg-canvas"
        >
          Prev
        </button>
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

/** Paginate an array client-side. */
export function paginate<T>(items: T[], page: number, pageSize: number): T[] {
  return items.slice(page * pageSize, (page + 1) * pageSize);
}
