import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import {
  STALE_GRACE_MS,
  effectiveEnd,
  evidenceSelect,
  lastEvidenceAt,
  overlapsRange,
  workedSeconds,
} from "../lib/duration";
import { APPROVAL_STATUSES, canDecide, effectiveStatus } from "../lib/approval";
import { orgScoped } from "../lib/org-scope";
import { auditLog } from "../lib/audit";
import { notifyManualTimeAdded, notifyManualTimeDecided, notifyManualTimeSubmitted } from "../lib/notify";
import type { ManualEntryFacts } from "../lib/mailer";

// A session whose device hasn't heartbeat within this window is considered
// dead and can be taken over by another device. Heartbeats are every 60s, so
// 150s tolerates one missed beat before allowing a handoff.
//
// Re-exported from lib/duration.ts rather than declared again: the same window
// decides when a session may be taken over here and when it stops accruing time
// there. Two copies of that number would eventually disagree, and the disagreement
// would show up as time appearing or vanishing at a handoff.
const STALE_SESSION_MS = STALE_GRACE_MS;

// How far back a client may claim its session started. The desktop app tracks
// offline-first, so a genuine claim can predate registration by however long the
// device was offline — but it must be bounded, or a client with a rewound clock
// can claim an arbitrarily old start and be credited the difference.
const MAX_BACKDATE_MS = 72 * 60 * 60 * 1000; // 72h

// Small tolerance for benign clock skew when a client claims a start slightly in
// the future. Anything beyond this is clamped to server "now".
const FUTURE_SKEW_TOLERANCE_MS = 2 * 60 * 1000; // 2min, matching the industry ±120s check

/**
 * Reconcile a client-claimed session start against the server clock.
 *
 * The server clock is authoritative: a claim is only honoured inside
 * [now - MAX_BACKDATE_MS, now + FUTURE_SKEW_TOLERANCE_MS], and a future-dated
 * claim is pulled back to `now` so that `endedAt - startedAt` can never be
 * negative. The raw claim and the measured skew are returned so callers can
 * record them — tampering is flagged for review, never silently dropped.
 */
export function reconcileStartedAt(
  claimedISO: string | undefined,
  now: Date = new Date()
): { startedAt: Date; claimedAt: Date | null; skewMs: number; clamped: boolean } {
  if (!claimedISO) return { startedAt: now, claimedAt: null, skewMs: 0, clamped: false };

  const claimed = new Date(claimedISO);
  if (Number.isNaN(claimed.getTime())) {
    return { startedAt: now, claimedAt: null, skewMs: 0, clamped: true };
  }

  const skewMs = claimed.getTime() - now.getTime();

  // Claimed in the future beyond tolerance → clamp to now (prevents negatives).
  if (skewMs > FUTURE_SKEW_TOLERANCE_MS) {
    return { startedAt: now, claimedAt: claimed, skewMs, clamped: true };
  }
  // Claimed further back than we allow → clamp to the backdate horizon.
  if (-skewMs > MAX_BACKDATE_MS) {
    return {
      startedAt: new Date(now.getTime() - MAX_BACKDATE_MS),
      claimedAt: claimed,
      skewMs,
      clamped: true,
    };
  }
  // Within tolerance but still slightly ahead → use now, so duration starts at 0.
  if (skewMs > 0) return { startedAt: now, claimedAt: claimed, skewMs, clamped: true };

  return { startedAt: claimed, claimedAt: claimed, skewMs, clamped: false };
}

const startSchema = z.object({
  // Client-generated id + startedAt: the desktop app tracks fully locally and
  // registers the session here when a connection is available (offline-first).
  // Both optional so older/online clients that let the server stamp still work.
  id: z.string().uuid().optional(),
  startedAt: z.string().datetime({ offset: true }).optional(),
  projectId: z.string().uuid(),
  taskId: z.string().uuid().optional(),
  deviceId: z.string().uuid().optional(),
  platform: z.string().optional(),
  appVersion: z.string().optional(),
});

const stopSchema = z.object({
  endReason: z.enum(["stopped", "idle_timeout", "abrupt_exit"]).default("stopped"),
  /**
   * Credit this session with nothing — close it at its own start instant.
   *
   * Sent when the desktop app finds an unfinished session from a previous run and
   * the member says the time wasn't theirs. A zero-duration row rather than a
   * delete: the session still happened, screenshots and activity blocks still hang
   * off it, and silently deleting tracked work is not something an endpoint should
   * do on a client's word.
   */
  discard: z.boolean().optional(),
});

const manualSchema = z.object({
  projectId: z.string().uuid(),
  taskId: z.string().uuid().optional(),
  startedAt: z.string().datetime({ offset: true }),
  endedAt: z.string().datetime({ offset: true }),
  manualReason: z.string().min(1),
  // Whose timesheet this lands on. Absent (the ordinary case) means the caller's
  // own. Only an owner/admin may name someone else — a member sending another
  // member's id is refused rather than quietly filed against themselves, since
  // silently ignoring it would leave them believing they logged the time.
  userId: z.string().uuid().optional(),
});

const listSchema = z.object({
  userId: z.string().uuid().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  scope: z.enum(["self", "team"]).optional(),
  approval: z.enum(APPROVAL_STATUSES).optional(),
});

const decisionSchema = z.object({
  // Required on a rejection, optional on an approval. Rejecting someone's hours
  // without saying why leaves them nothing to act on, and the reason is the part
  // that makes the decision reviewable later.
  note: z.string().min(1).max(500).optional(),
});

const noteSchema = z.object({
  body: z.string().min(1).max(500),
});

// Resolve (or lazily create) a device row for this user. The desktop app will
// pass a stable deviceId once it has one; the first call registers the device.
async function resolveDevice(
  userId: string,
  deviceId: string | undefined,
  platform: string | undefined,
  appVersion: string | undefined
) {
  if (deviceId) {
    const existing = await prisma.device.findUnique({ where: { id: deviceId } });
    if (existing) {
      if (existing.userId === userId) {
        await prisma.device.update({ where: { id: deviceId }, data: { lastSeenAt: new Date() } });
        return existing;
      }
      // id belongs to another user (shouldn't happen with uuids) — fall through
      // and mint a fresh one rather than colliding on the primary key.
    } else {
      // First sighting of this client-generated id: PERSIST IT. Without this the
      // lookup above never matches, a new Device row is created on every start,
      // and `sameDevice` in the open-session guard is always false — which made
      // switching projects fail with "already running on another device".
      return prisma.device.create({
        data: {
          id: deviceId,
          userId,
          platform: platform ?? "unknown",
          appVersion: appVersion ?? "0.0.0",
        },
      });
    }
  }
  return prisma.device.create({
    data: {
      userId,
      platform: platform ?? "unknown",
      appVersion: appVersion ?? "0.0.0",
    },
  });
}

async function assertProjectInOrg(projectId: string, orgId: string) {
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  return project && project.orgId === orgId ? project : null;
}

/**
 * The acting admin's own address.
 *
 * Read once per decision and stored on the row rather than joined at display
 * time — same reasoning as AuditLog's denormalised `actorEmail`: who signed off
 * a timesheet has to stay legible after that admin's account is gone, and a
 * relation would render it blank exactly when it matters most.
 */
async function actorEmail(userId: string): Promise<string | null> {
  return prisma.user
    .findUnique({ where: { id: userId }, select: { email: true } })
    .then((u) => u?.email ?? null)
    .catch(() => null);
}

/** "3h 30m" — the same compact shape the dashboard uses, for notification copy. */
function shortDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  return h === 0 ? `${m}m` : `${h}h ${m}m`;
}

/**
 * When the entry covers, spelled out for an email.
 *
 * Deliberately UTC and labelled as such: the server has no idea what timezone
 * the reader is in, and an unlabelled local-looking time in an approval request
 * is exactly the sort of ambiguity that gets the wrong hours signed off.
 */
function formatWhen(start: Date, end: Date): string {
  const day = start.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
  const time = (d: Date) =>
    d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
  const sameDay = start.toISOString().slice(0, 10) === end.toISOString().slice(0, 10);
  return sameDay
    ? `${day}, ${time(start)}–${time(end)} UTC`
    : `${day} ${time(start)} – ${end.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })} ${time(end)} UTC`;
}

/** The facts every manual-time notification and email is built from. */
function manualFacts(args: {
  memberLabel: string;
  projectName: string;
  taskTitle?: string | null;
  start: Date;
  end: Date;
  reason: string;
}): ManualEntryFacts {
  return {
    memberLabel: args.memberLabel,
    projectName: args.projectName,
    taskTitle: args.taskTitle ?? null,
    when: formatWhen(args.start, args.end),
    duration: shortDuration((args.end.getTime() - args.start.getTime()) / 1000),
    reason: args.reason,
  };
}

export default async function sessionRoutes(fastify: FastifyInstance) {
  fastify.addHook("preHandler", fastify.authenticate);

  // Start a tracking session. startedAt is stamped server-side (authoritative).
  fastify.post("/sessions/start", async (req, reply) => {
    const body = startSchema.parse(req.body);

    const project = await assertProjectInOrg(body.projectId, req.user.orgId);
    if (!project) return reply.code(404).send({ error: "Project not found" });

    // Idempotent registration: the offline-first client may retry registering the
    // same locally-created session id. If it already exists, just return it.
    if (body.id) {
      const existing = await prisma.trackingSession.findUnique({ where: { id: body.id } });
      if (existing) {
        if (existing.userId !== req.user.userId) return reply.code(404).send({ error: "Session not found" });
        return reply.send({ ...existing, deviceId: existing.deviceId });
      }
    }

    const device = await resolveDevice(req.user.userId, body.deviceId, body.platform, body.appVersion);

    // RECONCILIATION INVARIANT: a user may have at most one OPEN session at any
    // instant. But switching projects on the SAME device is not double-tracking —
    // only a *different* device with a live heartbeat is (the fraud case).
    const open = await prisma.trackingSession.findFirst({
      where: { userId: req.user.userId, endedAt: null },
      // Newest first: with more than one open row (which shouldn't happen, but
      // did), closing an arbitrary one leaves the others to keep accruing.
      orderBy: { startedAt: "desc" },
      include: {
        device: true,
        activityBlocks: { select: { blockEnd: true }, orderBy: { blockEnd: "desc" }, take: 1 },
      },
    });
    if (open) {
      const sameDevice = open.deviceId === device.id;
      const evidence = lastEvidenceAt(open);
      const isFresh = Date.now() - evidence.getTime() < STALE_SESSION_MS;
      if (!sameDevice && isFresh) {
        // A second live timer on another machine — reject.
        return reply.code(409).send({
          error:
            "A session is already running on another device. Stop it there before starting here.",
          sessionId: open.id,
        });
      }
      // Finalize at the last evidence this session was alive — NEVER at `now`.
      //
      // This branch used to read `sameDevice ? new Date() : device.lastSeenAt`,
      // which meant a session left open on Monday evening and resumed on the same
      // machine on Wednesday morning was credited every hour in between, including
      // two nights the computer was off. That is how a member who had tracked
      // seven minutes was shown 44h58m for the week.
      //
      // The reason is also chosen by evidence, not by device identity. A genuine
      // project switch has evidence seconds old and is a real `stopped`; anything
      // staler is an `abrupt_exit`, and labelling it `stopped` is precisely what
      // made a 39-hour outage indistinguishable from a 39-hour shift.
      await prisma.trackingSession.update({
        where: { id: open.id },
        data: {
          endedAt: evidence,
          endReason: isFresh ? "stopped" : "abrupt_exit",
        },
      });
    }

    // The client's startedAt is a *claim*, not authority. It's honoured only
    // within a bounded window around the server clock, so a rewound device
    // clock can't buy time. Large skew is logged for review.
    const { startedAt, skewMs, clamped } = reconcileStartedAt(body.startedAt);
    if (clamped) {
      req.log.warn(
        { userId: req.user.userId, deviceId: device.id, claimed: body.startedAt, skewMs },
        "session start clamped: client clock disagrees with server"
      );
    }

    const session = await prisma.trackingSession.create({
      data: {
        // Honor the client's id when provided (a session that began locally,
        // possibly offline). startedAt is always server-reconciled.
        ...(body.id ? { id: body.id } : {}),
        userId: req.user.userId,
        projectId: body.projectId,
        taskId: body.taskId,
        deviceId: device.id,
        startedAt,
      },
    });

    return reply.code(201).send({ ...session, deviceId: device.id });
  });

  // Stop the currently running session (or a specific one by id).
  fastify.post("/sessions/:id/stop", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = stopSchema.parse(req.body ?? {});

    const session = await prisma.trackingSession.findUnique({
      where: { id },
      include: {
        activityBlocks: { select: { blockEnd: true }, orderBy: { blockEnd: "desc" }, take: 1 },
        ...evidenceSelect,
      },
    });
    if (!session || session.userId !== req.user.userId) {
      return reply.code(404).send({ error: "Session not found" });
    }
    if (session.endedAt) {
      return reply.code(409).send({ error: "Session already stopped" });
    }

    // Finalize at the last instant we have evidence this session was alive —
    // NEVER unconditionally at `now`.
    //
    // For a session stopped normally this IS `now`: its heartbeat is seconds old,
    // so `effectiveEnd` returns the server clock and nothing changes. It only
    // differs for a session that stopped proving it existed — an app killed, a
    // machine shut down — where stamping `now` credits every hour in between. That
    // was the last route in the system able to mint hours out of an outage: the
    // desktop app posts a stop for an unfinished session it finds at startup, and
    // before this that post was worth 39 hours.
    //
    // `effectiveEnd` also floors at `startedAt`, which preserves the old guard
    // against a legacy row whose start is somehow ahead of the server clock.
    const now = new Date();
    const endedAt = body.discard ? session.startedAt : effectiveEnd(session, now);
    const updated = await prisma.trackingSession.update({
      where: { id },
      data: { endedAt, endReason: body.endReason },
    });
    return reply.send(updated);
  });

  // Heartbeat — keeps device presence fresh (drives "who's online").
  fastify.post("/sessions/:id/heartbeat", async (req, reply) => {
    const { id } = req.params as { id: string };
    const session = await prisma.trackingSession.findUnique({ where: { id } });
    if (!session || session.userId !== req.user.userId) {
      return reply.code(404).send({ error: "Session not found" });
    }
    await prisma.device.update({ where: { id: session.deviceId }, data: { lastSeenAt: new Date() } });
    return reply.send({ ok: true });
  });

  /**
   * Add a manual (not tracker-verified) time entry.
   *
   * Two callers, and the difference decides everything downstream:
   *
   *   - a member logging their own missed time → lands `pending`, and the admins
   *     who asked to hear about it are told;
   *   - an owner/admin entering time for someone else → lands `approved`, signed
   *     with their name, and the member is told it was added for them.
   *
   * An admin's own manual time takes the first path, not the second. They are
   * not a special case of "someone the tracker missed", and letting a role sign
   * off its own hours is precisely the hole this whole flow exists to close.
   */
  fastify.post("/sessions/manual", async (req, reply) => {
    const body = manualSchema.parse(req.body);

    const start = new Date(body.startedAt);
    const end = new Date(body.endedAt);
    if (end <= start) {
      return reply.code(400).send({ error: "End must be after start" });
    }

    const privileged = req.user.role === "owner" || req.user.role === "admin";
    const forSomeoneElse = Boolean(body.userId && body.userId !== req.user.userId);
    if (forSomeoneElse && !privileged) {
      return reply.code(403).send({ error: "Only an admin can add time for someone else" });
    }

    const targetId = body.userId ?? req.user.userId;
    const target = await prisma.user.findUnique({
      where: { id: targetId },
      select: { id: true, email: true, orgId: true, role: true, status: true, emailPrefs: true },
    });
    if (!target || target.orgId !== req.user.orgId) {
      return reply.code(404).send({ error: "Member not found" });
    }
    // A disabled or never-accepted account cannot track, so time filed against
    // it would be hours nobody can ever see or dispute on their own timesheet.
    if (forSomeoneElse && target.status !== "active") {
      return reply.code(400).send({ error: "That member's account isn't active" });
    }

    const project = await assertProjectInOrg(body.projectId, req.user.orgId);
    if (!project) return reply.code(404).send({ error: "Project not found" });

    // A task from another project would put the entry under a heading it does
    // not belong to, and every timesheet row renders project + task together.
    let task: { id: string; title: string } | null = null;
    if (body.taskId) {
      const found = await prisma.task.findUnique({
        where: { id: body.taskId },
        select: { id: true, title: true, projectId: true },
      });
      if (!found || found.projectId !== body.projectId) {
        return reply.code(404).send({ error: "Task not found on that project" });
      }
      task = { id: found.id, title: found.title };
    }

    // Prevent padding hours by adding a manual entry that overlaps time already
    // on THE TARGET'S timesheet (tracked or manual). Two intervals overlap when
    // existing.start < new.end AND existing.end > new.start. Open sessions count
    // as running "until now".
    //
    // Rejected entries are excluded: an admin who turned an entry down has said
    // those hours don't count, and leaving it as a blocker would make its own
    // rejection the reason a corrected re-submission can't be filed.
    const overlap = await prisma.trackingSession.findFirst({
      where: {
        userId: targetId,
        startedAt: { lt: end },
        OR: [{ endedAt: null }, { endedAt: { gt: start } }],
        AND: [{ OR: [{ approvalStatus: null }, { approvalStatus: { not: "rejected" } }] }],
      },
    });
    if (overlap) {
      return reply
        .code(409)
        .send({ error: "This time range overlaps an existing entry", sessionId: overlap.id });
    }

    const now = new Date();
    const addedBy = forSomeoneElse ? await actorEmail(req.user.userId) : null;
    const device = await resolveDevice(targetId, undefined, "manual", "0.0.0");
    const session = await prisma.trackingSession.create({
      data: {
        userId: targetId,
        projectId: body.projectId,
        taskId: body.taskId,
        deviceId: device.id,
        startedAt: start,
        endedAt: end,
        endReason: "stopped",
        isManual: true,
        manualReason: body.manualReason,
        approvalStatus: forSomeoneElse ? "approved" : "pending",
        ...(forSomeoneElse
          ? {
              decidedAt: now,
              decidedById: req.user.userId,
              decidedByEmail: addedBy,
              addedById: req.user.userId,
              addedByEmail: addedBy,
            }
          : {}),
      },
    });

    const facts = manualFacts({
      memberLabel: target.email,
      projectName: project.name,
      taskTitle: task?.title,
      start,
      end,
      reason: body.manualReason,
    });

    if (forSomeoneElse) {
      await auditLog({
        orgId: req.user.orgId,
        actorId: req.user.userId,
        action: "manual_time.added_for_member",
        targetId: target.id,
        targetLabel: target.email,
        details: { sessionId: session.id, duration: facts.duration, when: facts.when },
      });
      await notifyManualTimeAdded({
        orgId: req.user.orgId,
        member: { id: target.id, email: target.email, role: target.role, emailPrefs: target.emailPrefs },
        sessionId: session.id,
        addedBy: session.addedByEmail ?? "an admin",
        facts,
      });
    } else {
      await notifyManualTimeSubmitted({
        orgId: req.user.orgId,
        memberId: target.id,
        memberEmail: target.email,
        sessionId: session.id,
        submittedById: req.user.userId,
        facts,
      });
    }

    return reply.code(201).send(session);
  });

  /**
   * Approve or reject a manual entry.
   *
   * One handler for both, because everything except the stored word is shared —
   * and keeping them together is what stops the two paths drifting on who may
   * decide, what gets audited, and who gets told.
   *
   * A decision can be changed: an admin who approves the wrong row needs a way
   * back, and every decision is audited, so the trail shows the correction
   * rather than hiding it. What cannot change is that the hours themselves are
   * never edited or deleted here — a rejected entry stays on the timesheet,
   * visibly rejected, and simply stops counting.
   */
  for (const decision of ["approved", "rejected"] as const) {
    fastify.post(
      `/sessions/:id/${decision === "approved" ? "approve" : "reject"}`,
      { preHandler: [fastify.requireRole(["owner", "admin"])] },
      async (req, reply) => {
        const { id } = req.params as { id: string };
        const body = decisionSchema.parse(req.body ?? {});
        if (decision === "rejected" && !body.note) {
          return reply.code(400).send({ error: "A reason is required to reject an entry" });
        }

        const session = await prisma.trackingSession.findUnique({
          where: { id },
          include: {
            project: { select: { id: true, name: true, orgId: true } },
            task: { select: { id: true, title: true } },
            user: { select: { id: true, email: true, role: true, orgId: true, emailPrefs: true } },
          },
        });
        // Reached through the owner when there is one, and through the project
        // when the owner has been deleted — the same two doors org-wide reads
        // use everywhere else (lib/org-scope.ts).
        const inOrg =
          session &&
          (session.user ? session.user.orgId === req.user.orgId : session.project.orgId === req.user.orgId);
        if (!session || !inOrg) return reply.code(404).send({ error: "Session not found" });

        if (!session.isManual) {
          return reply
            .code(400)
            .send({ error: "Only manual entries are approved — the tracker witnessed this one" });
        }
        if (!canDecide(req.user, session)) {
          return reply
            .code(403)
            .send({ error: "You can't decide your own manual time — another admin has to review it" });
        }

        const email = await actorEmail(req.user.userId);
        const updated = await prisma.trackingSession.update({
          where: { id },
          data: {
            approvalStatus: decision,
            decidedAt: new Date(),
            decidedById: req.user.userId,
            decidedByEmail: email,
            decisionNote: body.note ?? null,
          },
        });

        const facts = manualFacts({
          memberLabel: session.user?.email ?? "Deleted user",
          projectName: session.project.name,
          taskTitle: session.task?.title,
          start: session.startedAt,
          end: session.endedAt ?? session.startedAt,
          reason: session.manualReason ?? "",
        });

        await auditLog({
          orgId: req.user.orgId,
          actorId: req.user.userId,
          action: `manual_time.${decision}`,
          targetId: session.userId,
          targetLabel: session.user?.email ?? null,
          details: {
            sessionId: session.id,
            duration: facts.duration,
            when: facts.when,
            note: body.note ?? null,
          },
        });

        await notifyManualTimeDecided({
          orgId: req.user.orgId,
          member: session.user
            ? {
                id: session.user.id,
                email: session.user.email,
                role: session.user.role,
                emailPrefs: session.user.emailPrefs,
              }
            : null,
          sessionId: session.id,
          decision,
          decidedBy: email ?? "an admin",
          note: body.note,
          facts,
        });

        return reply.send(updated);
      }
    );
  }

  // List sessions. Everyone defaults to seeing only their OWN sessions — this
  // backs ordinary "my work" surfaces (Dashboard, Timesheets) for every role,
  // admins included. A privileged caller can widen that deliberately, and only
  // deliberately: `?userId=` for one member, `?scope=team` for the whole org.
  // Without one of those, opening a page is never enough to be handed the org.
  //
  // `?approval=` narrows to entries in one state, which is what the admin
  // approvals queue asks for (`scope=team&approval=pending`).
  fastify.get("/sessions", async (req, reply) => {
    const q = listSchema.parse(req.query);

    const isPrivileged = req.user.role === "owner" || req.user.role === "admin";
    const where: Record<string, unknown> = {};
    const and: Record<string, unknown>[] = [];

    if (isPrivileged) {
      if (q.scope === "team" && !q.userId) {
        // Org-wide, orphans included: a session whose owner was hard-deleted
        // has userId IS NULL and reaches the org through its project instead
        // (lib/org-scope.ts). Filtering on `user: { orgId }` alone compiles to
        // an inner join and would drop that work from the team view.
        where.OR = orgScoped(req.user.orgId);
      } else {
        where.user = { orgId: req.user.orgId };
        where.userId = q.userId ?? req.user.userId;
      }
    } else {
      where.userId = req.user.userId;
      // A member may ask for `scope=team`; it simply does nothing for them.
    }

    if (q.approval) {
      // Only manual entries carry a status, and a stored null means "approved"
      // for the two cases in lib/approval.ts (tracked sessions, and manual rows
      // predating approvals) — so "approved" has to admit null too, or every
      // historic entry would vanish from the filter that claims to show it.
      and.push(
        q.approval === "approved"
          ? { isManual: true, OR: [{ approvalStatus: "approved" }, { approvalStatus: null }] }
          : { isManual: true, approvalStatus: q.approval }
      );
    }

    // By overlap, not by start instant — see overlapsRange in lib/duration.ts.
    // The desktop widget asks for `?from=<start of week>` and then attributes time
    // by overlap itself, so filtering on `startedAt` here silently withheld the
    // part of a Sunday-night session that belonged to Monday.
    and.push(
      ...overlapsRange(q.from ? new Date(q.from) : undefined, q.to ? new Date(q.to) : undefined)
    );
    if (and.length) where.AND = and;

    const sessions = await prisma.trackingSession.findMany({
      where,
      include: {
        project: { select: { id: true, name: true, clientTag: true } },
        task: { select: { id: true, title: true } },
        user: { select: { id: true, email: true } },
        notes: { select: { id: true, body: true, createdAt: true }, orderBy: { createdAt: "asc" } },
        idleDiscards: { select: { seconds: true, from: true, to: true } },
        // Evidence of life, for the derived fields below.
        activityBlocks: { select: { blockEnd: true }, orderBy: { blockEnd: "desc" }, take: 1 },
        ...evidenceSelect,
      },
      orderBy: { startedAt: "desc" },
      take: 500,
    });

    // Serve the durations rather than leaving every client to re-derive them.
    //
    // The web dashboard, the desktop widget and the mobile app each had their own
    // `endedAt ?? Date.now()`, so each one independently treated an abandoned
    // session as running and none of them could see IdleDiscard rows at all. The
    // server has the evidence; it should do the arithmetic once.
    //
    // `activityBlocks` and `device` are stripped from the response: they were loaded
    // to compute these fields, not to be sent.
    const now = new Date();
    return reply.send(
      sessions.map(({ activityBlocks, device, idleDiscards, ...s }) => ({
        ...s,
        /**
         * When this session effectively ended. Equals `endedAt` when closed; for an
         * open one it is `now` while it is still heartbeating, and its last evidence
         * of life once it isn't. Clients should measure against this, not `endedAt`.
         */
        effectiveEndAt: effectiveEnd({ ...s, activityBlocks, device }, now).toISOString(),
        /** Gross clock minus idle the member discarded — the canonical "worked". */
        workedSeconds: Math.round(workedSeconds({ ...s, activityBlocks, device, idleDiscards }, now)),
        /** True once this row stopped proving it was alive: open, but not tracking. */
        abandoned: !s.endedAt && effectiveEnd({ ...s, activityBlocks, device }, now) < now,
        /**
         * The deducted stretches, WITH their spans.
         *
         * Sent because a client splitting a session across days or hours has to know
         * *when* the deduction was, not just how big it was. A session running Monday
         * to Wednesday with a two-day hole in it must show the hole on Monday night
         * and Tuesday — not shave a proportional slice off Wednesday's real work.
         */
        idleSpans: idleDiscards
          .filter((d) => d.from && d.to)
          .map((d) => ({ from: d.from.toISOString(), to: d.to.toISOString(), seconds: d.seconds })),
        /**
         * The row's approval state as a client should read it, with the
         * null-means-approved rule already applied (lib/approval.ts).
         *
         * Sent alongside the raw `approvalStatus` rather than instead of it:
         * three clients would otherwise each re-derive "null means approved,
         * except when it doesn't", and the one that got it wrong would quietly
         * pay — or refuse to pay — for hours.
         */
        approvalState: effectiveStatus(s),
      }))
    );
  });

  // Attach a free-text note to a session (context for a tracked entry).
  fastify.post("/sessions/:id/notes", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = noteSchema.parse(req.body);

    const session = await prisma.trackingSession.findUnique({ where: { id } });
    if (!session || session.userId !== req.user.userId) {
      return reply.code(404).send({ error: "Session not found" });
    }

    const note = await prisma.timeNote.create({
      data: { sessionId: id, userId: req.user.userId, body: body.body },
      select: { id: true, body: true, createdAt: true },
    });
    return reply.code(201).send(note);
  });
}
