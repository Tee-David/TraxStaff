import { prisma } from "./prisma";
import { EMAIL_TYPE_META, wantsEmail, type EmailType } from "./email-prefs";
import {
  sendManualTimeAddedEmail,
  sendManualTimeDecisionEmail,
  sendManualTimeSubmittedEmail,
  sendUnusualActivityEmail,
  type ManualEntryFacts,
} from "./mailer";

/**
 * In-app notifications, and the email fan-out that mirrors them.
 *
 * Lifted out of routes/sync.ts, which owned `notifyOrg` when unusual-activity
 * flags were the only thing that produced a notification. Manual-time approvals
 * need the same machinery from routes/sessions.ts, and a second copy of "work
 * out who to tell" is how the two would drift.
 *
 * Two rules hold throughout:
 *
 * 1. The in-app row is written first and awaited; the emails are not. A dead
 *    SMTP host must never delay — let alone fail — the request that produced the
 *    event, and the bell is the durable record either way. `sendX` already
 *    resolves `false` rather than throwing, so the floating promise carries no
 *    unhandled rejection; the `.catch` is belt-and-braces for anything thrown
 *    before it gets that far.
 *
 * 2. Email is opt-out per recipient, the in-app stream is not. Muting an email
 *    must never remove an event from the org's view — see lib/email-prefs.ts.
 */

/** Everyone in the org who could receive an admin-facing email. */
async function privilegedRecipients(orgId: string, exceptUserId?: string) {
  return prisma.user.findMany({
    where: {
      orgId,
      role: { in: ["owner", "admin"] },
      // An invited-but-never-joined account has no one reading that mailbox,
      // and a disabled one has been deliberately shut out of the workspace.
      status: "active",
      ...(exceptUserId ? { id: { not: exceptUserId } } : {}),
    },
    select: { id: true, email: true, role: true, emailPrefs: true },
  });
}

/** Fire the emails without blocking the caller — see rule 1 above. */
function fanOut(
  recipients: { email: string; role: string; emailPrefs: unknown }[],
  type: EmailType,
  sendOne: (email: string) => Promise<unknown>
) {
  for (const person of recipients) {
    if (!wantsEmail(person, type)) continue;
    void Promise.resolve()
      .then(() => sendOne(person.email))
      .catch((err) =>
        console.warn(
          `[notify] ${type} email to ${person.email} failed:`,
          err instanceof Error ? err.message : err
        )
      );
  }
}

const FLAG_LABELS: Record<string, string> = Object.fromEntries(
  [
    ["sustained_high_activity", "Sustained high activity"],
    ["low_variance_robotic", "Robotic / low-variance input"],
    ["input_channel_imbalance", "Input channel imbalance"],
    ["jiggler_process_detected", "Mouse-jiggler detected"],
    ["clock_skew_detected", "System clock changed"],
    ["exceeds_elapsed_cap", "Claimed more time than elapsed"],
    ["block_outside_session_window", "Activity outside session window"],
  ] as const
);

/**
 * Record an org-level event about `userId`, and email the admins who want it.
 *
 * Signature preserved from the version that lived in routes/sync.ts, including
 * the silent `return` when the user is gone: this is called from the ingestion
 * path where a vanished user means the work is already orphaned, and there is
 * no org to attribute the notification to. (`auditLog` deliberately does NOT do
 * this — see the note there — because the events it records are precisely the
 * ones where the subject disappears.)
 */
export async function notifyOrg(userId: string, type: string, payload: Record<string, unknown>) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return;

  await prisma.notification.create({
    data: { orgId: user.orgId, userId, type, payload: { ...payload, memberEmail: user.email } },
  });

  if (type !== "unusual_activity") return;
  const flag = typeof payload.type === "string" ? payload.type : "";
  const recipients = await privilegedRecipients(user.orgId);
  fanOut(recipients, "unusual_activity", (to) =>
    sendUnusualActivityEmail(to, {
      memberLabel: user.email,
      flagLabel: FLAG_LABELS[flag] ?? flag.replace(/_/g, " ") ?? "Unusual activity",
      when: new Date().toUTCString(),
    })
  );
}

/**
 * A member added manual time that an admin has to decide on.
 *
 * `submittedById` is excluded from the email fan-out: when an admin enters time
 * for someone else the entry is already approved, and mailing themselves about
 * their own action is noise.
 */
export async function notifyManualTimeSubmitted(args: {
  orgId: string;
  memberId: string | null;
  memberEmail: string;
  sessionId: string;
  submittedById: string;
  facts: ManualEntryFacts;
}) {
  await prisma.notification.create({
    data: {
      orgId: args.orgId,
      userId: args.memberId,
      type: "manual_time_submitted",
      payload: {
        memberEmail: args.memberEmail,
        sessionId: args.sessionId,
        project: args.facts.projectName,
        duration: args.facts.duration,
        reason: args.facts.reason,
      },
    },
  });

  const recipients = await privilegedRecipients(args.orgId, args.submittedById);
  fanOut(recipients, "manual_time_submitted", (to) =>
    sendManualTimeSubmittedEmail(to, args.facts)
  );
}

/** An admin approved or rejected an entry — tell the member whose time it is. */
export async function notifyManualTimeDecided(args: {
  orgId: string;
  member: { id: string; email: string; role: string; emailPrefs: unknown } | null;
  sessionId: string;
  decision: "approved" | "rejected";
  decidedBy: string;
  note?: string | null;
  facts: ManualEntryFacts;
}) {
  await prisma.notification.create({
    data: {
      orgId: args.orgId,
      userId: args.member?.id ?? null,
      type: "manual_time_decided",
      payload: {
        memberEmail: args.member?.email ?? args.facts.memberLabel,
        sessionId: args.sessionId,
        decision: args.decision,
        decidedBy: args.decidedBy,
        duration: args.facts.duration,
        note: args.note ?? null,
      },
    },
  });

  // No member row means the account was deleted after the entry was made —
  // the notification above still belongs to the org's history, but there is
  // nobody left to email.
  if (!args.member) return;
  fanOut([args.member], "manual_time_decided", (to) =>
    sendManualTimeDecisionEmail(to, args.decision, {
      ...args.facts,
      decidedBy: args.decidedBy,
      note: args.note,
    })
  );
}

/**
 * An admin entered time on a member's behalf — tell the member.
 *
 * Governed by the same preference as a decision (`manual_time_decided`): from
 * the member's side both are "an admin did something to my manual time", and
 * splitting them into two toggles would be a distinction only the code cares
 * about.
 */
export async function notifyManualTimeAdded(args: {
  orgId: string;
  member: { id: string; email: string; role: string; emailPrefs: unknown };
  sessionId: string;
  addedBy: string;
  facts: ManualEntryFacts;
}) {
  await prisma.notification.create({
    data: {
      orgId: args.orgId,
      userId: args.member.id,
      type: "manual_time_added",
      payload: {
        memberEmail: args.member.email,
        sessionId: args.sessionId,
        addedBy: args.addedBy,
        duration: args.facts.duration,
        project: args.facts.projectName,
      },
    },
  });

  fanOut([args.member], "manual_time_decided", (to) =>
    sendManualTimeAddedEmail(to, { ...args.facts, addedBy: args.addedBy })
  );
}

/** Exported for the settings UI, so the labels live in one place. */
export { EMAIL_TYPE_META };
