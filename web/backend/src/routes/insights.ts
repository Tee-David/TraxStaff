import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma";

const PRESENCE_WINDOW_MS = 3 * 60 * 1000; // "online" if a device beat within 3 min

function seconds(startedAt: Date, endedAt: Date | null): number {
  return ((endedAt ?? new Date()).getTime() - startedAt.getTime()) / 1000;
}

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
          take: 1,
          include: { project: { select: { name: true } } },
        },
      },
    });
    const now = Date.now();
    return reply.send(
      members.map((m) => {
        const lastSeen = m.devices[0]?.lastSeenAt ?? null;
        const online = lastSeen ? now - lastSeen.getTime() < PRESENCE_WINDOW_MS : false;
        const open = m.sessions[0];
        return {
          userId: m.id,
          email: m.email,
          online,
          lastSeenAt: lastSeen,
          tracking: open ? { project: open.project.name, since: open.startedAt } : null,
        };
      })
    );
  });

  // Unusual-activity report: flags across the org, newest first.
  fastify.get("/insights/unusual-activity", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const flags = await prisma.unusualActivityFlag.findMany({
      where: { session: { user: { orgId: req.user.orgId } } },
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

    const where: Record<string, unknown> = { user: { orgId: req.user.orgId } };
    if (q.from || q.to) {
      where.startedAt = {
        ...(q.from ? { gte: new Date(q.from) } : {}),
        ...(q.to ? { lte: new Date(q.to) } : {}),
      };
    }
    const sessions = await prisma.trackingSession.findMany({
      where,
      include: {
        user: { select: { id: true, email: true } },
        activityBlocks: { select: { activityPct: true } },
      },
    });
    const byUser = new Map<string, { userId: string; email: string; totalSeconds: number; aSum: number; aN: number }>();
    for (const s of sessions) {
      const u = byUser.get(s.userId) ?? { userId: s.userId, email: s.user.email, totalSeconds: 0, aSum: 0, aN: 0 };
      u.totalSeconds += seconds(s.startedAt, s.endedAt);
      for (const b of s.activityBlocks) { u.aSum += b.activityPct; u.aN += 1; }
      byUser.set(s.userId, u);
    }
    const board = [...byUser.values()]
      .map((u) => ({
        userId: u.userId,
        email: u.email,
        totalSeconds: Math.round(u.totalSeconds),
        avgActivityPct: u.aN ? +(u.aSum / u.aN).toFixed(1) : 0,
      }))
      .sort((a, b) => b.totalSeconds - a.totalSeconds);
    return reply.send(board);
  });

  // Notifications for the current user's org (admins) or the user themself.
  fastify.get("/notifications", async (req, reply) => {
    const privileged = req.user.role === "owner" || req.user.role === "admin";
    const notifications = await prisma.notification.findMany({
      where: privileged ? { orgId: req.user.orgId } : { userId: req.user.userId },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return reply.send(notifications);
  });

  fastify.post("/notifications/:id/read", async (req, reply) => {
    const { id } = req.params as { id: string };
    const n = await prisma.notification.findUnique({ where: { id } });
    if (!n || n.orgId !== req.user.orgId) return reply.code(404).send({ error: "Not found" });
    await prisma.notification.update({ where: { id }, data: { readAt: new Date() } });
    return reply.send({ ok: true });
  });
}
