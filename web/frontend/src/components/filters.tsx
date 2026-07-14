"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
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

export function DateRange({ value, onChange }: { value: DateRangeValue; onChange: (v: DateRangeValue) => void }) {
  return <DateRangePicker value={value} onChange={onChange} />;
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
    <Select
      value={value}
      onChange={onChange}
      searchable
      options={[{ value: "", label: "All members" }, ...members.map((m) => ({ value: m.id, label: m.email }))]}
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
