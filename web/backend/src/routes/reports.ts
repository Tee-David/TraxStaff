import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma";

const rangeSchema = z.object({
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  userId: z.string().uuid().optional(),
});

function seconds(startedAt: Date, endedAt: Date | null): number {
  return ((endedAt ?? new Date()).getTime() - startedAt.getTime()) / 1000;
}

export default async function reportRoutes(fastify: FastifyInstance) {
  fastify.addHook("preHandler", fastify.authenticate);

  // Shared: resolve the session set this caller may see, within a range.
  async function loadSessions(req: import("fastify").FastifyRequest) {
    const q = rangeSchema.parse(req.query);
    const privileged = req.user.role === "owner" || req.user.role === "admin";
    const where: Record<string, unknown> = {};
    if (privileged) {
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
    return prisma.trackingSession.findMany({
      where,
      include: {
        project: { select: { id: true, name: true, clientTag: true } },
        task: { select: { id: true, title: true } },
        user: { select: { id: true, email: true } },
        activityBlocks: { select: { activityPct: true } },
      },
      orderBy: { startedAt: "asc" },
    });
  }

  // Daily timesheet: hours per day (optionally per member), tracked vs manual.
  fastify.get("/reports/timesheet", async (req, reply) => {
    const sessions = await loadSessions(req);
    const byDay = new Map<string, { date: string; totalSeconds: number; trackedSeconds: number; manualSeconds: number; sessions: number }>();
    for (const s of sessions) {
      const day = s.startedAt.toISOString().slice(0, 10);
      const d = byDay.get(day) ?? { date: day, totalSeconds: 0, trackedSeconds: 0, manualSeconds: 0, sessions: 0 };
      const secs = seconds(s.startedAt, s.endedAt);
      d.totalSeconds += secs;
      if (s.isManual) d.manualSeconds += secs;
      else d.trackedSeconds += secs;
      d.sessions += 1;
      byDay.set(day, d);
    }
    return reply.send([...byDay.values()].sort((a, b) => b.date.localeCompare(a.date)));
  });

  // Time grouped by project (+ task), with average activity %.
  fastify.get("/reports/by-project", async (req, reply) => {
    const sessions = await loadSessions(req);
    const byProject = new Map<string, { projectId: string; project: string; clientTag: string | null; totalSeconds: number; activitySum: number; activityN: number }>();
    for (const s of sessions) {
      const p = byProject.get(s.projectId) ?? {
        projectId: s.projectId,
        project: s.project.name,
        clientTag: s.project.clientTag,
        totalSeconds: 0,
        activitySum: 0,
        activityN: 0,
      };
      p.totalSeconds += seconds(s.startedAt, s.endedAt);
      for (const blk of s.activityBlocks) {
        p.activitySum += blk.activityPct;
        p.activityN += 1;
      }
      byProject.set(s.projectId, p);
    }
    const out = [...byProject.values()]
      .map((p) => ({
        projectId: p.projectId,
        project: p.project,
        clientTag: p.clientTag,
        totalSeconds: Math.round(p.totalSeconds),
        avgActivityPct: p.activityN ? +(p.activitySum / p.activityN).toFixed(1) : null,
      }))
      .sort((a, b) => b.totalSeconds - a.totalSeconds);
    return reply.send(out);
  });

  // Headline summary: total hours, avg activity %, session count, flags.
  fastify.get("/reports/summary", async (req, reply) => {
    const sessions = await loadSessions(req);
    let totalSeconds = 0, activitySum = 0, activityN = 0;
    for (const s of sessions) {
      totalSeconds += seconds(s.startedAt, s.endedAt);
      for (const blk of s.activityBlocks) {
        activitySum += blk.activityPct;
        activityN += 1;
      }
    }
    return reply.send({
      totalSeconds: Math.round(totalSeconds),
      avgActivityPct: activityN ? +(activitySum / activityN).toFixed(1) : null,
      sessions: sessions.length,
      flaggedSessions: sessions.filter((s) => s.tamperSuspected).length,
    });
  });
}
