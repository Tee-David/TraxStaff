import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { GENESIS, verifyChain, type ChainBlock } from "../lib/hashchain";
import { detectAnomalies } from "../lib/anomaly";

const blockSchema = z.object({
  blockStart: z.string().datetime({ offset: true }),
  blockEnd: z.string().datetime({ offset: true }),
  keyboardPct: z.number().min(0).max(100),
  mousePct: z.number().min(0).max(100),
  activityPct: z.number().min(0).max(100),
  idleSeconds: z.number().int().min(0),
  sequenceNo: z.number().int().min(0),
  prevHash: z.string(),
  hash: z.string(),
  jigglerProcess: z.string().optional(), // client-detected blocklisted process
});

const syncSchema = z.object({
  sessionId: z.string().uuid(),
  blocks: z.array(blockSchema).min(1),
});

const appUsageSchema = z.object({
  sessionId: z.string().uuid(),
  blockStart: z.string().datetime({ offset: true }),
  apps: z.array(z.object({ appName: z.string().min(1), seconds: z.number().int().min(1) })).min(1),
});

const urlUsageSchema = z.object({
  sessionId: z.string().uuid(),
  blockStart: z.string().datetime({ offset: true }),
  urls: z.array(z.object({ domain: z.string().min(1), seconds: z.number().int().min(1) })).min(1),
});

const discardIdleSchema = z.object({
  sessionId: z.string().uuid(),
  fromISO: z.string().datetime({ offset: true }),
  toISO: z.string().datetime({ offset: true }),
});

export default async function syncRoutes(fastify: FastifyInstance) {
  fastify.addHook("preHandler", fastify.authenticate);

  // Ingest a batch of locally-queued activity blocks. Idempotent per
  // (sessionId, sequenceNo): replayed batches after a flaky connection are
  // safely skipped. Chain/sequence problems flag the session for review but
  // never block ingestion (avoids false-positive lockouts).
  fastify.post("/sync/activity", async (req, reply) => {
    const body = syncSchema.parse(req.body);

    const session = await prisma.trackingSession.findUnique({ where: { id: body.sessionId } });
    if (!session || session.userId !== req.user.userId) {
      return reply.code(404).send({ error: "Session not found" });
    }

    // Ingest EVERY block in the batch. Blocks legitimately arrive out of order
    // in the offline-first model (a queued block flushes after later blocks
    // already synced inline), so we must never drop one for having a lower
    // sequenceNo than what's stored — that silently lost tracked time and then
    // wedged the client's queue. The unique (sessionId, sequenceNo) index plus
    // skipDuplicates makes this idempotent and order-independent.
    await prisma.activityBlock.createMany({
      data: body.blocks.map((b) => ({
        sessionId: body.sessionId,
        blockStart: new Date(b.blockStart),
        blockEnd: new Date(b.blockEnd),
        keyboardPct: b.keyboardPct,
        mousePct: b.mousePct,
        activityPct: b.activityPct,
        idleSeconds: b.idleSeconds,
        sequenceNo: b.sequenceNo,
        prevHash: b.prevHash,
        hash: b.hash,
      })),
      skipDuplicates: true,
    });

    // Verify the WHOLE stored chain from genesis rather than just this batch, so
    // a gap filled later doesn't false-positive as tampering. canonical()
    // normalizes timestamps via new Date(...).toISOString(), so rebuilding the
    // chain input from stored rows reproduces the client's digest exactly.
    const stored = await prisma.activityBlock.findMany({
      where: { sessionId: body.sessionId },
      orderBy: { sequenceNo: "asc" },
    });
    const chainInput = stored.map((b) => ({
      sessionId: body.sessionId,
      sequenceNo: b.sequenceNo,
      blockStart: b.blockStart.toISOString(),
      blockEnd: b.blockEnd.toISOString(),
      keyboardPct: b.keyboardPct,
      mousePct: b.mousePct,
      activityPct: b.activityPct,
      idleSeconds: b.idleSeconds,
      prevHash: b.prevHash,
      hash: b.hash,
    })) as (ChainBlock & { prevHash: string; hash: string })[];
    const chain = verifyChain(chainInput, GENESIS, 0);
    const tamper = !chain.ok;
    const reasons: string[] = chain.reasons;
    const fresh = body.blocks;

    // Client-reported jiggler process → immediate flag.
    const jiggler = body.blocks.find((b) => b.jigglerProcess);
    if (jiggler) {
      await upsertFlag(body.sessionId, "jiggler_process_detected", { process: jiggler.jigglerProcess });
      await notifyOrg(session.userId, "unusual_activity", {
        sessionId: body.sessionId,
        type: "jiggler_process_detected",
        process: jiggler.jigglerProcess,
      });
    }

    if (tamper) {
      await prisma.trackingSession.update({
        where: { id: body.sessionId },
        data: { tamperSuspected: true },
      });
    }

    // Re-run anomaly detection over the full session and persist new flags.
    const allBlocks = await prisma.activityBlock.findMany({ where: { sessionId: body.sessionId } });
    const anomalies = detectAnomalies(allBlocks);
    for (const a of anomalies) {
      const created = await upsertFlag(body.sessionId, a.type, a.details);
      if (created) {
        await notifyOrg(session.userId, "unusual_activity", { sessionId: body.sessionId, type: a.type, ...a.details });
      }
    }

    return reply.send({
      ingested: fresh.length,
      tamperSuspected: tamper,
      reasons,
      flags: anomalies.map((a) => a.type),
    });
  });

  // Ingest per-app foreground seconds for a block (active-window sampling).
  fastify.post("/sync/app-usage", async (req, reply) => {
    const body = appUsageSchema.parse(req.body);
    const session = await prisma.trackingSession.findUnique({ where: { id: body.sessionId } });
    if (!session || session.userId !== req.user.userId) {
      return reply.code(404).send({ error: "Session not found" });
    }
    await prisma.appUsage.createMany({
      data: body.apps.map((a) => ({
        sessionId: body.sessionId,
        appName: a.appName,
        seconds: a.seconds,
        blockStart: new Date(body.blockStart),
      })),
      skipDuplicates: true,
    });
    return reply.send({ ingested: body.apps.length });
  });

  // Ingest per-domain foreground seconds for a block (browser URL sampling).
  fastify.post("/sync/url-usage", async (req, reply) => {
    const body = urlUsageSchema.parse(req.body);
    const session = await prisma.trackingSession.findUnique({ where: { id: body.sessionId } });
    if (!session || session.userId !== req.user.userId) {
      return reply.code(404).send({ error: "Session not found" });
    }
    await prisma.urlUsage.createMany({
      data: body.urls.map((u) => ({
        sessionId: body.sessionId,
        domain: u.domain,
        seconds: u.seconds,
        blockStart: new Date(body.blockStart),
      })),
      skipDuplicates: true,
    });
    return reply.send({ ingested: body.urls.length });
  });

  // Record a discarded idle span. Duration is trusted from the client-reported
  // window but stored so reports can subtract it from worked time. Never mutates
  // ActivityBlocks — this is a reversible accounting adjustment only.
  fastify.post("/sync/discard-idle", async (req, reply) => {
    const body = discardIdleSchema.parse(req.body);
    const session = await prisma.trackingSession.findUnique({ where: { id: body.sessionId } });
    if (!session || session.userId !== req.user.userId) {
      return reply.code(404).send({ error: "Session not found" });
    }
    const from = new Date(body.fromISO);
    const to = new Date(body.toISO);
    const seconds = Math.round((to.getTime() - from.getTime()) / 1000);
    if (seconds <= 0) {
      return reply.code(400).send({ error: "Discard window must be positive" });
    }
    await prisma.idleDiscard.create({ data: { sessionId: body.sessionId, from, to, seconds } });
    return reply.send({ ok: true, seconds });
  });
}

// Create a flag only if this session doesn't already have one of this type.
// Returns true if a new flag was created.
async function upsertFlag(sessionId: string, type: import("@prisma/client").FlagType, details: Record<string, unknown>) {
  const existing = await prisma.unusualActivityFlag.findFirst({ where: { sessionId, type } });
  if (existing) return false;
  await prisma.unusualActivityFlag.create({ data: { sessionId, type, details: details as Prisma.InputJsonValue } });
  return true;
}

async function notifyOrg(userId: string, type: string, payload: Record<string, unknown>) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return;
  await prisma.notification.create({
    data: { orgId: user.orgId, userId, type, payload: { ...payload, memberEmail: user.email } },
  });
}
