/**
 * Platform operations — the surgical and reversible half of `/admin/*`.
 *
 * Split from routes/superadmin.ts, which had grown past 1,400 lines, along a
 * real seam rather than an arbitrary one: that module is CRUD over orgs, users
 * and hours, while this one is the tools for putting things right — trimming a
 * session the tracker got wrong, undoing a destructive write, freezing an org
 * instead of deleting it, and reading the trail of what platform staff did.
 *
 * Same guard, same prefix. `fastify.requireSuperAdmin` authenticates and
 * re-reads the flag from the database on every call; see plugins/auth.ts.
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { effectiveEnd, workedSeconds } from "../lib/duration";
import {
  MAX_DAYS_PER_REQUEST,
  formatTimeOfDay,
  planBackfill,
  rechainActivity,
  replanActivity,
  type PlannedDay,
} from "../lib/backfill";
import { addDays, localDayKey, localDayStartMs } from "../lib/digests";
import { loadPattern, orgTimezone, resolveRange } from "./superadmin";
import {
  captureSessions,
  platformLog,
  restoreSnapshot,
  saveSnapshot,
  type SnapshotPayload,
} from "../lib/platform-log";

const dateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");

export default async function superAdminOpsRoutes(fastify: FastifyInstance) {
  fastify.addHook("preHandler", fastify.requireSuperAdmin);

  // ─── Session surgery ──────────────────────────────────────────────────────

  /**
   * Move a session's start or end — the tool for a machine left running.
   *
   * The case this exists for: a tracked session that ran 12:23 one afternoon to
   * 05:01 the next morning is not a sixteen-hour shift, it is a laptop nobody
   * closed. Deleting it loses the real work at the front; leaving it credits the
   * night. Trimming is the only honest answer, and until now there was no way to
   * do it.
   *
   * Blocks outside the new span go, and the screenshots hanging off those blocks
   * go with them — `Screenshot.activityBlockId` is a required foreign key, so
   * there is no keeping one without the other. Everything removed is snapshotted
   * first, so `POST /admin/undo/:id` can put it back.
   *
   * Unlike the activity rewrite, this deliberately DOES accept captured
   * sessions: correcting a span the tracker got wrong is the entire purpose.
   */
  fastify.patch("/admin/sessions/:id/span", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = z
      .object({
        startedAt: z.string().datetime({ offset: true }).optional(),
        endedAt: z.string().datetime({ offset: true }).optional(),
        reason: z.string().trim().min(1).max(500),
        dryRun: z.boolean().default(false),
      })
      .refine((b) => b.startedAt || b.endedAt, {
        message: "Provide startedAt, endedAt, or both",
      })
      .parse(req.body);

    const session = await prisma.trackingSession.findUnique({
      where: { id },
      include: {
        user: { select: { id: true, email: true, orgId: true } },
        activityBlocks: { select: { id: true, blockStart: true, blockEnd: true } },
      },
    });
    if (!session) return reply.code(404).send({ error: "Session not found" });

    const startedAt = body.startedAt ? new Date(body.startedAt) : session.startedAt;
    const endedAt = body.endedAt
      ? new Date(body.endedAt)
      : session.endedAt ?? effectiveEnd(session);

    if (endedAt.getTime() <= startedAt.getTime()) {
      return reply.code(400).send({ error: "End must be after start" });
    }
    if (endedAt.getTime() > Date.now() + 60_000) {
      return reply.code(400).send({ error: "A session cannot end in the future" });
    }

    // A block survives only if it lies WHOLLY inside the new span. A block that
    // straddles the cut cannot be kept as-is (it would claim time outside the
    // session) and cannot be shortened either, because its span is inside the
    // hash — see the note on activityPct in schema.prisma. So it goes.
    const doomed = session.activityBlocks.filter(
      (b) => b.blockStart < startedAt || b.blockEnd > endedAt
    );
    const doomedIds = doomed.map((b) => b.id);
    const shotCount = doomedIds.length
      ? await prisma.screenshot.count({ where: { activityBlockId: { in: doomedIds } } })
      : 0;

    const summary = {
      sessionId: id,
      user: session.user,
      before: {
        startedAt: session.startedAt,
        endedAt: session.endedAt,
        seconds: Math.round(workedSeconds(session)),
      },
      after: {
        startedAt,
        endedAt,
        seconds: Math.round((endedAt.getTime() - startedAt.getTime()) / 1000),
      },
      isManual: session.isManual,
      blocksRemoved: doomed.length,
      blocksKept: session.activityBlocks.length - doomed.length,
      screenshotsRemoved: shotCount,
    };

    if (body.dryRun) return reply.send({ ...summary, dryRun: true, applied: false });

    // Snapshot the WHOLE session, not just the doomed rows: undoing a trim means
    // restoring the original span, and that lives on the session row itself.
    const snapshot = await saveSnapshot({
      actorId: req.user.userId,
      kind: "session.trim",
      userId: session.userId,
      orgId: session.user?.orgId ?? null,
      payload: await captureSessions([id]),
    });
    if (!snapshot) {
      return reply.code(503).send({
        error:
          "Could not store an undo snapshot, so nothing was changed. Check that PlatformSnapshot exists.",
      });
    }

    await prisma.$transaction([
      ...(doomedIds.length
        ? [
            prisma.screenshot.deleteMany({ where: { activityBlockId: { in: doomedIds } } }),
            prisma.activityBlock.deleteMany({ where: { id: { in: doomedIds } } }),
          ]
        : []),
      prisma.trackingSession.update({
        where: { id },
        data: { startedAt, endedAt, endReason: "stopped" },
      }),
    ]);

    await platformLog({
      actorId: req.user.userId,
      action: "session.trimmed",
      orgId: session.user?.orgId ?? null,
      details: { ...summary, reason: body.reason, snapshotId: snapshot.id },
    });

    return reply.send({ ...summary, applied: true, snapshotId: snapshot.id });
  });

  // ─── Undo ─────────────────────────────────────────────────────────────────

  /** Snapshots still available to restore, newest first. */
  fastify.get("/admin/snapshots", async (req, reply) => {
    const q = req.query as { userId?: string; limit?: string };
    const rows = await prisma.platformSnapshot.findMany({
      where: {
        ...(q.userId ? { userId: q.userId } : {}),
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: "desc" },
      take: Math.min(Number(q.limit) || 50, 200),
      select: {
        id: true,
        kind: true,
        userId: true,
        orgId: true,
        restoredAt: true,
        expiresAt: true,
        createdAt: true,
        payload: true,
      },
    });

    return reply.send(
      rows.map((r) => {
        const p = r.payload as unknown as SnapshotPayload;
        return {
          id: r.id,
          kind: r.kind,
          userId: r.userId,
          orgId: r.orgId,
          restoredAt: r.restoredAt,
          expiresAt: r.expiresAt,
          createdAt: r.createdAt,
          // Counts rather than the rows themselves: a week's snapshot is
          // thousands of blocks and nobody is reading them in a list.
          counts: {
            sessions: p?.sessions?.length ?? 0,
            activityBlocks: p?.activityBlocks?.length ?? 0,
            screenshots: p?.screenshots?.length ?? 0,
          },
        };
      })
    );
  });

  /**
   * Put back what a destructive platform action removed.
   *
   * Genuinely possible because the images were never deleted — see the docblock
   * on lib/platform-log.ts. Restores are `skipDuplicates`, so re-running one is
   * a no-op rather than a unique-key error, and `restoredAt` marks a snapshot as
   * spent so the UI can stop offering it.
   */
  fastify.post("/admin/undo/:id", async (req, reply) => {
    // Validated rather than passed straight through. `id` lands in a uuid
    // column, and Prisma answers a malformed one with a 500 whose message is a
    // driver-level complaint about UUID parsing — which is what a caller got
    // for the entirely ordinary mistake of a missing id in the path.
    const parsed = z.string().uuid().safeParse((req.params as { id: string }).id);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid snapshot id" });
    const id = parsed.data;

    const snap = await prisma.platformSnapshot.findUnique({ where: { id } });
    if (!snap) return reply.code(404).send({ error: "Snapshot not found" });
    if (snap.restoredAt) {
      return reply.code(409).send({
        error: "That snapshot has already been restored",
        restoredAt: snap.restoredAt,
      });
    }

    const payload = snap.payload as unknown as SnapshotPayload;
    if (!payload?.sessions) {
      return reply.code(400).send({ error: "That snapshot has no restorable content" });
    }

    // A trim MODIFIED the session rather than deleting it, so the row still
    // exists and `skipDuplicates` would leave the trimmed span in place. Delete
    // the current rows for those ids first, then write the originals back.
    if (snap.kind === "session.trim") {
      const ids = payload.sessions.map((s) => String(s.id));
      await prisma.$transaction([
        prisma.screenshot.deleteMany({ where: { sessionId: { in: ids } } }),
        prisma.activityBlock.deleteMany({ where: { sessionId: { in: ids } } }),
        prisma.trackingSession.deleteMany({ where: { id: { in: ids } } }),
      ]);
    }

    const result = await restoreSnapshot(payload);

    await prisma.platformSnapshot.update({
      where: { id },
      data: { restoredAt: new Date() },
    });

    await platformLog({
      actorId: req.user.userId,
      action: "snapshot.restored",
      orgId: snap.orgId,
      details: { snapshotId: id, kind: snap.kind, ...result },
    });

    return reply.send({ ok: true, snapshotId: id, kind: snap.kind, ...result });
  });

  // ─── Org suspension ───────────────────────────────────────────────────────

  /**
   * Freeze an organization without destroying it.
   *
   * The reversible counterpart to `DELETE /admin/orgs/:orgId`, and the one that
   * should be reached for first. A suspended org keeps every row it has;
   * its members simply cannot sign in and its trackers cannot sync (enforced in
   * routes/auth.ts and the tracker routes, not here).
   */
  fastify.patch("/admin/orgs/:orgId/status", async (req, reply) => {
    const { orgId } = req.params as { orgId: string };
    const body = z
      .object({
        status: z.enum(["active", "suspended"]),
        reason: z.string().trim().max(500).optional(),
      })
      .parse(req.body);

    const org = await prisma.organization.findUnique({
      where: { id: orgId },
      select: { id: true, name: true, status: true },
    });
    if (!org) return reply.code(404).send({ error: "Org not found" });

    const updated = await prisma.organization.update({
      where: { id: orgId },
      data: { status: body.status },
      select: { id: true, name: true, status: true },
    });

    await platformLog({
      actorId: req.user.userId,
      action: body.status === "suspended" ? "org.suspended" : "org.resumed",
      orgId,
      details: { orgName: org.name, from: org.status, to: body.status, reason: body.reason },
    });

    return reply.send(updated);
  });

  // ─── Bulk time across a team ──────────────────────────────────────────────

  /**
   * Apply one time plan to many members of an org at once.
   *
   * Two-phase on purpose: every member is PLANNED first, then — only once the
   * whole set is known and only when this is not a dry run — the writes happen.
   * The single-member route can get away with plan-then-write inline because
   * there is nothing to be half-way through. Here, `replace` deletes existing
   * rows, and a snapshot taken per member as the loop went would leave a partial
   * failure with several separate undos to find and apply in the right order.
   * One operation gets one undo.
   *
   * A member whose plan cannot be computed is recorded against their own row and
   * the loop carries on. One person with a clashing session should not cost the
   * other eleven their entry.
   */
  fastify.post("/admin/orgs/:orgId/time/bulk", async (req, reply) => {
    const { orgId } = req.params as { orgId: string };
    const body = z
      .object({
        userIds: z.array(z.string().uuid()).min(1).max(200).optional(),
        projectId: z.string().uuid(),
        mode: z.enum(["day", "week", "range", "days"]).default("range"),
        date: dateKey.optional(),
        days: z.array(dateKey).min(1).max(MAX_DAYS_PER_REQUEST).optional(),
        from: dateKey.optional(),
        to: dateKey.optional(),
        hoursPerDay: z.number().positive().max(24).optional(),
        totalHours: z.number().positive().optional(),
        activityPct: z.number().min(0).max(100).optional(),
        activityJitter: z.number().min(0).max(50).optional(),
        lengthJitterPct: z.number().min(0).max(50).optional(),
        startJitterMinutes: z.number().int().min(0).max(180).optional(),
        breakMinutes: z.number().int().min(0).max(8 * 60).optional(),
        includeWeekends: z.boolean().optional(),
        // Previously hardcoded to `topUp`, which meant this route could only
        // ever serve one of the intents the single-member route supports.
        fill: z.enum(["topUp", "add", "replace"]).default("topUp"),
        recordAs: z.enum(["manual", "tracked"]).default("manual"),
        matchMemberPattern: z.boolean().default(true),
        reason: z.string().trim().min(1).max(500),
        dryRun: z.boolean().default(true),
      })
      .refine((b) => Boolean(b.hoursPerDay) !== Boolean(b.totalHours), {
        message: "Provide exactly one of hoursPerDay or totalHours",
      })
      .parse(req.body);

    const org = await prisma.organization.findUnique({ where: { id: orgId } });
    if (!org) return reply.code(404).send({ error: "Org not found" });

    const project = await prisma.project.findUnique({ where: { id: body.projectId } });
    if (!project || project.orgId !== orgId) {
      return reply.code(404).send({ error: "Project not found in that organization" });
    }

    let range: { from: string; to: string; only?: string[] };
    try {
      range = resolveRange(body);
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : "Invalid range" });
    }

    const members = await prisma.user.findMany({
      where: {
        orgId,
        status: "active",
        // Platform staff are never swept into a bulk write over a customer org.
        isSuperAdmin: false,
        ...(body.userIds ? { id: { in: body.userIds } } : {}),
      },
      select: { id: true, email: true },
      orderBy: { email: "asc" },
    });
    if (members.length === 0) {
      return reply.code(400).send({ error: "No matching active members in that organization" });
    }

    const timezone = await orgTimezone(orgId);
    const rangeFrom = new Date(localDayStartMs(range.from, timezone));
    const rangeTo = new Date(localDayStartMs(addDays(range.to, 1), timezone));

    interface MemberPlan {
      userId: string;
      email: string;
      days: number;
      seconds: number;
      supersededIds: string[];
      supersededSeconds: number;
      supersededCaptured: number;
      plan: PlannedDay[];
      error?: string;
    }

    /* ── phase 1: plan everybody ─────────────────────────────────────────── */

    const planned: MemberPlan[] = [];

    for (const member of members) {
      const blank: MemberPlan = {
        userId: member.id,
        email: member.email,
        days: 0,
        seconds: 0,
        supersededIds: [],
        supersededSeconds: 0,
        supersededCaptured: 0,
        plan: [],
      };

      try {
        const existing = await prisma.trackingSession.findMany({
          where: {
            userId: member.id,
            startedAt: { lt: rangeTo },
            OR: [{ endedAt: null }, { endedAt: { gt: rangeFrom } }],
          },
          select: { id: true, startedAt: true, endedAt: true, lastSyncAt: true, isManual: true },
        });

        // In `replace` the manual rows are not "busy" — they are what is being
        // superseded. Captured rows always are: bulk deliberately offers no
        // equivalent of `replaceCaptured`, because destroying real tracked work
        // across a whole team is not something to do behind one checkbox.
        const superseded = body.fill === "replace" ? existing.filter((s) => s.isManual) : [];
        const supersededIds = new Set(superseded.map((s) => s.id));

        const busy = existing
          .filter((s) => !supersededIds.has(s.id))
          .map((s) => ({ startMs: s.startedAt.getTime(), endMs: effectiveEnd(s).getTime() }));

        // Defaults taken from this member's own history, so a bulk write does
        // not give twelve people the same synthetic 09:00 start.
        const pattern = body.matchMemberPattern
          ? await loadPattern(member.id, timezone, rangeFrom)
          : null;
        const usable = pattern && pattern.sampleDays >= 3 ? pattern : null;

        // `totalHours` is per MEMBER, not split between them: "everyone did 40
        // hours last week" is the request, not "40 hours shared out".
        let hoursPerDay = body.hoursPerDay ?? 0;
        if (body.totalHours) {
          const probe = planBackfill({
            ...range,
            hoursPerDay: 1,
            includeWeekends: body.includeWeekends,
            timezone,
            sessionIdFor: () => crypto.randomUUID(),
          });
          const days = new Set(probe.map((d) => d.dayKey)).size;
          if (days === 0) throw new Error("That range contains no working days");
          hoursPerDay = body.totalHours / days;
        }

        const plan = planBackfill({
          ...range,
          hoursPerDay,
          startTime: usable ? formatTimeOfDay(usable.startMinutes) : undefined,
          breakMinutes: body.breakMinutes,
          activityPct: body.activityPct ?? usable?.activityPct,
          activityJitter: body.activityJitter,
          lengthJitterPct: body.lengthJitterPct,
          startJitterMinutes: body.startJitterMinutes,
          includeWeekends: body.includeWeekends,
          timezone,
          // `replace` plans like `add`: the rows it would otherwise top up
          // against are the ones being removed.
          fill: body.fill === "replace" ? "add" : body.fill,
          busy,
          sessionIdFor: () => crypto.randomUUID(),
        });

        planned.push({
          ...blank,
          days: new Set(plan.map((d) => d.dayKey)).size,
          seconds: plan.reduce((sum, d) => sum + d.seconds, 0),
          supersededIds: [...supersededIds],
          supersededSeconds: superseded.reduce((sum, s) => sum + Math.round(workedSeconds(s)), 0),
          supersededCaptured: 0,
          plan,
        });
      } catch (err) {
        planned.push({ ...blank, error: err instanceof Error ? err.message : String(err) });
      }
    }

    const summary = {
      org: { id: org.id, name: org.name },
      project: { id: project.id, name: project.name },
      range,
      timezone,
      fill: body.fill,
      recordAs: body.recordAs,
      members: planned.map(({ plan: _plan, ...rest }) => rest),
      totalSeconds: planned.reduce((s, r) => s + r.seconds, 0),
      supersededSeconds: planned.reduce((s, r) => s + r.supersededSeconds, 0),
      failed: planned.filter((r) => r.error).length,
    };

    if (body.dryRun) return reply.send({ ...summary, dryRun: true, written: false });

    /* ── phase 2: one snapshot, then write ───────────────────────────────── */

    const allSuperseded = planned.flatMap((p) => p.supersededIds);
    let snapshotId: string | null = null;

    if (allSuperseded.length > 0) {
      const snapshot = await saveSnapshot({
        actorId: req.user.userId,
        kind: "time.replace",
        orgId,
        payload: await captureSessions(allSuperseded),
      });
      if (!snapshot) {
        return reply.code(503).send({
          error:
            "Could not store an undo snapshot, so nothing was changed. Check that PlatformSnapshot exists.",
        });
      }
      snapshotId = snapshot.id;

      for (const id of allSuperseded) {
        await prisma.$transaction([
          prisma.screenshot.deleteMany({ where: { sessionId: id } }),
          prisma.unusualActivityFlag.deleteMany({ where: { sessionId: id } }),
          prisma.activityBlock.deleteMany({ where: { sessionId: id } }),
          prisma.appUsage.deleteMany({ where: { sessionId: id } }),
          prisma.urlUsage.deleteMany({ where: { sessionId: id } }),
          prisma.idleDiscard.deleteMany({ where: { sessionId: id } }),
          prisma.timeNote.deleteMany({ where: { sessionId: id } }),
          prisma.trackingSession.delete({ where: { id } }),
        ]);
      }
    }

    for (const entry of planned) {
      if (entry.error || entry.plan.length === 0) continue;

      const device = await prisma.device.create({
        data: {
          userId: entry.userId,
          platform: body.recordAs === "manual" ? "manual" : "desktop",
          appVersion: "superadmin",
        },
      });

      for (const day of entry.plan) {
        await prisma.$transaction([
          prisma.trackingSession.create({
            data: {
              id: day.sessionId,
              userId: entry.userId,
              projectId: project.id,
              deviceId: device.id,
              startedAt: day.startedAt,
              endedAt: day.endedAt,
              endReason: "stopped",
              isManual: body.recordAs === "manual",
              manualReason: body.reason,
            },
          }),
          prisma.activityBlock.createMany({
            data: day.blocks.map((b) => ({
              sessionId: day.sessionId,
              blockStart: b.blockStart,
              blockEnd: b.blockEnd,
              keyboardPct: b.keyboardPct,
              mousePct: b.mousePct,
              activityPct: b.activityPct,
              idleSeconds: b.idleSeconds,
              sequenceNo: b.sequenceNo,
              prevHash: b.prevHash,
              hash: b.hash,
              creditedSeconds: b.creditedSeconds,
            })),
          }),
        ]);
      }
    }

    await platformLog({
      actorId: req.user.userId,
      action: "time.bulk_written",
      orgId,
      details: {
        range,
        members: planned.length,
        totalSeconds: summary.totalSeconds,
        supersededSessions: allSuperseded.length,
        failed: summary.failed,
        fill: body.fill,
        recordAs: body.recordAs,
        reason: body.reason,
        snapshotId,
      },
    });

    return reply.send({ ...summary, dryRun: false, written: true, snapshotId });
  });

  /**
   * Set activity across a period for many members at once.
   *
   * The single-member route (`PATCH /admin/users/:id/activity`) is per-user by
   * construction, so "several people" needed a sibling here rather than a flag
   * there. Same two-phase shape and same per-member isolation as the time bulk
   * route above.
   *
   * Blocks are re-chained IN PLACE wherever they exist, so screenshots survive —
   * see `rechainActivity` in lib/backfill.ts for why that matters.
   */
  fastify.post("/admin/orgs/:orgId/activity/bulk", async (req, reply) => {
    const { orgId } = req.params as { orgId: string };
    const body = z
      .object({
        userIds: z.array(z.string().uuid()).min(1).max(200).optional(),
        mode: z.enum(["day", "week", "range", "days"]).default("range"),
        date: dateKey.optional(),
        days: z.array(dateKey).min(1).max(MAX_DAYS_PER_REQUEST).optional(),
        from: dateKey.optional(),
        to: dateKey.optional(),
        activityPct: z.number().min(0).max(100),
        activityJitter: z.number().min(0).max(50).default(8),
        includeCaptured: z.boolean().default(false),
        reason: z.string().trim().min(1).max(500),
        dryRun: z.boolean().default(true),
      })
      .parse(req.body);

    const org = await prisma.organization.findUnique({ where: { id: orgId } });
    if (!org) return reply.code(404).send({ error: "Org not found" });

    let range: { from: string; to: string; only?: string[] };
    try {
      range = resolveRange(body);
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : "Invalid range" });
    }

    const members = await prisma.user.findMany({
      where: {
        orgId,
        status: "active",
        isSuperAdmin: false,
        ...(body.userIds ? { id: { in: body.userIds } } : {}),
      },
      select: { id: true, email: true },
      orderBy: { email: "asc" },
    });
    if (members.length === 0) {
      return reply.code(400).send({ error: "No matching active members in that organization" });
    }

    const timezone = await orgTimezone(orgId);
    const rangeFrom = new Date(localDayStartMs(range.from, timezone));
    const rangeTo = new Date(localDayStartMs(addDays(range.to, 1), timezone));
    const only = range.only ? new Set(range.only) : null;

    const results: {
      userId: string;
      email: string;
      sessions: number;
      rechained: number;
      generated: number;
      screenshotsKept: number;
      error?: string;
    }[] = [];

    for (const member of members) {
      try {
        const sessions = await prisma.trackingSession.findMany({
          where: {
            userId: member.id,
            ...(body.includeCaptured ? {} : { isManual: true }),
            // OVERLAP, not "started inside the window".
            //
            // This is the same trap lib/duration.ts documents at length, and it
            // had exactly the effect that file warns about: a shift beginning at
            // 18:00 the previous evening is counted in today's report but was
            // never rewritten, so setting a day to 45% left its largest session
            // untouched and the reported average barely moved.
            //
            // A still-open session is included too. It has blocks, so it can be
            // re-chained in place; only the generate path needs an `endedAt`,
            // and that path checks for one itself.
            startedAt: { lt: rangeTo },
            OR: [{ endedAt: null }, { endedAt: { gt: rangeFrom } }],
          },
          select: {
            id: true,
            startedAt: true,
            endedAt: true,
            lastSyncAt: true,
            _count: { select: { screenshots: true } },
            activityBlocks: {
              // The current percentages are needed so a block OUTSIDE the window
              // can be re-hashed without its figures being invented.
              select: {
                id: true,
                sequenceNo: true,
                blockStart: true,
                blockEnd: true,
                keyboardPct: true,
                mousePct: true,
                activityPct: true,
                idleSeconds: true,
              },
              orderBy: { sequenceNo: "asc" },
            },
          },
          orderBy: { startedAt: "asc" },
        });

        // `days` mode names specific days inside a wider span, so the set has to
        // be re-applied after the query rather than trusted from the range.
        const targets = sessions.filter((sn) => {
          if (!only) return true;
          // By OVERLAP, not by the day the session starts in — same reason as
          // the query above: an overnight shift belongs to both days it touches.
          const end = effectiveEnd(sn);
          for (const day of only) {
            const dayFrom = localDayStartMs(day, timezone);
            const dayTo = localDayStartMs(addDays(day, 1), timezone);
            if (sn.startedAt.getTime() < dayTo && end.getTime() > dayFrom) return true;
          }
          return false;
        });

        let rechained = 0;
        let generated = 0;
        let shots = 0;

        for (const sn of targets) {
          shots += sn._count.screenshots;
          if (sn.activityBlocks.length > 0) rechained += 1;
          else generated += 1;

          if (body.dryRun || !sn.endedAt) continue;

          if (sn.activityBlocks.length > 0) {
            const blocks = rechainActivity(
              sn.id,
              sn.activityBlocks,
              body.activityPct,
              body.activityJitter,
              { fromMs: rangeFrom.getTime(), toMs: rangeTo.getTime() }
            );
            // Every block is written, not just the changed ones: an unchanged
            // block's HASH still moves when an earlier block in the chain does.
            await prisma.$transaction(
              blocks.map((b) =>
                prisma.activityBlock.update({
                  where: { id: b.id },
                  data: {
                    keyboardPct: b.keyboardPct,
                    mousePct: b.mousePct,
                    activityPct: b.activityPct,
                    idleSeconds: b.idleSeconds,
                    prevHash: b.prevHash,
                    hash: b.hash,
                  },
                })
              )
            );
          } else if (sn.endedAt) {
            const blocks = replanActivity(
              sn.id,
              sn.startedAt,
              sn.endedAt,
              body.activityPct,
              body.activityJitter
            );
            await prisma.activityBlock.createMany({
              data: blocks.map((b) => ({
                sessionId: sn.id,
                blockStart: b.blockStart,
                blockEnd: b.blockEnd,
                keyboardPct: b.keyboardPct,
                mousePct: b.mousePct,
                activityPct: b.activityPct,
                idleSeconds: b.idleSeconds,
                sequenceNo: b.sequenceNo,
                prevHash: b.prevHash,
                hash: b.hash,
                creditedSeconds: b.creditedSeconds,
              })),
            });
          }
        }

        results.push({
          userId: member.id,
          email: member.email,
          sessions: targets.length,
          rechained,
          generated,
          screenshotsKept: shots,
        });
      } catch (err) {
        results.push({
          userId: member.id,
          email: member.email,
          sessions: 0,
          rechained: 0,
          generated: 0,
          screenshotsKept: 0,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    if (!body.dryRun) {
      await platformLog({
        actorId: req.user.userId,
        action: "activity.rewritten",
        orgId,
        details: {
          range,
          members: results.length,
          activityPct: body.activityPct,
          includeCaptured: body.includeCaptured,
          sessions: results.reduce((s, r) => s + r.sessions, 0),
          failed: results.filter((r) => r.error).length,
          reason: body.reason,
        },
      });
    }

    return reply.send({
      org: { id: org.id, name: org.name },
      range,
      timezone,
      activityPct: body.activityPct,
      dryRun: body.dryRun,
      written: !body.dryRun,
      members: results,
      totalSessions: results.reduce((s, r) => s + r.sessions, 0),
      failed: results.filter((r) => r.error).length,
    });
  });

  // ─── The platform trail ───────────────────────────────────────────────────

  /**
   * What platform staff have done, across every tenant.
   *
   * Readable only here. The org-facing `/audit-log` keeps its actor filter, so
   * an org admin still sees nothing of this — the two audiences stay separate by
   * construction rather than by remembering to filter.
   */
  fastify.get("/admin/log", async (req, reply) => {
    const q = z
      .object({
        limit: z.coerce.number().int().min(1).max(200).optional(),
        before: z.string().datetime({ offset: true }).optional(),
        action: z.string().min(1).optional(),
        orgId: z.string().uuid().optional(),
        actorId: z.string().uuid().optional(),
      })
      .parse(req.query);

    const take = q.limit ?? 50;
    const rows = await prisma.platformLog.findMany({
      where: {
        ...(q.action ? { action: q.action } : {}),
        ...(q.orgId ? { orgId: q.orgId } : {}),
        ...(q.actorId ? { actorId: q.actorId } : {}),
        ...(q.before ? { createdAt: { lt: new Date(q.before) } } : {}),
      },
      orderBy: { createdAt: "desc" },
      take,
    });

    return reply.send({ rows, more: rows.length === take });
  });
}
