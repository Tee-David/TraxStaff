import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { GENESIS, verifyChain, type ChainBlock } from "../lib/hashchain";
import { detectAnomalies } from "../lib/anomaly";
import { auditLog } from "../lib/audit";

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
  // How long one input event kept counting as work when this block's
  // activityPct was measured. Absent from clients predating the change, which
  // reads as the original per-second sampling. Bounded so a modified client
  // cannot claim an implausible measurement; the value is a label on the
  // reading, not an input to it, so it is deliberately not in the hash chain.
  pauseDefinitionSecs: z.number().int().min(0).max(60).optional(),
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

/**
 * Whether the database actually has `ActivityBlock.pauseDefinitionSecs`.
 *
 * Same problem, and same treatment, as `hasWebsiteUsageColumn` in routes/orgs.ts:
 * code and migrations do not land at the same instant, and writing a column that
 * does not exist throws. Here the stakes are higher — this is the ingestion path,
 * so an unguarded write would turn one pending migration into every desktop
 * client failing to sync and queueing indefinitely. The stamp is a label on the
 * measurement; losing it is a footnote, losing sync is an outage.
 *
 * `true` is cached permanently (a column cannot go away); `false` is not, so the
 * first request after the migration lands starts recording it without a restart.
 */
let pauseColumnPresent = false;

async function hasPauseDefinitionColumn(): Promise<boolean> {
  if (pauseColumnPresent) return true;
  try {
    await prisma.$queryRaw`SELECT "pauseDefinitionSecs" FROM "ActivityBlock" LIMIT 1`;
    pauseColumnPresent = true;
  } catch {
    pauseColumnPresent = false;
  }
  return pauseColumnPresent;
}

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

/**
 * Load a session this caller is allowed to sync into, or null.
 *
 * A NULL `userId` is accepted. It means the member was hard-deleted while this
 * work was still queued on their machine, and the `nullable_user_fks` migration
 * exists precisely so their sessions, blocks and screenshots outlive the
 * account. Every route here used to test `session.userId !== req.user.userId`,
 * which is true for null, and returned 404 — and the desktop client maps 404 to
 * "this will never succeed, drop it", deleting the queued blocks AND their
 * screenshot files from disk.
 *
 * So three hours tracked offline on a flight, followed by the member being
 * removed from the org that afternoon, ended with the work destroyed by its own
 * tracker on reconnect: nothing on the server, nothing on the laptop. The exact
 * outcome the migration was written to prevent.
 *
 * Ownership is not weakened. An orphaned session is still reachable only by a
 * caller presenting a token minted for it, and it remains org-scoped through its
 * project for every read path.
 */
async function loadSyncableSession(sessionId: string, userId: string) {
  const session = await prisma.trackingSession.findUnique({ where: { id: sessionId } });
  if (!session) return null;
  if (session.userId !== null && session.userId !== userId) return null;
  return session;
}

export default async function syncRoutes(fastify: FastifyInstance) {
  fastify.addHook("preHandler", fastify.authenticate);

  // Ingest a batch of locally-queued activity blocks. Idempotent per
  // (sessionId, sequenceNo): replayed batches after a flaky connection are
  // safely skipped. Chain/sequence problems flag the session for review but
  // never block ingestion (avoids false-positive lockouts).
  fastify.post("/sync/activity", async (req, reply) => {
    const body = syncSchema.parse(req.body);

    const session = await loadSyncableSession(body.sessionId, req.user.userId);
    if (!session) {
      return reply.code(404).send({ error: "Session not found" });
    }

    // Ingest EVERY block in the batch. Blocks legitimately arrive out of order
    // in the offline-first model (a queued block flushes after later blocks
    // already synced inline), so we must never drop one for having a lower
    // sequenceNo than what's stored — that silently lost tracked time and then
    // wedged the client's queue. The unique (sessionId, sequenceNo) index plus
    // skipDuplicates makes this idempotent and order-independent.
    const withPauseColumn = await hasPauseDefinitionColumn();
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
        // Dropped rather than defaulted when the column is missing: a null means
        // "measured the old way", and inventing that for a block the client told
        // us was measured the new way would be a small lie in the audit trail.
        ...(withPauseColumn ? { pauseDefinitionSecs: b.pauseDefinitionSecs ?? null } : {}),
      })),
      skipDuplicates: true,
    });

    // Verify the WHOLE stored chain from genesis rather than just this batch, so
    // a gap filled later doesn't false-positive as tampering. canonical()
    // normalizes timestamps via new Date(...).toISOString(), so rebuilding the
    // chain input from stored rows reproduces the client's digest exactly.
    // Explicit select, deliberately. An unqualified `findMany` asks for every
    // column in schema.prisma, so the day a new column is added to the schema
    // this read starts demanding it from a database that does not have it yet —
    // and code and migrations never land at the same instant. That is not
    // hypothetical: adding `pauseDefinitionSecs` 500'd this route for every
    // client, and because a 5xx is retryable the queues wedged rather than
    // failing loudly. The write below is guarded by a column probe; the reads
    // must not need one.
    const stored = await prisma.activityBlock.findMany({
      where: { sessionId: body.sessionId },
      orderBy: { sequenceNo: "asc" },
      select: {
        sequenceNo: true,
        blockStart: true,
        blockEnd: true,
        keyboardPct: true,
        mousePct: true,
        activityPct: true,
        idleSeconds: true,
        prevHash: true,
        hash: true,
        creditedSeconds: true,
      },
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
    // Only ALTERATION is tampering. A sequence gap — and the chain break that
    // necessarily follows one — is the normal state of an offline-first client:
    // a queued block flushes after later blocks have already synced inline, so
    // the stored set legitimately has holes for seconds or hours at a time.
    // Treating that as tampering flagged an honest session for a 3-second
    // network blip, and because the flag was write-once-true it stayed flagged
    // forever, red badge and all, long after the missing block arrived.
    const tamper = chain.altered;
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
      // Gated on upsertFlag, like the anomaly loop below. `upsertFlag` dedupes
      // the flag row, but the notification did not: an offline client posts one
      // block per request, so a 4-hour backlog wrote one admin notification per
      // block for the same single condition.
      if (await upsertFlag(body.sessionId, "clock_skew_detected", { skewSeconds: skewed })) {
        await notifyOrg(session.userId, "unusual_activity", {
          sessionId: body.sessionId,
          type: "clock_skew_detected",
          skewSeconds: skewed,
        });
      }
    }

    // 2) Server-witnessed cap. Credited work can never exceed the time that has
    //    actually elapsed on OUR clock. This is the load-bearing control: it
    //    needs no trust in the client at all, because the client never sees or
    //    influences either endpoint.
    //
    //    Measured CUMULATIVELY, over the whole session since it started, rather
    //    than per-batch since the last contact. The per-batch form was broken in
    //    both directions:
    //
    //      - False positives, constantly. `lastSyncAt` is advanced on EVERY
    //        request (below), while the desktop posts one block per request. So
    //        an honest 4-hour offline day flushed 24 blocks, and from the second
    //        block onward the window was ~1.5 seconds against a 600-second
    //        claim. Twenty-three fraud flags for working on a plane.
    //      - And it was evadable. Splitting a claim across many small requests
    //        reset the window each time, which is precisely what an actual
    //        attacker would do.
    //
    //    Cumulative has neither problem: batching cannot change the total, and
    //    the denominator only ever grows with real elapsed time.
    const creditedOf = (b: { creditedSeconds: number | null; blockStart: Date; blockEnd: Date }) =>
      b.creditedSeconds ?? Math.max(0, (b.blockEnd.getTime() - b.blockStart.getTime()) / 1000);
    const claimedSeconds = stored.reduce((sum, b) => sum + creditedOf(b), 0);
    const elapsedServerSeconds = (Date.now() - session.startedAt.getTime()) / 1000;
    if (claimedSeconds > elapsedServerSeconds + CAP_TOLERANCE_SECONDS) {
      if (
        await upsertFlag(body.sessionId, "exceeds_elapsed_cap", {
          claimedSeconds: Math.round(claimedSeconds),
          elapsedServerSeconds: Math.round(elapsedServerSeconds),
        })
      ) {
        await notifyOrg(session.userId, "unusual_activity", {
          sessionId: body.sessionId,
          type: "exceeds_elapsed_cap",
          claimedSeconds: Math.round(claimedSeconds),
          elapsedServerSeconds: Math.round(elapsedServerSeconds),
        });
      }
    }

    // 3) Plausibility: blocks must fall inside the session's own window, and
    //    inside time that has actually happened.
    //
    //    The future check is the important one and it used to be dead code. It
    //    was written as `session.endedAt && blockStart > endedAt`, but blocks are
    //    only ever ingested while a session is OPEN, so `endedAt` was null and
    //    the branch never evaluated. Nothing else bounded `blockEnd`: it is
    //    inside the hash chain, so a modified client hashes a block ending next
    //    month and the chain verifies perfectly. That value then flowed into
    //    `lastEvidenceAt` and out through `endedAt` — one block, 720 hours,
    //    recorded as a clean "stopped". `lastEvidenceAt` now clamps to `now` as
    //    well; this flags the attempt rather than silently absorbing it.
    const nowMs = Date.now();
    const tolMs = CAP_TOLERANCE_SECONDS * 1000;
    const outOfWindow = body.blocks.filter((b) => {
      const startMs = new Date(b.blockStart).getTime();
      const endMs = new Date(b.blockEnd).getTime();
      return (
        endMs < session.startedAt.getTime() - tolMs ||
        endMs > nowMs + tolMs ||
        endMs < startMs ||
        (session.endedAt && startMs > session.endedAt.getTime() + tolMs)
      );
    });
    if (outOfWindow.length > 0) {
      await upsertFlag(body.sessionId, "block_outside_session_window", {
        count: outOfWindow.length,
        sequenceNos: outOfWindow.map((b) => b.sequenceNo),
      });
    }

    // Record this contact, and extend an end time we invented if the work turns
    // out to have continued past it.
    //
    // This is the other half of the stale-session fix. lib/stale-sessions.ts
    // has to guess, from silence, that a session is over — and silence is
    // ambiguous, because the tracker is offline-first and keeps recording
    // through an outage. Without this, that guess was final: the row was closed,
    // `effectiveEnd` treats a closed session as its own authority, and blocks
    // arriving afterwards were stored and then ignored by every total. Work that
    // demonstrably happened, with screenshots to prove it, reported as ten
    // minutes.
    //
    // Blocks are exactly the evidence needed to correct it. Only a session we
    // closed ourselves is eligible (`abrupt_exit`) — a member's real `stopped`
    // is their statement about their own day and is never overridden — and the
    // new end still comes from evidence, never from `now`.
    const latestBlockEnd = stored.reduce(
      (max, b) => Math.max(max, b.blockEnd.getTime()),
      0
    );
    const reopen =
      session.endedAt !== null &&
      session.endReason === "abrupt_exit" &&
      latestBlockEnd > session.endedAt.getTime() &&
      latestBlockEnd <= Date.now();

    await prisma.trackingSession.update({
      where: { id: body.sessionId },
      data: {
        lastSyncAt: new Date(),
        ...(reopen ? { endedAt: new Date(latestBlockEnd) } : {}),
      },
    });
    if (reopen) {
      req.log.info(
        {
          sessionId: body.sessionId,
          was: session.endedAt?.toISOString(),
          now: new Date(latestBlockEnd).toISOString(),
        },
        "extended an auto-closed session: work continued past the swept end time"
      );
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

    // Recomputed from the whole stored chain on every sync, and written in BOTH
    // directions. Previously this only ever set `true`, and nothing anywhere
    // cleared it — so a session flagged by a transient gap wore the red
    // "Flagged" badge and counted toward `flaggedSessions` permanently, with no
    // way back even once the chain was provably intact. A verdict that cannot be
    // revised by new evidence is not a verdict.
    //
    // Self-healing is safe: an altered block stays altered, so `chain.altered`
    // stays true for as long as the alteration is in the database.
    if (session.tamperSuspected !== tamper) {
      await prisma.trackingSession.update({
        where: { id: body.sessionId },
        data: { tamperSuspected: tamper },
      });
    }

    // Re-run anomaly detection over the full session and persist new flags.
    // Explicit select for the same reason as `stored` above — only the fields
    // detectAnomalies actually reads.
    const allBlocks = await prisma.activityBlock.findMany({
      where: { sessionId: body.sessionId },
      select: {
        activityPct: true,
        keyboardPct: true,
        mousePct: true,
        creditedSeconds: true,
        blockStart: true,
        blockEnd: true,
      },
    });
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
    const session = await loadSyncableSession(body.sessionId, req.user.userId);
    if (!session) {
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
    const session = await loadSyncableSession(body.sessionId, req.user.userId);
    if (!session) {
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
    const session = await loadSyncableSession(body.sessionId, req.user.userId);
    if (!session) {
      return reply.code(404).send({ error: "Session not found" });
    }
    const from = new Date(body.fromISO);
    const to = new Date(body.toISO);
    const seconds = Math.round((to.getTime() - from.getTime()) / 1000);
    if (seconds <= 0) {
      return reply.code(400).send({ error: "Discard window must be positive" });
    }
    // Idempotent on the exact span: the desktop app now writes the discard the
    // moment an away stretch ends, before the member has answered the keep/discard
    // prompt, and a retried request must not stack a second deduction for the same
    // minutes.
    const existing = await prisma.idleDiscard.findFirst({
      where: { sessionId: body.sessionId, from, to },
    });
    if (existing) return reply.send({ ok: true, seconds: existing.seconds, id: existing.id });

    const created = await prisma.idleDiscard.create({
      data: { sessionId: body.sessionId, from, to, seconds },
    });
    await auditLog({
      orgId: req.user.orgId,
      actorId: req.user.userId,
      action: "idle.discarded",
      targetId: body.sessionId,
      targetLabel: `${Math.round(seconds / 60)} min`,
      details: { seconds, from: body.fromISO, to: body.toISO },
    });
    return reply.send({ ok: true, seconds, id: created.id });
  });

  /**
   * Put a discarded idle span back — the member said "Keep" on the prompt.
   *
   * The desktop app deducts an away stretch as soon as the member returns, so the
   * clock they see is the work they actually did, and the deduction is written here
   * straight away so an admin looking at the dashboard in that moment sees the same
   * number. "Keep" therefore has to be an undo rather than a no-op, which is what
   * it used to be when nothing was written until they answered.
   *
   * Identified by the span rather than an id so the client doesn't have to hold one
   * across a restart: the span is what it already has from the prompt.
   */
  fastify.post("/sync/keep-idle", async (req, reply) => {
    const body = discardIdleSchema.parse(req.body);
    const session = await loadSyncableSession(body.sessionId, req.user.userId);
    if (!session) {
      return reply.code(404).send({ error: "Session not found" });
    }
    const from = new Date(body.fromISO);
    const to = new Date(body.toISO);
    const { count } = await prisma.idleDiscard.deleteMany({
      where: { sessionId: body.sessionId, from, to },
    });
    // Not found is a success: the discard may never have reached us (the client
    // writes it best-effort), and the member's intent is satisfied either way.
    if (count > 0) {
      await auditLog({
        orgId: req.user.orgId,
        actorId: req.user.userId,
        action: "idle.kept",
        targetId: body.sessionId,
        targetLabel: `${Math.round((to.getTime() - from.getTime()) / 60000)} min`,
        details: { from: body.fromISO, to: body.toISO },
      });
    }
    return reply.send({ ok: true, restored: count });
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

// `userId` is nullable because a session outlives the member who created it (see
// loadSyncableSession). There is nobody to notify about an orphaned session's
// activity, and no org to attribute it to, so this returns quietly rather than
// forcing every call site to narrow.
async function notifyOrg(userId: string | null, type: string, payload: Record<string, unknown>) {
  if (!userId) return;
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return;
  await prisma.notification.create({
    data: { orgId: user.orgId, userId, type, payload: { ...payload, memberEmail: user.email } },
  });
}
