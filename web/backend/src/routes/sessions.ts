import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma";

// A session whose device hasn't heartbeat within this window is considered
// dead and can be taken over by another device. Heartbeats are every 60s, so
// 150s tolerates one missed beat before allowing a handoff.
const STALE_SESSION_MS = 150_000;

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
});

const manualSchema = z.object({
  projectId: z.string().uuid(),
  taskId: z.string().uuid().optional(),
  startedAt: z.string().datetime({ offset: true }),
  endedAt: z.string().datetime({ offset: true }),
  manualReason: z.string().min(1),
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
      include: { device: true },
    });
    if (open) {
      const sameDevice = open.deviceId === device.id;
      const isFresh = Date.now() - open.device.lastSeenAt.getTime() < STALE_SESSION_MS;
      if (!sameDevice && isFresh) {
        // A second live timer on another machine — reject.
        return reply.code(409).send({
          error:
            "A session is already running on another device. Stop it there before starting here.",
          sessionId: open.id,
        });
      }
      // Same device switching projects (close cleanly), or a device that went
      // dark without stopping (finalize at its last heartbeat) — then take over.
      // Never finalize before the session started: a device that never got to
      // heartbeat has a lastSeenAt predating its own startedAt, which would
      // otherwise write a negative-duration session.
      const takeoverEnd = sameDevice ? new Date() : open.device.lastSeenAt;
      await prisma.trackingSession.update({
        where: { id: open.id },
        data: {
          endedAt: takeoverEnd < open.startedAt ? open.startedAt : takeoverEnd,
          endReason: sameDevice ? "stopped" : "abrupt_exit",
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

    const session = await prisma.trackingSession.findUnique({ where: { id } });
    if (!session || session.userId !== req.user.userId) {
      return reply.code(404).send({ error: "Session not found" });
    }
    if (session.endedAt) {
      return reply.code(409).send({ error: "Session already stopped" });
    }

    // Guard against a stored startedAt that is somehow ahead of server now
    // (legacy rows written before start reconciliation existed). Duration must
    // never be negative.
    const now = new Date();
    const updated = await prisma.trackingSession.update({
      where: { id },
      data: {
        endedAt: now < session.startedAt ? session.startedAt : now,
        endReason: body.endReason,
      },
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

  // Add a manual (not tracker-verified) time entry.
  fastify.post("/sessions/manual", async (req, reply) => {
    const body = manualSchema.parse(req.body);

    const start = new Date(body.startedAt);
    const end = new Date(body.endedAt);
    if (end <= start) {
      return reply.code(400).send({ error: "End must be after start" });
    }

    const project = await assertProjectInOrg(body.projectId, req.user.orgId);
    if (!project) return reply.code(404).send({ error: "Project not found" });

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

    if (q.from || q.to) {
      where.startedAt = {
        ...(q.from ? { gte: new Date(q.from) } : {}),
        ...(q.to ? { lte: new Date(q.to) } : {}),
      };
    }

    const sessions = await prisma.trackingSession.findMany({
      where,
      include: {
        project: { select: { id: true, name: true, clientTag: true } },
        task: { select: { id: true, title: true } },
        user: { select: { id: true, email: true } },
        notes: { select: { id: true, body: true, createdAt: true }, orderBy: { createdAt: "asc" } },
      },
      orderBy: { startedAt: "desc" },
      take: 500,
    });
    return reply.send(sessions);
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
