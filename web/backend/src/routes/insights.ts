import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { blocksInRange, weightedActivity, type WeightedBlock } from "../lib/activity";
import {
  DELETED_USER_KEY,
  DELETED_USER_LABEL,
  orgScoped,
  orgScopedViaSession,
} from "../lib/org-scope";
import { excludeRejected } from "../lib/approval";
import { evidenceSelect, isAbandoned, overlapsRange, workedSecondsInRange } from "../lib/duration";

const PRESENCE_WINDOW_MS = 3 * 60 * 1000; // "online" if a device beat within 3 min

function requireAdmin(req: import("fastify").FastifyRequest, reply: import("fastify").FastifyReply): boolean {
  if (req.user.role !== "owner" && req.user.role !== "admin") {
    reply.code(403).send({ error: "Admins only" });
    return false;
  }
  return true;
}

export default async function insightsRoutes(fastify: FastifyInstance) {
  fastify.addHook("preHandler", fastify.authenticate);

  // Who's online — derived from each member's most-recent device heartbeat.
  fastify.get("/insights/presence", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const members = await prisma.user.findMany({
      where: { orgId: req.user.orgId, status: "active" },
      select: {
        id: true,
        email: true,
        devices: { orderBy: { lastSeenAt: "desc" }, take: 1 },
        sessions: {
          where: { endedAt: null },
          // Newest first: a member with more than one open row (which shouldn't
          // happen, but did) should be reported as tracking the latest, not an
          // arbitrary one.
          orderBy: { startedAt: "desc" },
          take: 1,
          include: {
            project: { select: { name: true } },
            // Needed to tell "tracking" from "left a session open months ago".
            ...evidenceSelect,
          },
        },
      },
    });
    const now = new Date();
    return reply.send(
      members.map((m) => {
        const lastSeen = m.devices[0]?.lastSeenAt ?? null;
        const online = lastSeen ? now.getTime() - lastSeen.getTime() < PRESENCE_WINDOW_MS : false;
        const open = m.sessions[0];
        // An open row is not proof of tracking. Nothing closes an abandoned
        // session, so "endedAt IS NULL" alone reported people as tracking a
        // project they last touched days ago — on the admin panel whose entire
        // job is to say who is working right now.
        const live = open && !isAbandoned(open, now) ? open : null;
        return {
          userId: m.id,
          email: m.email,
          online,
          lastSeenAt: lastSeen,
          tracking: live ? { project: live.project.name, since: live.startedAt } : null,
        };
      })
    );
  });

  // Unusual-activity report: flags across the org, newest first.
  fastify.get("/insights/unusual-activity", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const flags = await prisma.unusualActivityFlag.findMany({
      where: { OR: orgScopedViaSession(req.user.orgId) },
      include: {
        session: {
          select: {
            id: true,
            startedAt: true,
            user: { select: { id: true, email: true } },
            project: { select: { name: true } },
          },
        },
      },
      orderBy: { detectedAt: "desc" },
      take: 200,
    });
    return reply.send(flags);
  });

  // Leaderboard: rank members by tracked hours and average activity over range.
  fastify.get("/insights/leaderboard", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const q = z.object({
      from: z.string().datetime({ offset: true }).optional(),
      to: z.string().datetime({ offset: true }).optional(),
    }).parse(req.query);

    // Orphaned sessions (owner hard-deleted) have no user to reach the org
    // through, so they are admitted via their project instead — otherwise a
    // deleted member's tracked work silently disappears from the leaderboard.
    const where: Record<string, unknown> = { OR: orgScoped(req.user.orgId) };
    // By overlap, matching reports.ts — see lib/duration.ts's overlapsRange.
    const fromMs = q.from ? new Date(q.from).getTime() : -Infinity;
    const toMs = q.to ? new Date(q.to).getTime() : Infinity;
    const range = overlapsRange(
      q.from ? new Date(q.from) : undefined,
      q.to ? new Date(q.to) : undefined
    );
    // Same rule as reports.ts: rejected manual time does not count, and the
    // leaderboard ranks people against each other — leaving it in would rank
    // someone on hours an admin has explicitly refused.
    where.AND = [...range, ...excludeRejected()];
    const sessions = await prisma.trackingSession.findMany({
      where,
      include: {
        user: { select: { id: true, email: true } },
        // Duration is needed to weight the average — a plain mean of block
        // percentages lets a 5-second block outweigh a full 10-minute one.
        activityBlocks: { select: { activityPct: true, creditedSeconds: true, blockStart: true, blockEnd: true } },
        // The leaderboard ranks people against each other, so an abandoned
        // session doesn't just inflate one row — it reorders the board. Load the
        // evidence and the idle adjustments the ranking depends on.
        idleDiscards: { select: { seconds: true, from: true, to: true } },
        ...evidenceSelect,
      },
    });
    // Orphaned sessions all collapse into one "Deleted user" entry rather than
    // being dropped: the hours were really worked and still belong in the org's
    // totals, even though nobody owns them any more.
    const now = new Date();
    const byUser = new Map<string, { userId: string | null; email: string; totalSeconds: number; blocks: WeightedBlock[] }>();
    for (const s of sessions) {
      const key = s.userId ?? DELETED_USER_KEY;
      const u = byUser.get(key) ?? {
        userId: s.userId,
        email: s.user?.email ?? DELETED_USER_LABEL,
        totalSeconds: 0,
        blocks: [] as WeightedBlock[],
      };
      // workedSecondsInRange, not gross: this used to be the one total that ignored
      // idle discards, so the same range read differently on Reports and here — the
      // "decide once" in plans/checklist.md §1.4. Discards are subtracted, and the
      // figure is clipped to the requested window since `overlapsRange` admits
      // sessions that started before it.
      u.totalSeconds += workedSecondsInRange(s, fromMs, toMs, now);
      // Clipped to the same window as totalSeconds. Unclipped, a session that
      // began before the window contributed all of its activity against only the
      // hours inside it, which is what reordered the leaderboard.
      u.blocks.push(...blocksInRange(s.activityBlocks, fromMs, toMs));
      byUser.set(key, u);
    }
    const board = [...byUser.values()]
      .map((u) => ({
        userId: u.userId,
        email: u.email,
        totalSeconds: Math.round(u.totalSeconds),
        avgActivityPct: weightedActivity(u.blocks) ?? 0,
      }))
      .sort((a, b) => b.totalSeconds - a.totalSeconds);
    return reply.send(board);
  });

  // Acknowledge (dismiss) an unusual-activity flag — admins only.
  fastify.post("/insights/unusual-activity/:id/acknowledge", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const { id } = req.params as { id: string };
    const flag = await prisma.unusualActivityFlag.findUnique({
      where: { id },
      include: {
        session: {
          select: { user: { select: { orgId: true } }, project: { select: { orgId: true } } },
        },
      },
    });
    // An orphaned session has no user, so fall back to the project's org rather
    // than dereferencing null (which used to throw a 500 here).
    const flagOrgId = flag?.session.user?.orgId ?? flag?.session.project.orgId;
    if (!flag || flagOrgId !== req.user.orgId) {
      return reply.code(404).send({ error: "Not found" });
    }
    await prisma.unusualActivityFlag.update({ where: { id }, data: { acknowledgedAt: new Date() } });
    return reply.send({ ok: true });
  });

  // Notifications for the current user's org (admins) or the user themself.
  //
  // Org-wide trail of destructive + membership actions. Admin-only and always
  // org-scoped — unlike notifications there is no self-scoped variant, because
  // an audit log a member could narrow to "just my actions" is not an audit log.
  //
  // Same keyset cursor as /notifications (createdAt of the last row seen), for
  // the same reason: an action landing mid-scroll must not shift the page
  // boundary and hide a row. Filters are applied server-side so the page never
  // has to hold the whole history to narrow it.
  fastify.get("/audit-log", async (req, reply) => {
      if (!requireAdmin(req, reply)) return;
      const q = z
        .object({
          limit: z.coerce.number().int().min(1).max(200).optional(),
          before: z.string().datetime({ offset: true }).optional(),
          action: z.string().min(1).optional(),
          actorId: z.string().uuid().optional(),
          from: z.string().datetime({ offset: true }).optional(),
          to: z.string().datetime({ offset: true }).optional(),
          q: z.string().min(1).max(200).optional(),
        })
        .parse(req.query);

      // `before` is the pagination cursor and `from`/`to` are the user's date
      // filter; all three constrain createdAt, so they merge into one clause
      // rather than overwriting each other.
      const createdAt: Record<string, Date> = {};
      if (q.from) createdAt.gte = new Date(q.from);
      const upper = [q.to ? new Date(q.to) : null, q.before ? new Date(q.before) : null]
        .filter((d): d is Date => d !== null)
        .sort((a, b) => a.getTime() - b.getTime())[0];
      if (upper) createdAt.lt = upper;

      const take = q.limit ?? 50;
      const rows = await prisma.auditLog.findMany({
        where: {
          orgId: req.user.orgId,
          ...(q.action ? { action: q.action } : {}),
          ...(q.actorId ? { actorId: q.actorId } : {}),
          ...(Object.keys(createdAt).length ? { createdAt } : {}),
          // Free-text search runs against the denormalised payload, not the
          // actor relation — the whole point is that deleted people stay findable.
          ...(q.q
            ? {
                OR: [
                  { payload: { path: ["actorEmail"], string_contains: q.q } },
                  { payload: { path: ["targetLabel"], string_contains: q.q } },
                ],
              }
            : {}),
        },
        orderBy: { createdAt: "desc" },
        take,
      });

      return reply.send({ rows, more: rows.length === take });
  });

  // The distinct actions present in this org, so the filter dropdown offers only
  // values that will actually match something.
  fastify.get("/audit-log/actions", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const rows = await prisma.auditLog.findMany({
      where: { orgId: req.user.orgId },
      distinct: ["action"],
      select: { action: true },
      orderBy: { action: "asc" },
    });
    return reply.send(rows.map((r) => r.action));
  });

  // `limit` and `before` exist for the full Notifications page, which pages back
  // through the whole history; the bell in the header just takes the default.
  // Cursor is the createdAt of the last row seen rather than an offset, so a
  // notification arriving mid-scroll doesn't shift the page boundary and cause a
  // row to be skipped.
  fastify.get("/notifications", async (req, reply) => {
    const q = z
      .object({
        limit: z.coerce.number().int().min(1).max(200).optional(),
        before: z.string().datetime({ offset: true }).optional(),
        unread: z.enum(["1", "true"]).optional(),
      })
      .parse(req.query);

    const privileged = req.user.role === "owner" || req.user.role === "admin";
    const scope = privileged ? { orgId: req.user.orgId } : { userId: req.user.userId };
    const notifications = await prisma.notification.findMany({
      where: {
        ...scope,
        ...(q.before ? { createdAt: { lt: new Date(q.before) } } : {}),
        ...(q.unread ? { readAt: null } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: q.limit ?? 100,
    });
    return reply.send(notifications);
  });

  // Unread count, so the bell and the sidebar badge don't each have to pull a
  // full page of rows just to count the dots.
  fastify.get("/notifications/unread-count", async (req, reply) => {
    const privileged = req.user.role === "owner" || req.user.role === "admin";
    const scope = privileged ? { orgId: req.user.orgId } : { userId: req.user.userId };
    const count = await prisma.notification.count({ where: { ...scope, readAt: null } });
    return reply.send({ count });
  });

  fastify.post("/notifications/read-all", async (req, reply) => {
    const privileged = req.user.role === "owner" || req.user.role === "admin";
    const scope = privileged ? { orgId: req.user.orgId } : { userId: req.user.userId };
    const { count } = await prisma.notification.updateMany({
      where: { ...scope, readAt: null },
      data: { readAt: new Date() },
    });
    return reply.send({ ok: true, count });
  });

  fastify.post("/notifications/:id/read", async (req, reply) => {
    const { id } = req.params as { id: string };
    const n = await prisma.notification.findUnique({ where: { id } });
    // Same visibility rule as the list above: an admin acts on anything in the
    // org, a member only on their own. Checking the org alone let any member
    // mark a colleague's notification read.
    const privileged = req.user.role === "owner" || req.user.role === "admin";
    const visible = n && n.orgId === req.user.orgId && (privileged || n.userId === req.user.userId);
    if (!visible) return reply.code(404).send({ error: "Not found" });
    await prisma.notification.update({ where: { id }, data: { readAt: new Date() } });
    return reply.send({ ok: true });
  });
}
