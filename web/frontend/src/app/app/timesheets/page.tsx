"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { ApprovalState, Session } from "@/lib/types";
import { AddTimeDialog } from "@/components/AddTimeDialog";
import { ApprovalsQueue } from "@/components/ApprovalsQueue";
import { Badge, Button, EmptyState, PageHeader, Skeleton, StatTile } from "@/components/ui";
import { DataTable, type Column } from "@/components/DataTable";
import { DateRange, FilterBar, rangeToParams, type DateRangeValue } from "@/components/filters";
import { IconPlus } from "@/components/icons";
import { TimesheetCard, weekdayHoursFromSessions } from "@/components/TimesheetCard";
import {
  formatDurationShort,
  formatDate,
  formatTime,
  ownerName,
  sessionSeconds,
} from "@/lib/format";

/**
 * Three views behind one page, because they are three questions about the same
 * data and splitting them across routes would mean three date pickers to keep in
 * step. A member only ever sees the first.
 *
 *   mine      — my own time, every role's default (the server defaults to self)
 *   team      — the whole org, admin-only and opt-in per request (?scope=team)
 *   approvals — the org's manual entries still waiting on a decision
 */
type View = "mine" | "team" | "approvals";

const VIEWS: { id: View; label: string }[] = [
  { id: "mine", label: "My time" },
  { id: "team", label: "Team" },
  { id: "approvals", label: "Approvals" },
];

/** Manual rows carry a decision; tracked rows have nothing to show. */
function ApprovalBadge({ session }: { session: Session }) {
  if (!session.isManual) return null;
  const state: ApprovalState = session.approvalState ?? "approved";
  if (state === "pending") return <Badge tone="accent">Pending</Badge>;
  if (state === "rejected") return <Badge tone="red">Rejected</Badge>;
  return <Badge tone="green">Approved</Badge>;
}

export default function TimesheetsPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "owner" || user?.role === "admin";

  const [sessions, setSessions] = useState<Session[]>([]);
  const [pending, setPending] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState<DateRangeValue>({ type: "preset", preset: "week" });
  const [view, setView] = useState<View>("mine");
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const rangeQuery = useCallback(() => {
    const { from, to } = rangeToParams(range);
    const qs = new URLSearchParams();
    if (from) qs.set("from", from);
    if (to) qs.set("to", to);
    return qs;
  }, [range]);

  const load = useCallback(() => {
    setLoading(true);
    const qs = rangeQuery();
    // `scope=team` is the deliberate opt-in — without it the server hands even
    // an owner nothing but their own rows, which is what "My time" wants.
    if (view !== "mine") qs.set("scope", "team");
    api<Session[]>(`/sessions?${qs.toString()}`)
      .then(setSessions)
      .catch(() => setSessions([]))
      .finally(() => setLoading(false));
  }, [rangeQuery, view]);

  /**
   * The pending queue is loaded separately from the table, and deliberately
   * WITHOUT the date filter.
   *
   * An entry waiting on a decision is waiting whatever week you happen to be
   * looking at, and the one thing this queue must never do is hide work from the
   * person whose job is to clear it. That also lets the tab carry a live count
   * while you sit on another view.
   */
  const loadPending = useCallback(() => {
    if (!isAdmin) return;
    api<Session[]>("/sessions?scope=team&approval=pending")
      .then(setPending)
      .catch(() => setPending([]));
  }, [isAdmin]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    loadPending();
  }, [loadPending]);

  /**
   * A manual entry is dated by the member, not by now, so it can easily land
   * outside the range being viewed — and then the table would look unchanged
   * after a successful save. Say what happened, where it went when that isn't
   * the list right below, and whether it counts yet.
   */
  const onAdded = useCallback(
    (session: Session, startedAt: Date, seconds: number) => {
      const { from, to } = rangeToParams(range);
      const inRange = (!from || startedAt >= new Date(from)) && (!to || startedAt < new Date(to));
      const submitted = (session.approvalStatus ?? session.approvalState) === "pending";
      setNotice(
        `Added ${formatDurationShort(seconds)} on ${formatDate(startedAt.toISOString())}.` +
          (submitted ? " It's waiting for an admin to approve it." : "") +
          (inRange ? "" : " It sits outside the range you're viewing — widen it to see the entry.")
      );
      load();
      loadPending();
    },
    [range, load, loadPending]
  );

  const onDecided = useCallback(() => {
    load();
    loadPending();
  }, [load, loadPending]);

  const totalSecs = useMemo(
    // Rejected time is excluded from the total for the same reason the server
    // keeps it out of reports: an admin has said those hours don't count, and a
    // headline figure that still includes them is the one number people quote.
    () =>
      sessions
        .filter((s) => s.approvalState !== "rejected")
        .reduce((a, s) => a + sessionSeconds(s), 0),
    [sessions]
  );
  const manualSecs = useMemo(
    () =>
      sessions
        .filter((s) => s.isManual && s.approvalState !== "rejected")
        .reduce((a, s) => a + sessionSeconds(s), 0),
    [sessions]
  );
  const pendingSecs = useMemo(
    () =>
      sessions
        .filter((s) => s.approvalState === "pending")
        .reduce((a, s) => a + sessionSeconds(s), 0),
    [sessions]
  );
  const weekdayHours = useMemo(
    () => weekdayHoursFromSessions(sessions.filter((s) => s.approvalState !== "rejected")),
    [sessions]
  );

  const columns: Column<Session>[] = [
    ...(view === "team"
      ? [
          {
            key: "member",
            header: "Member",
            sortValue: (s: Session) => ownerName(s.user),
            render: (s: Session) => <span className="font-medium">{ownerName(s.user)}</span>,
          },
        ]
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
    { key: "duration", header: "Duration", sortValue: (s) => sessionSeconds(s), render: (s) => (
      <span className={`tnum font-medium ${s.approvalState === "rejected" ? "text-faint line-through" : ""}`}>
        {formatDurationShort(sessionSeconds(s))}
        {!s.endedAt && <span className="ml-1 text-xs text-[var(--color-positive)]">live</span>}
      </span>
    ) },
    { key: "type", header: "Type", render: (s) => (
      <span className="space-x-1">
        {s.isManual ? <Badge tone="accent">Manual</Badge> : <Badge tone="brand">Tracked</Badge>}
        {s.tamperSuspected && <Badge tone="red">Flagged</Badge>}
      </span>
    ) },
    { key: "status", header: "Status", render: (s) => (
      <div className="space-y-1">
        <ApprovalBadge session={s} />
        {/* Why it was rejected, and who added it for you — both are things the
            person reading their own timesheet would otherwise have to ask. */}
        {s.approvalState === "rejected" && s.decisionNote && (
          <div className="max-w-[220px] text-xs text-muted">{s.decisionNote}</div>
        )}
        {s.addedByEmail && (
          <div className="text-xs text-muted">by {s.addedByEmail.split("@")[0]}</div>
        )}
      </div>
    ) },
  ];

  const subtitle =
    view === "approvals"
      ? "Manual entries waiting on a decision"
      : view === "team"
        ? "Every member's time in this range"
        : "Your tracked time";

  return (
    <div>
      <PageHeader
        title="Timesheets"
        subtitle={subtitle}
        actions={
          <span data-tour="timesheets-add">
            <Button onClick={() => setAdding(true)}>
              <IconPlus width={16} height={16} />
              Add time
            </Button>
          </span>
        }
      />

      {isAdmin && (
        <div className="mb-4 inline-flex rounded-xl border border-border bg-surface p-1" data-tour="timesheets-views">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              onClick={() => setView(v.id)}
              aria-pressed={view === v.id}
              className={`rounded-lg px-3.5 py-1.5 text-[13px] font-medium transition ${
                view === v.id ? "bg-brand text-brand-fg" : "text-muted hover:text-ink"
              }`}
            >
              {v.label}
              {v.id === "approvals" && pending.length > 0 && (
                <span
                  className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[11px] font-semibold ${
                    view === v.id ? "bg-white/20" : "bg-accent/15 text-accent"
                  }`}
                >
                  {pending.length}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {notice && (
        <div className="mb-4 flex items-start justify-between gap-3 rounded-xl border border-border bg-canvas px-4 py-3">
          <p className="text-[13px] text-ink">{notice}</p>
          <button
            onClick={() => setNotice(null)}
            className="shrink-0 text-[12px] font-semibold text-muted hover:text-ink"
          >
            Dismiss
          </button>
        </div>
      )}

      {view === "approvals" ? (
        <div data-tour="timesheets-approvals">
          <ApprovalsQueue sessions={pending} onDecided={onDecided} />
        </div>
      ) : (
        <>
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
                  <StatTile icon="⏳" tone="teal" label="Awaiting approval" value={<span className="text-[22px]">{formatDurationShort(pendingSecs)}</span>} />
                  <StatTile icon="📋" tone="muted" label="Entries" value={sessions.length} />
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
        </>
      )}

      {adding && <AddTimeDialog onClose={() => setAdding(false)} onAdded={onAdded} />}
    </div>
  );
}
