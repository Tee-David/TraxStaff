import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma";

// A session whose device hasn't heartbeat within this window is considered
// dead and can be taken over by another device. Heartbeats are every 60s, so
// 150s tolerates one missed beat before allowing a handoff.
const STALE_SESSION_MS = 150_000;

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
      await prisma.trackingSession.update({
        where: { id: open.id },
        data: {
          endedAt: sameDevice ? new Date() : open.device.lastSeenAt,
          endReason: sameDevice ? "stopped" : "abrupt_exit",
        },
      });
    }

    const session = await prisma.trackingSession.create({
      data: {
        // Honor the client's id + startedAt when provided (a session that began
        // locally, possibly offline); otherwise stamp server-side.
        ...(body.id ? { id: body.id } : {}),
        userId: req.user.userId,
        projectId: body.projectId,
        taskId: body.taskId,
        deviceId: device.id,
        startedAt: body.startedAt ? new Date(body.startedAt) : new Date(),
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

    const updated = await prisma.trackingSession.update({
      where: { id },
      data: { endedAt: new Date(), endReason: body.endReason },
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

  // List sessions. Members see only their own; admins/owners see the whole org.
  // Optional ?userId= and ?from=/?to= (ISO) filters.
  fastify.get("/sessions", async (req, reply) => {
    const q = req.query as { userId?: string; from?: string; to?: string };

    const isPrivileged = req.user.role === "owner" || req.user.role === "admin";
    const where: Record<string, unknown> = {};

    if (isPrivileged) {
      where.user = { orgId: req.user.orgId };
      if (q.userId) where.userId = q.userId;
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
