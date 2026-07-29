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

const listQuery = z.object({
  sessionId: z.string().uuid().optional(),
  userId: z.string().uuid().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  // One screen of a ×6 grid is ~30 tiles; 48 gives a page of headroom without
  // presigning hundreds of URLs the viewer will never scroll to.
  limit: z.coerce.number().int().min(1).max(100).default(48),
  cursor: z.string().optional(),
});

/** Opaque keyset cursor: the (takenAt, id) of the last row of the previous page. */
function encodeCursor(takenAt: Date, id: string): string {
  return Buffer.from(`${takenAt.getTime()}_${id}`).toString("base64url");
}

function decodeCursor(raw?: string): { takenAt: Date; id: string } | null {
  if (!raw) return null;
  const [ms, id] = Buffer.from(raw, "base64url").toString("utf8").split("_");
  const t = Number(ms);
  // A malformed cursor means "start from the beginning" rather than a 500 —
  // stale links and truncated URLs shouldn't break the gallery.
  if (!id || !Number.isFinite(t)) return null;
  return { takenAt: new Date(t), id };
}

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
  //
  // Keyset ("cursor") paginated, newest first. The old implementation returned a
  // flat `take: 200` slice with no indication that anything had been cut off, so
  // a busy week silently disappeared and the client could only re-slice what it
  // had already been given. Presigning every URL is the expensive part of this
  // handler, so a real page boundary keeps that cost proportional to what the
  // viewport actually shows.
  //
  // `takenAt` is not unique (multi-monitor captures share a timestamp), so the
  // cursor is the (takenAt, id) pair and the comparison is lexicographic on that
  // pair — otherwise rows at a tie boundary get skipped or repeated.
  fastify.get("/screenshots", async (req, reply) => {
    const q = listQuery.parse(req.query);
    const privileged = req.user.role === "owner" || req.user.role === "admin";

    const sessionWhere: Record<string, unknown> = {};
    if (privileged) {
      sessionWhere.user = { orgId: req.user.orgId };
      if (q.userId) sessionWhere.userId = q.userId;
    } else {
      sessionWhere.userId = req.user.userId;
    }

    const and: Record<string, unknown>[] = [];
    if (q.from) and.push({ takenAt: { gte: new Date(q.from) } });
    if (q.to) and.push({ takenAt: { lte: new Date(q.to) } });

    const cursor = decodeCursor(q.cursor);
    if (cursor) {
      and.push({
        OR: [
          { takenAt: { lt: cursor.takenAt } },
          { takenAt: cursor.takenAt, id: { lt: cursor.id } },
        ],
      });
    }

    const where: Record<string, unknown> = {
      deletedAt: null,
      session: sessionWhere,
      ...(q.sessionId ? { sessionId: q.sessionId } : {}),
      ...(and.length ? { AND: and } : {}),
    };

    // Over-fetch by one to learn whether another page exists without a second
    // count query (the count would be the slower half of this endpoint).
    const rows = await prisma.screenshot.findMany({
      where,
      include: {
        session: { select: { id: true, user: { select: { email: true } }, project: { select: { name: true } } } },
        activityBlock: { select: { activityPct: true } },
      },
      orderBy: [{ takenAt: "desc" }, { id: "desc" }],
      take: q.limit + 1,
    });

    const hasMore = rows.length > q.limit;
    const shots = hasMore ? rows.slice(0, q.limit) : rows;

    // Only admins get a viewable URL.
    //
    // Enforced here rather than in the UI because a presigned URL IS the image:
    // once it is in the payload, a CSS blur or a hidden button is decoration —
    // the recipient can read it straight out of the network tab and open it. So
    // staff are simply never handed one.
    //
    // The rows themselves are still returned. Someone is entitled to know that a
    // screenshot of their screen exists, when it was taken and against which
    // project; withholding the list as well would make the capture covert, which
    // is the one thing this product does not do.
    const items = await Promise.all(
      shots.map(async (s) => ({
        id: s.id,
        takenAt: s.takenAt,
        monitorIndex: s.monitorIndex,
        blurred: s.blurred,
        activityPct: s.activityBlock.activityPct,
        member: s.session.user.email,
        project: s.session.project.name,
        url: privileged && r2Configured ? await presignGet(s.r2Key) : null,
        /** False for staff: the image is withheld, not merely obscured. */
        viewable: privileged,
      }))
    );

    const last = shots[shots.length - 1];
    return reply.send({
      items,
      nextCursor: hasMore && last ? encodeCursor(last.takenAt, last.id) : null,
    });
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
