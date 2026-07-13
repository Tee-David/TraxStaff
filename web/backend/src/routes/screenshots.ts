import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { presignPut, presignGet, deleteObject, r2Configured } from "../lib/r2";

const presignSchema = z.object({
  sessionId: z.string().uuid(),
  monitorIndex: z.number().int().min(0),
  takenAt: z.string().datetime({ offset: true }),
});

const confirmSchema = z.object({
  sessionId: z.string().uuid(),
  // The client identifies the owning block by its sequence number (block IDs
  // are server-generated). Sync the activity block before confirming its shots.
  sequenceNo: z.number().int().min(0),
  r2Key: z.string().min(1),
  monitorIndex: z.number().int().min(0),
  takenAt: z.string().datetime({ offset: true }),
  blurred: z.boolean().optional(),
});

export default async function screenshotRoutes(fastify: FastifyInstance) {
  fastify.addHook("preHandler", fastify.authenticate);

  async function ownsSession(sessionId: string, userId: string) {
    const s = await prisma.trackingSession.findUnique({ where: { id: sessionId } });
    return s && s.userId === userId ? s : null;
  }

  // 1) Client asks for a presigned PUT URL for one screenshot.
  fastify.post("/screenshots/presign", async (req, reply) => {
    if (!r2Configured) return reply.code(503).send({ error: "Screenshot storage not configured" });
    const body = presignSchema.parse(req.body);
    if (!(await ownsSession(body.sessionId, req.user.userId))) {
      return reply.code(404).send({ error: "Session not found" });
    }
    const key = `${req.user.orgId}/${body.sessionId}/${Date.parse(body.takenAt)}-m${body.monitorIndex}.webp`;
    const uploadUrl = await presignPut(key);
    return reply.send({ uploadUrl, r2Key: key });
  });

  // 2) After uploading to R2, client confirms → we store metadata.
  fastify.post("/screenshots/confirm", async (req, reply) => {
    const body = confirmSchema.parse(req.body);
    if (!(await ownsSession(body.sessionId, req.user.userId))) {
      return reply.code(404).send({ error: "Session not found" });
    }
    const block = await prisma.activityBlock.findUnique({
      where: { sessionId_sequenceNo: { sessionId: body.sessionId, sequenceNo: body.sequenceNo } },
    });
    if (!block) {
      return reply.code(404).send({ error: "Activity block not found — sync it before confirming screenshots" });
    }
    const shot = await prisma.screenshot.create({
      data: {
        sessionId: body.sessionId,
        activityBlockId: block.id,
        r2Key: body.r2Key,
        monitorIndex: body.monitorIndex,
        takenAt: new Date(body.takenAt),
        blurred: body.blurred ?? false,
      },
    });
    return reply.code(201).send(shot);
  });

  // 3) List screenshots (with short-lived view URLs). Members see own; admins all.
  fastify.get("/screenshots", async (req, reply) => {
    const q = req.query as { sessionId?: string; userId?: string; from?: string; to?: string };
    const privileged = req.user.role === "owner" || req.user.role === "admin";
    const where: Record<string, unknown> = { deletedAt: null };
    const sessionWhere: Record<string, unknown> = {};
    if (privileged) {
      sessionWhere.user = { orgId: req.user.orgId };
      if (q.userId) sessionWhere.userId = q.userId;
    } else {
      sessionWhere.userId = req.user.userId;
    }
    if (q.sessionId) where.sessionId = q.sessionId;
    if (q.from || q.to) {
      where.takenAt = {
        ...(q.from ? { gte: new Date(q.from) } : {}),
        ...(q.to ? { lte: new Date(q.to) } : {}),
      };
    }
    where.session = sessionWhere;

    const shots = await prisma.screenshot.findMany({
      where,
      include: {
        session: { select: { id: true, user: { select: { email: true } }, project: { select: { name: true } } } },
        activityBlock: { select: { activityPct: true } },
      },
      orderBy: { takenAt: "desc" },
      take: 200,
    });

    const withUrls = await Promise.all(
      shots.map(async (s) => ({
        id: s.id,
        takenAt: s.takenAt,
        monitorIndex: s.monitorIndex,
        blurred: s.blurred,
        activityPct: s.activityBlock.activityPct,
        member: s.session.user.email,
        project: s.session.project.name,
        url: r2Configured ? await presignGet(s.r2Key) : null,
      }))
    );
    return reply.send(withUrls);
  });

  // 4) Delete (soft) — only owner/admin per policy.
  fastify.delete("/screenshots/:id", async (req, reply) => {
    if (req.user.role !== "owner" && req.user.role !== "admin") {
      return reply.code(403).send({ error: "Only admins can delete screenshots" });
    }
    const { id } = req.params as { id: string };
    const shot = await prisma.screenshot.findUnique({
      where: { id },
      include: { session: { select: { user: { select: { orgId: true } } } } },
    });
    if (!shot || shot.session.user.orgId !== req.user.orgId) {
      return reply.code(404).send({ error: "Not found" });
    }
    await deleteObject(shot.r2Key).catch(() => {});
    await prisma.screenshot.update({
      where: { id },
      data: { deletedAt: new Date(), deletedById: req.user.userId },
    });
    return reply.send({ ok: true });
  });
}
