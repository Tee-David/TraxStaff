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
  // Monotonic timing, reported by the client's tamper-resistant clock. Optional
  // so older clients keep syncing; when absent we fall back to the wall-clock
  // span, which is what the pre-fix behaviour was.
  creditedSeconds: z.number().int().min(0).optional(),
  suspendedSeconds: z.number().int().min(0).optional(),
  clockSkewSeconds: z.number().int().optional(),
});

const syncSchema = z.object({
  sessionId: z.string().uuid(),
  blocks: z.array(blockSchema).min(1),
});

// How far the client's wall clock may drift from its own monotonic clock before
// we flag it. Generous on purpose: a genuine NTP step after a long offline
// period can be several seconds, and a small drift buys nothing anyway now that
// credited duration comes from the monotonic counter.
const CLOCK_SKEW_TOLERANCE_SECONDS = 120;

// Slack on the server-witnessed cap, covering request latency, block-boundary
// rounding and a cold-started backend.
const CAP_TOLERANCE_SECONDS = 300;

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
        creditedSeconds: b.creditedSeconds ?? null,
        suspendedSeconds: b.suspendedSeconds ?? null,
        clockSkewSeconds: b.clockSkewSeconds ?? null,
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

    // --- Clock-tamper reconciliation -------------------------------------
    // The client reports monotonic timing alongside each block. Two independent
    // checks, both flag-only — ingestion is never blocked, per the product rule
    // that tamper signals mark a session for review rather than dropping data.

    // 1) The client's own monotonic-vs-wall divergence. Non-zero means the
    //    system clock moved during the block. Sleep does NOT trigger this.
    const skewed = body.blocks
      .filter((b) => typeof b.clockSkewSeconds === "number")
      .reduce((worst, b) => {
        const s = Math.abs(b.clockSkewSeconds!);
        return s > Math.abs(worst) ? b.clockSkewSeconds! : worst;
      }, 0);
    if (Math.abs(skewed) > CLOCK_SKEW_TOLERANCE_SECONDS) {
      await upsertFlag(body.sessionId, "clock_skew_detected", { skewSeconds: skewed });
      await notifyOrg(session.userId, "unusual_activity", {
        sessionId: body.sessionId,
        type: "clock_skew_detected",
        skewSeconds: skewed,
      });
    }

    // 2) Server-witnessed cap. Credited time between two server contacts can
    //    never exceed the time that actually elapsed on OUR clock. This is the
    //    load-bearing control: it needs no trust in the client at all, because
    //    the client never sees or influences either endpoint.
    const claimedSeconds = body.blocks.reduce(
      (sum, b) =>
        sum +
        (typeof b.creditedSeconds === "number"
          ? b.creditedSeconds
          : Math.max(0, (new Date(b.blockEnd).getTime() - new Date(b.blockStart).getTime()) / 1000)),
      0
    );
    const lastContact = session.lastSyncAt ?? session.startedAt;
    const elapsedServerSeconds = (Date.now() - lastContact.getTime()) / 1000;
    if (claimedSeconds > elapsedServerSeconds + CAP_TOLERANCE_SECONDS) {
      await upsertFlag(body.sessionId, "exceeds_elapsed_cap", {
        claimedSeconds: Math.round(claimedSeconds),
        elapsedServerSeconds: Math.round(elapsedServerSeconds),
      });
      await notifyOrg(session.userId, "unusual_activity", {
        sessionId: body.sessionId,
        type: "exceeds_elapsed_cap",
        claimedSeconds: Math.round(claimedSeconds),
        elapsedServerSeconds: Math.round(elapsedServerSeconds),
      });
    }

    // 3) Plausibility: blocks must fall inside the session's own window.
    const outOfWindow = body.blocks.filter(
      (b) =>
        new Date(b.blockEnd).getTime() < session.startedAt.getTime() - CAP_TOLERANCE_SECONDS * 1000 ||
        (session.endedAt &&
          new Date(b.blockStart).getTime() > session.endedAt.getTime() + CAP_TOLERANCE_SECONDS * 1000)
    );
    if (outOfWindow.length > 0) {
      await upsertFlag(body.sessionId, "block_outside_session_window", {
        count: outOfWindow.length,
        sequenceNos: outOfWindow.map((b) => b.sequenceNo),
      });
    }

    // Record this contact so the next batch is capped against it.
    await prisma.trackingSession.update({
      where: { id: body.sessionId },
      data: { lastSyncAt: new Date() },
    });

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
