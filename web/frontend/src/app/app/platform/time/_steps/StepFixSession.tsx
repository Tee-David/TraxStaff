"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { Badge, Button, Card, Input, Label, Skeleton } from "@/components/ui";
import { hoursMinutes } from "@/lib/platform";
import type { WizardState } from "./types";

interface SessionRow {
  id: string;
  dayKey: string;
  project: { id: string; name: string };
  startedAt: string;
  endedAt: string | null;
  seconds: number;
  isManual: boolean;
  manualReason: string | null;
  blocks: number;
}

/**
 * Step 3, for "fix a session the tracker got wrong".
 *
 * This branch is a picker rather than a generator: you are not describing hours
 * to create, you are pointing at one row that is wrong. It reads
 * `GET /admin/users/:id/time`, which already existed with no UI in front of it,
 * and drives `PATCH /admin/sessions/:id/span` and `DELETE /admin/sessions/:id`.
 *
 * The long-session case is called out on the row because that is what the tool
 * is for: a sixteen-hour session that crosses midnight is a machine nobody
 * closed, and spotting it is most of the work.
 */
export function StepFixSession({
  state,
  update,
  onDone,
  onError,
}: {
  state: WizardState;
  update: (patch: Partial<WizardState>) => void;
  onDone: (message: string, snapshotId?: string) => void;
  onError: (message: string) => void;
}) {
  const [rows, setRows] = useState<SessionRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!state.userId) return;
    setLoading(true);
    try {
      const from = new Date(`${state.from}T00:00:00.000Z`).toISOString();
      const to = new Date(`${state.to}T23:59:59.000Z`).toISOString();
      const res = await api<{ sessions: SessionRow[] }>(
        `/admin/users/${state.userId}/time?from=${from}&to=${to}`
      );
      setRows(res.sessions ?? []);
    } catch (err) {
      onError(err instanceof ApiError ? err.message : "Could not load their sessions");
    } finally {
      setLoading(false);
    }
    // onError is stable enough for this; re-running on it would refetch on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.userId, state.from, state.to]);

  useEffect(() => {
    load();
  }, [load]);

  const selected = rows.find((r) => r.id === state.sessionId) ?? null;

  async function trim() {
    if (!selected || !state.newEnd) return;
    setBusy(true);
    try {
      const res = await api<{ snapshotId: string; blocksRemoved: number; screenshotsRemoved: number }>(
        `/admin/sessions/${selected.id}/span`,
        {
          method: "PATCH",
          body: JSON.stringify({
            endedAt: new Date(state.newEnd).toISOString(),
            reason: state.reason.trim() || "Corrected a session the tracker got wrong",
          }),
        }
      );
      onDone(
        `Session trimmed. ${res.blocksRemoved} activity block(s) and ${res.screenshotsRemoved} screenshot(s) removed.`,
        res.snapshotId
      );
    } catch (err) {
      onError(err instanceof ApiError ? err.message : "Could not trim that session");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setBusy(true);
    try {
      await api(`/admin/sessions/${id}`, { method: "DELETE" });
      onDone("Session deleted.");
    } catch (err) {
      onError(err instanceof ApiError ? err.message : "Could not delete that session");
    } finally {
      setBusy(false);
      setConfirmDelete(null);
    }
  }

  return (
    <div>
      <h2 className="font-heading text-lg font-semibold">Which session is wrong?</h2>
      <p className="mt-1 text-sm text-muted">
        Sessions in the chosen period. A session spanning midnight is usually a machine left
        running rather than a long shift.
      </p>

      <div className="mt-4 flex flex-wrap gap-3">
        <div className="max-w-[14rem]">
          <Label>From</Label>
          <Input type="date" value={state.from} onChange={(e) => update({ from: e.target.value })} />
        </div>
        <div className="max-w-[14rem]">
          <Label>To</Label>
          <Input type="date" value={state.to} onChange={(e) => update({ to: e.target.value })} />
        </div>
      </div>

      <div className="mt-5 space-y-2">
        {loading && <Skeleton className="h-32 w-full" />}
        {!loading && rows.length === 0 && (
          <Card className="p-4 text-sm text-muted">No sessions in that period.</Card>
        )}

        {!loading &&
          rows.map((r) => {
            const on = r.id === state.sessionId;
            const crossesMidnight =
              r.endedAt && r.endedAt.slice(0, 10) !== r.startedAt.slice(0, 10);
            const long = r.seconds > 12 * 3600;

            return (
              <Card
                key={r.id}
                className={`p-4 transition ${on ? "border-brand ring-1 ring-brand/30" : ""}`}
              >
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={() =>
                      update({
                        sessionId: on ? "" : r.id,
                        // Pre-fill a sane correction: eight hours from the start.
                        newEnd: on
                          ? ""
                          : new Date(new Date(r.startedAt).getTime() + 8 * 3600_000)
                              .toISOString()
                              .slice(0, 16),
                      })
                    }
                    className="min-w-0 flex-1 text-left"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{r.dayKey}</span>
                      <span className="tnum text-sm text-muted">{hoursMinutes(r.seconds)}</span>
                      <Badge tone={r.isManual ? "brand" : "muted"}>
                        {r.isManual ? "manual" : "captured"}
                      </Badge>
                      {(long || crossesMidnight) && <Badge tone="red">looks wrong</Badge>}
                    </div>
                    <div className="mt-0.5 text-xs text-muted">
                      {r.startedAt.slice(11, 16)} to {r.endedAt?.slice(11, 16) ?? "open"} ·{" "}
                      {r.project.name} · {r.blocks} blocks
                    </div>
                  </button>

                  {confirmDelete === r.id ? (
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted">Delete permanently?</span>
                      <Button variant="danger" disabled={busy} onClick={() => remove(r.id)}>
                        Yes, delete
                      </Button>
                      <Button variant="ghost" onClick={() => setConfirmDelete(null)}>
                        No
                      </Button>
                    </div>
                  ) : (
                    r.isManual && (
                      <Button variant="ghost" onClick={() => setConfirmDelete(r.id)}>
                        Delete
                      </Button>
                    )
                  )}
                </div>

                {on && (
                  <div className="mt-4 border-t border-border pt-4">
                    <Label>New end time</Label>
                    <div className="flex flex-wrap items-end gap-3">
                      <Input
                        type="datetime-local"
                        value={state.newEnd}
                        onChange={(e) => update({ newEnd: e.target.value })}
                        className="max-w-[16rem]"
                      />
                      <Button disabled={busy || !state.newEnd} onClick={trim}>
                        {busy ? "Working…" : "Trim to here"}
                      </Button>
                    </div>
                    <p className="mt-2 text-xs text-muted">
                      Activity blocks past the new end are removed, and the screenshots attached to
                      them go too — a screenshot cannot exist without its block. An undo snapshot is
                      taken first.
                    </p>
                  </div>
                )}
              </Card>
            );
          })}
      </div>
    </div>
  );
}
