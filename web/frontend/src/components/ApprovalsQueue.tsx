"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { Session } from "@/lib/types";
import { Badge, Button, Card, EmptyState, Input, Label } from "@/components/ui";
import { useMotionPresets } from "@/lib/motion";
import { formatDate, formatDurationShort, formatTime, sessionSeconds } from "@/lib/format";
import { ownerName } from "@/lib/format";

/**
 * The admin queue for manual time waiting on a decision.
 *
 * Deliberately a list of cards rather than a row in the timesheet table. Every
 * decision here rests on the member's stated reason — free text, often a
 * sentence — and a table column either truncates that or wrecks the row height
 * for every other entry. The reason is the evidence; it gets room.
 */

/** Reject needs a reason, so it needs a dialog. Approve is a single click. */
function RejectDialog({
  session,
  onClose,
  onConfirm,
}: {
  session: Session;
  onClose: () => void;
  onConfirm: (note: string) => Promise<void>;
}) {
  const m = useMotionPresets();
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const who = ownerName(session.user);

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
        role="dialog"
        aria-modal="true"
        aria-label="Reject manual time"
        {...m.backdrop}
      >
        <div className="absolute inset-0 bg-black/40" onClick={() => !saving && onClose()} />
        <motion.div className="relative z-10 w-full max-w-sm" {...m.dialog}>
          <Card className="p-6">
            <h2 className="font-heading text-[15px] font-semibold text-ink">Reject this entry</h2>
            <p className="mt-1 text-[12px] text-muted">
              {formatDurationShort(sessionSeconds(session))} on {formatDate(session.startedAt)} for{" "}
              {who}. The entry stays on their timesheet marked rejected — nothing is deleted — and
              stops counting toward reports.
            </p>
            <div className="mt-4">
              <Label>Reason</Label>
              <Input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Already covered by tracked time…"
                maxLength={500}
                autoFocus
              />
              <p className="mt-1.5 text-[12px] text-muted">
                Sent to {who}. Required — a rejection with no reason gives them nothing to act on.
              </p>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
              <Button
                variant="danger"
                disabled={saving || note.trim() === ""}
                onClick={async () => {
                  setSaving(true);
                  try {
                    await onConfirm(note.trim());
                    onClose();
                  } finally {
                    setSaving(false);
                  }
                }}
              >
                {saving ? "Rejecting…" : "Reject entry"}
              </Button>
            </div>
          </Card>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

export function ApprovalsQueue({
  sessions,
  onDecided,
}: {
  sessions: Session[];
  onDecided: () => void;
}) {
  const { user } = useAuth();
  const m = useMotionPresets();
  const [busy, setBusy] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<Session | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function decide(session: Session, decision: "approve" | "reject", note?: string) {
    setBusy(session.id);
    setError(null);
    try {
      await api(`/sessions/${session.id}/${decision}`, {
        method: "POST",
        body: JSON.stringify(note ? { note } : {}),
      });
      onDecided();
    } catch (e) {
      setError(
        e instanceof ApiError ? e.message : "Couldn't record that decision. Try again."
      );
    } finally {
      setBusy(null);
    }
  }

  if (sessions.length === 0) {
    return (
      <EmptyState
        icon="✅"
        title="Nothing waiting for review"
        hint="Manual entries your team submits show up here until someone approves or rejects them."
      />
    );
  }

  return (
    <div className="space-y-3">
      {error && (
        <p className="rounded-lg bg-[var(--color-negative)]/10 px-3 py-2.5 text-[13px] text-[var(--color-negative)]">
          {error}
        </p>
      )}

      {sessions.map((s) => {
        // Nobody signs off their own hours; the server enforces it, and the UI
        // says why rather than offering a button that returns 403. The owner is
        // the exception — they may be the only privileged account there is.
        const isOwn = s.user?.id === user?.id;
        const canDecide = !isOwn || user?.role === "owner";

        return (
          <motion.div key={s.id} {...m.hover}>
            <Card className="p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-heading text-[15px] font-semibold text-ink">
                      {ownerName(s.user)}
                    </span>
                    <Badge tone="accent">Pending</Badge>
                    {s.tamperSuspected && <Badge tone="red">Flagged</Badge>}
                  </div>
                  <div className="mt-1 text-[13px] text-ink">
                    {s.project.name}
                    {s.task && <span className="text-muted"> — {s.task.title}</span>}
                  </div>
                  <div className="mt-0.5 text-[13px] text-muted tnum">
                    {formatDate(s.startedAt)} · {formatTime(s.startedAt)}
                    {s.endedAt ? ` – ${formatTime(s.endedAt)}` : ""} ·{" "}
                    <span className="font-semibold text-ink">
                      {formatDurationShort(sessionSeconds(s))}
                    </span>
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  <Button
                    variant="ghost"
                    disabled={busy === s.id || !canDecide}
                    onClick={() => setRejecting(s)}
                  >
                    Reject
                  </Button>
                  <Button
                    disabled={busy === s.id || !canDecide}
                    onClick={() => decide(s, "approve")}
                  >
                    {busy === s.id ? "Saving…" : "Approve"}
                  </Button>
                </div>
              </div>

              {s.manualReason && (
                <p className="mt-3 rounded-lg bg-canvas px-3 py-2.5 text-[13px] text-ink">
                  <span className="text-muted">Reason: </span>
                  {s.manualReason}
                </p>
              )}

              {!canDecide && (
                <p className="mt-3 text-[12px] text-muted">
                  This is your own entry — another admin has to review it.
                </p>
              )}
            </Card>
          </motion.div>
        );
      })}

      {rejecting && (
        <RejectDialog
          session={rejecting}
          onClose={() => setRejecting(null)}
          onConfirm={(note) => decide(rejecting, "reject", note)}
        />
      )}
    </div>
  );
}
