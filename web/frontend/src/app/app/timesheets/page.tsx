"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { Session } from "@/lib/types";
import { Badge, Card } from "@/components/ui";
import {
  formatDurationShort,
  formatTime,
  sessionSeconds,
} from "@/lib/format";

function dayKey(iso: string): string {
  return new Date(iso).toLocaleDateString([], {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}

export default function TimesheetsPage() {
  const { user } = useAuth();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);

  const isPrivileged = user?.role === "owner" || user?.role === "admin";

  useEffect(() => {
    api<Session[]>("/sessions")
      .then(setSessions)
      .catch(() => setSessions([]))
      .finally(() => setLoading(false));
  }, []);

  const byDay = useMemo(() => {
    const groups = new Map<string, Session[]>();
    for (const s of sessions) {
      const key = dayKey(s.startedAt);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(s);
    }
    return [...groups.entries()];
  }, [sessions]);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl">Timesheets</h1>
        <p className="text-sm text-muted">
          {isPrivileged ? "All team time entries" : "Your tracked time"}
        </p>
      </div>

      {loading ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : byDay.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted">No time entries yet.</Card>
      ) : (
        <div className="space-y-6">
          {byDay.map(([day, rows]) => {
            const dayTotal = rows.reduce(
              (acc, s) => acc + sessionSeconds(s.startedAt, s.endedAt),
              0
            );
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
                          {isPrivileged && (
                            <td className="py-2.5 text-muted">{s.user.email}</td>
                          )}
                          <td className="py-2.5 font-medium">{s.project.name}</td>
                          <td className="py-2.5 text-muted">{s.task?.title ?? "—"}</td>
                          <td className="py-2.5 text-muted">
                            {formatTime(s.startedAt)}
                            {s.endedAt ? ` – ${formatTime(s.endedAt)}` : ""}
                          </td>
                          <td className="py-2.5">
                            {formatDurationShort(sessionSeconds(s.startedAt, s.endedAt))}
                            {!s.endedAt && (
                              <span className="ml-1 text-xs text-green-600">(live)</span>
                            )}
                          </td>
                          <td className="py-2.5 space-x-1">
                            {s.isManual ? (
                              <Badge tone="accent">Manual</Badge>
                            ) : (
                              <Badge tone="brand">Tracked</Badge>
                            )}
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
      )}
    </div>
  );
}
