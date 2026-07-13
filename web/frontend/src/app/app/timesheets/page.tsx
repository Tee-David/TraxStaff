"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { Session } from "@/lib/types";
import { Badge, Card } from "@/components/ui";
import { DateRange, MemberFilter, FilterBar, Pagination, paginate, rangeToParams, type RangeKey } from "@/components/filters";
import { formatDurationShort, formatTime, sessionSeconds } from "@/lib/format";

function dayKey(iso: string): string {
  return new Date(iso).toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" });
}

const DAYS_PER_PAGE = 7;

export default function TimesheetsPage() {
  const { user } = useAuth();
  const isPrivileged = user?.role === "owner" || user?.role === "admin";
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState<RangeKey>("week");
  const [member, setMember] = useState("");
  const [page, setPage] = useState(0);

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
    setPage(0);
  }, [load]);

  const byDay = useMemo(() => {
    const groups = new Map<string, Session[]>();
    for (const s of sessions) {
      const key = dayKey(s.startedAt);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(s);
    }
    return [...groups.entries()];
  }, [sessions]);

  const pageDays = paginate(byDay, page, DAYS_PER_PAGE);

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-2xl">Timesheets</h1>
        <p className="text-sm text-muted">{isPrivileged ? "All team time entries" : "Your tracked time"}</p>
      </div>

      <FilterBar>
        <DateRange value={range} onChange={setRange} />
        <MemberFilter value={member} onChange={setMember} enabled={isPrivileged} />
      </FilterBar>

      {loading ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : byDay.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted">No time entries in this range.</Card>
      ) : (
        <>
          <div className="space-y-6">
            {pageDays.map(([day, rows]) => {
              const dayTotal = rows.reduce((a, s) => a + sessionSeconds(s.startedAt, s.endedAt), 0);
              return (
                <Card key={day} className="p-5">
                  <div className="mb-3 flex items-center justify-between">
                    <h2 className="text-base font-semibold">{day}</h2>
                    <span className="text-sm text-muted">{formatDurationShort(dayTotal)}</span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                          {isPrivileged && <th className="pb-2 font-medium">Member</th>}
                          <th className="pb-2 font-medium">Project</th>
                          <th className="pb-2 font-medium">Task</th>
                          <th className="pb-2 font-medium">Time</th>
                          <th className="pb-2 font-medium">Duration</th>
                          <th className="pb-2 font-medium">Type</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((s) => (
                          <tr key={s.id} className="border-b border-border/60 last:border-0">
                            {isPrivileged && <td className="py-2.5 text-muted">{s.user.email}</td>}
                            <td className="py-2.5 font-medium">{s.project.name}</td>
                            <td className="py-2.5 text-muted">{s.task?.title ?? "—"}</td>
                            <td className="py-2.5 text-muted">
                              {formatTime(s.startedAt)}
                              {s.endedAt ? ` – ${formatTime(s.endedAt)}` : ""}
                            </td>
                            <td className="py-2.5">
                              {formatDurationShort(sessionSeconds(s.startedAt, s.endedAt))}
                              {!s.endedAt && <span className="ml-1 text-xs text-green-600">(live)</span>}
                            </td>
                            <td className="space-x-1 py-2.5">
                              {s.isManual ? <Badge tone="accent">Manual</Badge> : <Badge tone="brand">Tracked</Badge>}
                              {s.tamperSuspected && <Badge tone="red">Flagged</Badge>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Card>
              );
            })}
          </div>
          <Pagination page={page} pageSize={DAYS_PER_PAGE} total={byDay.length} onPage={setPage} />
        </>
      )}
    </div>
  );
}
