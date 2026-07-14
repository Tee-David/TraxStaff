"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { Session } from "@/lib/types";
import { Badge, EmptyState, PageHeader, Skeleton, StatTile } from "@/components/ui";
import { DataTable, type Column } from "@/components/DataTable";
import { DateRange, MemberFilter, FilterBar, rangeToParams, type RangeKey } from "@/components/filters";
import { formatDurationShort, formatDate, formatTime, sessionSeconds } from "@/lib/format";

export default function TimesheetsPage() {
  const { user } = useAuth();
  const isPrivileged = user?.role === "owner" || user?.role === "admin";
  const [sessions, setSessions] = useState<Session[]>([]);
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
    api<Session[]>(`/sessions?${qs.toString()}`)
      .then(setSessions)
      .catch(() => setSessions([]))
      .finally(() => setLoading(false));
  }, [range, member]);

  useEffect(() => {
    load();
  }, [load]);

  const totalSecs = useMemo(() => sessions.reduce((a, s) => a + sessionSeconds(s.startedAt, s.endedAt), 0), [sessions]);
  const manualSecs = useMemo(
    () => sessions.filter((s) => s.isManual).reduce((a, s) => a + sessionSeconds(s.startedAt, s.endedAt), 0),
    [sessions]
  );
  const flagged = sessions.filter((s) => s.tamperSuspected).length;

  const columns: Column<Session>[] = [
    ...(isPrivileged
      ? [{ key: "member", header: "Member", sortValue: (s: Session) => s.user.email, render: (s: Session) => <span className="text-muted">{s.user.email}</span> }]
      : []),
    { key: "project", header: "Project", sortValue: (s) => s.project.name, render: (s) => (
      <div>
        <div className="font-medium">{s.project.name}</div>
        {s.task && <div className="text-xs text-muted">{s.task.title}</div>}
      </div>
    ) },
    { key: "date", header: "Date", sortValue: (s) => s.startedAt, render: (s) => <span className="text-muted">{formatDate(s.startedAt)}</span> },
    { key: "time", header: "Work hour", render: (s) => (
      <span className="tnum text-muted">{formatTime(s.startedAt)}{s.endedAt ? ` – ${formatTime(s.endedAt)}` : ""}</span>
    ) },
    { key: "duration", header: "Duration", sortValue: (s) => sessionSeconds(s.startedAt, s.endedAt), render: (s) => (
      <span className="tnum font-medium">{formatDurationShort(sessionSeconds(s.startedAt, s.endedAt))}{!s.endedAt && <span className="ml-1 text-xs text-[var(--color-positive)]">live</span>}</span>
    ) },
    { key: "type", header: "Type", render: (s) => (
      <span className="space-x-1">
        {s.isManual ? <Badge tone="accent">Manual</Badge> : <Badge tone="brand">Tracked</Badge>}
        {s.tamperSuspected && <Badge tone="red">Flagged</Badge>}
      </span>
    ) },
  ];

  return (
    <div>
      <PageHeader title="Timesheets" subtitle={isPrivileged ? "All team time entries" : "Your tracked time"} />

      <div className="mb-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatTile icon="⏱" tone="brand" label="Total in range" value={<span className="text-[22px]">{formatDurationShort(totalSecs)}</span>} />
        <StatTile icon="🖊" tone="accent" label="Manual time" value={<span className="text-[22px]">{formatDurationShort(manualSecs)}</span>} />
        <StatTile icon="📋" tone="teal" label="Entries" value={sessions.length} />
        <StatTile icon="⚑" tone="muted" label="Flagged" value={flagged} />
      </div>

      <FilterBar>
        <DateRange value={range} onChange={setRange} />
        <MemberFilter value={member} onChange={setMember} enabled={isPrivileged} />
      </FilterBar>

      {loading ? (
        <Skeleton className="h-96" />
      ) : (
        <DataTable
          rows={sessions}
          columns={columns}
          rowId={(s) => s.id}
          empty={<EmptyState icon="🕐" title="No time entries in this range" hint="Track time from the desktop app, or widen the date range." />}
        />
      )}
    </div>
  );
}
