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

    // Establish the chain anchor from what's already stored.
    const last = await prisma.activityBlock.findFirst({
      where: { sessionId: body.sessionId },
      orderBy: { sequenceNo: "desc" },
    });
    const startingPrev = last?.hash ?? GENESIS;
    const startingSeq = last ? last.sequenceNo + 1 : 0;

    // Only consider blocks we haven't stored yet (idempotent replay).
    const fresh = body.blocks
      .filter((b) => b.sequenceNo >= startingSeq)
      .sort((a, b) => a.sequenceNo - b.sequenceNo);

    let tamper = false;
    const reasons: string[] = [];

    if (fresh.length > 0) {
      // sessionId lives at the batch level, but the hash canonical includes it —
      // inject it into each block so the server recomputes the same digest.
      const chainInput = fresh.map((b) => ({ ...b, sessionId: body.sessionId })) as (ChainBlock & {
        prevHash: string;
        hash: string;
      })[];
      const chain = verifyChain(chainInput, startingPrev, startingSeq);
      if (!chain.ok) {
        tamper = true;
        reasons.push(...chain.reasons);
      }

      await prisma.activityBlock.createMany({
        data: fresh.map((b) => ({
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
    }

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
    });
    return reply.send({ ingested: body.apps.length });
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
