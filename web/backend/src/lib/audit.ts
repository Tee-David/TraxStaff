import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";

/**
 * Every action the audit log records. Kept as a closed union rather than free
 * strings so a typo becomes a compile error instead of an entry nobody can
 * filter for, and so the frontend's label map can be exhaustive.
 */
export type AuditAction =
  | "member.invited"
  | "member.role_changed"
  | "member.disabled"
  | "member.reenabled"
  | "member.removed"
  | "member.deleted"
  | "project.archived"
  | "project.unarchived"
  | "project.deleted"
  | "task.deleted"
  | "screenshot.deleted"
  | "idle.discarded"
  // The counterpart to idle.discarded. Away time is now deducted the moment the
  // member returns, so choosing to keep it is a positive adjustment to recorded
  // hours — and anything that adds time back belongs in the trail just as much as
  // anything that takes it away.
  | "idle.kept"
  // A recorded end time was corrected because the session was abandoned rather
  // than stopped, so the original value credited an outage as work. Written by the
  // stale-session backfill; the live sweeper closes rows that were never given a
  // wrong end in the first place and has nothing to log.
  | "session.end_corrected"
  // Manual-time approvals. All three change what a member is credited for
  // without the tracker having witnessed anything, so all three belong in the
  // trail: who added hours nobody recorded, and who signed them off.
  | "manual_time.added_for_member"
  // An admin adding approved hours to their OWN timesheet. Its own action
  // rather than a variant of the above: nobody reviews it, so the trail is the
  // only place it can be questioned.
  | "manual_time.self_added"
  | "manual_time.approved"
  | "manual_time.rejected";

interface AuditEntry {
  /** Required, and passed in explicitly — see the note below. */
  orgId: string;
  /** Who did it. Null for system-originated actions. */
  actorId?: string | null;
  actorEmail?: string | null;
  action: AuditAction;
  /** Who/what it was done to — an email for member actions, a name otherwise. */
  targetId?: string | null;
  targetLabel?: string | null;
  /** Anything else worth showing on the row (old/new role, counts, reasons). */
  details?: Record<string, unknown>;
}

/**
 * Record one auditable action. Best-effort by design: a failure here is logged
 * by the caller's own error handling at worst, but must never turn a successful
 * delete into a 500 — the action already happened, and throwing would leave the
 * caller unable to tell the user the truth about it.
 *
 * Two deliberate choices:
 *
 * 1. `orgId` is a parameter, not something derived from looking up the actor.
 *    `notifyOrg()` in routes/sync.ts derives it and silently `return`s when the
 *    user is gone; applied here that would drop precisely the events this table
 *    exists for (a member being deleted).
 *
 * 2. `actorEmail`/`targetLabel` are denormalised into `payload` rather than read
 *    back through the `actor` relation at display time. The row has to stay
 *    readable after the account it names has been hard-deleted — that is the
 *    entire point of the table, and it is the same trick notifyOrg() uses with
 *    `payload.memberEmail`.
 */
export async function auditLog(entry: AuditEntry): Promise<void> {
  // The JWT carries only { userId, orgId, role } — no email — so resolve the
  // actor's address here rather than making every call site do it. Safe to look
  // up (unlike orgId above): the actor is whoever is performing the action, so
  // they exist by definition at this moment. One extra SELECT, only on the
  // destructive actions this table records.
  let actorEmail = entry.actorEmail ?? null;
  if (!actorEmail && entry.actorId) {
    actorEmail = await prisma.user
      .findUnique({ where: { id: entry.actorId }, select: { email: true } })
      .then((u) => u?.email ?? null)
      .catch(() => null);
  }

  const payload: Record<string, unknown> = {
    actorEmail,
    targetId: entry.targetId ?? null,
    targetLabel: entry.targetLabel ?? null,
    ...(entry.details ?? {}),
  };

  try {
    await prisma.auditLog.create({
      data: {
        orgId: entry.orgId,
        actorId: entry.actorId ?? null,
        action: entry.action,
        payload: payload as Prisma.InputJsonValue,
      },
    });
  } catch (err) {
    // Swallowed on purpose. The table may not exist yet on a database where
    // ensureAuditLogTable() could not run; that should degrade to "no trail",
    // never to a failed request.
    console.warn(`[audit] could not record ${entry.action}:`, err instanceof Error ? err.message : err);
  }
}
