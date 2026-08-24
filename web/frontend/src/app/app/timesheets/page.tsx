"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import type { Session } from "@/lib/types";
import { AddTimeDialog } from "@/components/AddTimeDialog";
import { Badge, Button, EmptyState, PageHeader, Skeleton, StatTile } from "@/components/ui";
import { DataTable, type Column } from "@/components/DataTable";
import { DateRange, FilterBar, rangeToParams, type DateRangeValue } from "@/components/filters";
import { IconPlus } from "@/components/icons";
import { TimesheetCard, weekdayHoursFromSessions } from "@/components/TimesheetCard";
import { formatDurationShort, formatDate, formatTime, sessionSeconds } from "@/lib/format";

export default function TimesheetsPage() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState<DateRangeValue>({ type: "preset", preset: "week" });
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    const { from, to } = rangeToParams(range);
    const qs = new URLSearchParams();
    if (from) qs.set("from", from);
    if (to) qs.set("to", to);
    // No userId param: this is always the caller's own timesheet, regardless
    // of role — the server defaults to self for everyone now.
    api<Session[]>(`/sessions?${qs.toString()}`)
      .then(setSessions)
      .catch(() => setSessions([]))
      .finally(() => setLoading(false));
  }, [range]);

  useEffect(() => {
    load();
  }, [load]);

  /**
   * A manual entry is dated by the member, not by now, so it can easily land
   * outside the range being viewed — and then the table would look unchanged
   * after a successful save. Say what was added, and say where it went when
   * that isn't the list right below.
   */
  const onAdded = useCallback(
    (_session: Session, startedAt: Date, seconds: number) => {
      const { from, to } = rangeToParams(range);
      const inRange =
        (!from || startedAt >= new Date(from)) && (!to || startedAt < new Date(to));
      setAdded(
        `Added ${formatDurationShort(seconds)} on ${formatDate(startedAt.toISOString())}.` +
          (inRange ? "" : " It sits outside the range you're viewing — widen it to see the entry.")
      );
      load();
    },
    [range, load]
  );

  const totalSecs = useMemo(() => sessions.reduce((a, s) => a + sessionSeconds(s), 0), [sessions]);
  const manualSecs = useMemo(
    () => sessions.filter((s) => s.isManual).reduce((a, s) => a + sessionSeconds(s), 0),
    [sessions]
  );
  const flagged = sessions.filter((s) => s.tamperSuspected).length;
  const weekdayHours = useMemo(() => weekdayHoursFromSessions(sessions), [sessions]);

  const columns: Column<Session>[] = [
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
    { key: "duration", header: "Duration", sortValue: (s) => sessionSeconds(s), render: (s) => (
      <span className="tnum font-medium">{formatDurationShort(sessionSeconds(s))}{!s.endedAt && <span className="ml-1 text-xs text-[var(--color-positive)]">live</span>}</span>
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
      <PageHeader
        title="Timesheets"
        subtitle="Your tracked time"
        actions={
          <span data-tour="timesheets-add">
            <Button onClick={() => setAdding(true)}>
              <IconPlus width={16} height={16} />
              Add time
            </Button>
          </span>
        }
      />

      {added && (
        <div className="mb-4 flex items-start justify-between gap-3 rounded-xl border border-border bg-canvas px-4 py-3">
          <p className="text-[13px] text-ink">{added}</p>
          <button
            onClick={() => setAdded(null)}
            className="shrink-0 text-[12px] font-semibold text-muted hover:text-ink"
          >
            Dismiss
          </button>
        </div>
      )}

      <div data-tour="timesheets-filter">
        <FilterBar>
          <DateRange value={range} onChange={setRange} />
        </FilterBar>
      </div>

      {loading ? (
        <div className="space-y-5">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <Skeleton className="h-56 lg:col-span-1" />
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:col-span-2 lg:grid-cols-4">
              {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-24" />)}
            </div>
          </div>
          <Skeleton className="h-96" />
        </div>
      ) : (
        <>
          <div className="mb-5 grid grid-cols-1 gap-4 lg:grid-cols-3" data-tour="timesheets-summary">
            <TimesheetCard data={weekdayHours} className="lg:col-span-1" />
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:col-span-2 lg:grid-cols-4">
              <StatTile icon="⏱" tone="brand" label="Total in range" value={<span className="text-[22px]">{formatDurationShort(totalSecs)}</span>} />
              <StatTile icon="🖊" tone="accent" label="Manual time" value={<span className="text-[22px]">{formatDurationShort(manualSecs)}</span>} />
              <StatTile icon="📋" tone="teal" label="Entries" value={sessions.length} />
              <StatTile icon="⚑" tone="muted" label="Flagged" value={flagged} />
            </div>
          </div>

          <div data-tour="timesheets-table">
            <DataTable
              rows={sessions}
              columns={columns}
              rowId={(s) => s.id}
              empty={
                <EmptyState
                  icon="🕐"
                  title="No time entries in this range"
                  hint="Track time from the desktop app, widen the date range, or add an entry the tracker missed."
                  action={<Button onClick={() => setAdding(true)}>Add time</Button>}
                />
              }
            />
          </div>
        </>
      )}

      {adding && <AddTimeDialog onClose={() => setAdding(false)} onAdded={onAdded} />}
    </div>
  );
}
