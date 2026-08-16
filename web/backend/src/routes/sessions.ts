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
  manualReason: z.string().min(1).max(500),
});

/**
 * Bounds on a manual entry, which is the one route that writes hours on nothing
 * but the member's word.
 *
 * There were none. `POST /sessions/manual` validated only that the timestamps
 * parsed and that the end followed the start, so a single request claiming
 * 2020-01-01 to 2030-01-01 was accepted: one row worth 87,600 hours, no approval
 * step, straight into every report, the leaderboard and the CSV export.
 * `/sessions/start` has bounded its own claim to [now-72h, now+2min] all along;
 * this route simply never got the same treatment.
 */
const MANUAL_MAX_SECONDS = 24 * 3600;
const MANUAL_MAX_BACKDATE_MS = 90 * 86_400_000;
const MANUAL_MAX_FUTURE_MS = 60_000;

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

    // RECONCILIATION INVARIANT: a user may have at most one OPEN session at any
    // instant. But switching projects on the SAME device is not double-tracking —
    // only a *different* device with a live heartbeat is (the fraud case).
    //
    // Read BEFORE resolveDevice(), which stamps `lastSeenAt = now` on the device
    // row. When the open session belongs to the same device — the ordinary
    // desktop case — that write landed first and the evidence read below saw its
    // own timestamp, so `isFresh` was unconditionally true and every abandoned
    // session was closed at `now` and labelled a clean `stopped`. That is the
    // bug the comment further down says was removed; it had been reintroduced by
    // ordering alone.
    const open = await prisma.trackingSession.findFirst({
      where: { userId: req.user.userId, endedAt: null },
      // Newest first: with more than one open row (which shouldn't happen, but
      // did), closing an arbitrary one leaves the others to keep accruing.
      orderBy: { startedAt: "desc" },
      include: {
        activityBlocks: { select: { blockEnd: true }, orderBy: { blockEnd: "desc" }, take: 1 },
      },
    });

    const device = await resolveDevice(req.user.userId, body.deviceId, body.platform, body.appVersion);
    if (open) {
      const sameDevice = open.deviceId === device.id;
      const now = new Date();
      const evidence = lastEvidenceAt(open, now);
      const isFresh = now.getTime() - evidence.getTime() < STALE_SESSION_MS;
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
    // A session WE closed can still be stopped by the client that owns it.
    //
    // The sweeper closes on silence, and silence is ambiguous: the tracker is
    // offline-first and keeps recording through an outage. When it comes back
    // and posts the stop it has been holding, a flat 409 meant the member's real
    // end time was refused and the swept guess stood — the row stayed at the
    // moment the network dropped, and the rest of the shift was gone.
    //
    // Only our own `abrupt_exit` is eligible, and the new end still comes from
    // evidence via `effectiveEnd`, so this cannot extend a session past what it
    // can prove. A genuine `stopped` is the member's own statement and stays 409.
    if (session.endedAt && session.endReason !== "abrupt_exit") {
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
    // Recomputed as though the session were open. `effectiveEnd` treats a closed
    // session as its own authority and returns `endedAt` unchanged — correct for
    // a real end time, wrong for one the sweeper guessed, which is exactly what
    // we are here to revise. Taking the later of the two means this can only
    // ever restore time, never take any away.
    const swept = session.endedAt;
    const fromEvidence = effectiveEnd({ ...session, endedAt: null }, now);
    const endedAt = body.discard
      ? session.startedAt
      : swept
        ? new Date(Math.max(fromEvidence.getTime(), swept.getTime()))
        : fromEvidence;

    const updated = await prisma.trackingSession.update({
      where: { id },
      data: { endedAt, endReason: body.endReason },
    });
    if (swept && endedAt.getTime() > swept.getTime()) {
      req.log.info(
        { sessionId: id, was: swept.toISOString(), now: endedAt.toISOString() },
        "restored time on an auto-closed session: the client posted its real stop"
      );
    }
    return reply.send(updated);
  });

  // Heartbeat — keeps device presence fresh (drives "who's online") AND records
  // that this specific session is still alive.
  fastify.post("/sessions/:id/heartbeat", async (req, reply) => {
    const { id } = req.params as { id: string };
    const session = await prisma.trackingSession.findUnique({ where: { id } });
    if (!session || session.userId !== req.user.userId) {
      return reply.code(404).send({ error: "Session not found" });
    }
    const now = new Date();
    await prisma.device.update({ where: { id: session.deviceId }, data: { lastSeenAt: now } });

    // Stamp the session too. Presence and evidence-of-life are different
    // questions and this route used to answer only the first: `Device` is shared
    // by every session that machine has ever run, so the beat could not say
    // WHICH session was alive. lib/duration.ts consequently read one live
    // session's heartbeat as proof that an older, dead row on the same device
    // was also still running — making it unsweepable and unbounded.
    //
    // Guarded on `endedAt: null` so a late beat from a client that has not yet
    // noticed it was stopped cannot reopen a closed session or move its end.
    await prisma.trackingSession.updateMany({
      where: { id, endedAt: null },
      data: { lastSyncAt: now },
    });
    return reply.send({ ok: true });
  });

  // Add a manual (not tracker-verified) time entry.
  fastify.post("/sessions/manual", async (req, reply) => {
    const body = manualSchema.parse(req.body);

    const start = new Date(body.startedAt);
    const end = new Date(body.endedAt);
    if (end <= start) {
      return reply.code(400).send({ error: "End must be after start" });
    }

    const nowMs = Date.now();
    if ((end.getTime() - start.getTime()) / 1000 > MANUAL_MAX_SECONDS) {
      return reply.code(400).send({ error: "A manual entry cannot be longer than 24 hours" });
    }
    if (end.getTime() > nowMs + MANUAL_MAX_FUTURE_MS) {
      return reply.code(400).send({ error: "A manual entry cannot be in the future" });
    }
    if (start.getTime() < nowMs - MANUAL_MAX_BACKDATE_MS) {
      return reply.code(400).send({ error: "A manual entry cannot be backdated more than 90 days" });
    }

    const project = await assertProjectInOrg(body.projectId, req.user.orgId);
    if (!project) return reply.code(404).send({ error: "Project not found" });

    // Membership, not just org. `ProjectMember` exists to scope which projects a
    // member can see; without this check any member could log time against any
    // project UUID in the org, including one they have no access to. Projects
    // with no members are open to the org, which is the existing convention.
    const memberships = await prisma.projectMember.count({ where: { projectId: project.id } });
    if (memberships > 0) {
      const mine = await prisma.projectMember.count({
        where: { projectId: project.id, userId: req.user.userId },
      });
      if (mine === 0) return reply.code(403).send({ error: "You are not a member of this project" });
    }

    // Prevent padding hours by adding a manual entry that overlaps time the user
    // has already tracked (or another manual entry). Two intervals overlap when
    // existing.start < new.end AND existing.end > new.start. Open sessions count
    // as running "until now".
    const overlap = await prisma.trackingSession.findFirst({
      where: {
        userId: req.user.userId,
        startedAt: { lt: end },
        OR: [{ endedAt: null }, { endedAt: { gt: start } }],
      },
    });
    if (overlap) {
      return reply
        .code(409)
        .send({ error: "This time range overlaps an existing entry", sessionId: overlap.id });
    }

    const device = await resolveDevice(req.user.userId, undefined, "manual", "0.0.0");
    const session = await prisma.trackingSession.create({
      data: {
        userId: req.user.userId,
        projectId: body.projectId,
        taskId: body.taskId,
        deviceId: device.id,
        startedAt: new Date(body.startedAt),
        endedAt: new Date(body.endedAt),
        endReason: "stopped",
        isManual: true,
        manualReason: body.manualReason,
      },
    });
    return reply.code(201).send(session);
  });

  // List sessions. Everyone defaults to seeing only their OWN sessions — this
  // backs ordinary "my work" surfaces (Dashboard, Timesheets) for every role,
  // admins included. An admin/owner may explicitly look up one other member
  // via ?userId=, which is how Timesheets' own-org drill-down would work if
  // ever wired up; without it, a privileged caller is never handed the whole
  // org by default just for opening their own page.
  fastify.get("/sessions", async (req, reply) => {
    const q = req.query as { userId?: string; from?: string; to?: string };

    const isPrivileged = req.user.role === "owner" || req.user.role === "admin";
    const where: Record<string, unknown> = {};

    if (isPrivileged) {
      where.user = { orgId: req.user.orgId };
      where.userId = q.userId ?? req.user.userId;
    } else {
      where.userId = req.user.userId;
    }

    // By overlap, not by start instant — see overlapsRange in lib/duration.ts.
    // The desktop widget asks for `?from=<start of week>` and then attributes time
    // by overlap itself, so filtering on `startedAt` here silently withheld the
    // part of a Sunday-night session that belonged to Monday.
    const range = overlapsRange(
      q.from ? new Date(q.from) : undefined,
      q.to ? new Date(q.to) : undefined
    );
    if (range.length) where.AND = range;

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
    // `activityBlocks` is stripped from the response: it was loaded to compute
    // these fields, not to be sent.
    const now = new Date();
    return reply.send(
      sessions.map(({ activityBlocks, idleDiscards, ...s }) => ({
        ...s,
        /**
         * When this session effectively ended. Equals `endedAt` when closed; for an
         * open one it is `now` while it is still heartbeating, and its last evidence
         * of life once it isn't. Clients should measure against this, not `endedAt`.
         */
        effectiveEndAt: effectiveEnd({ ...s, activityBlocks }, now).toISOString(),
        /** Gross clock minus idle the member discarded — the canonical "worked". */
        workedSeconds: Math.round(workedSeconds({ ...s, activityBlocks, idleDiscards }, now)),
        /** True once this row stopped proving it was alive: open, but not tracking. */
        abandoned: !s.endedAt && effectiveEnd({ ...s, activityBlocks }, now) < now,
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
