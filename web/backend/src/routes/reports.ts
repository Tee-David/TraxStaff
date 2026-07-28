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

// Worked time = wall-clock duration minus any discarded idle spans. Idle
// discards are an accounting adjustment; ActivityBlocks are never mutated.
function workedSeconds(s: { startedAt: Date; endedAt: Date | null; idleDiscards: { seconds: number }[] }): number {
  const discarded = s.idleDiscards.reduce((sum, d) => sum + d.seconds, 0);
  return Math.max(0, seconds(s.startedAt, s.endedAt) - discarded);
}

export type WeightedBlock = {
  activityPct: number;
  creditedSeconds: number | null;
  blockStart: Date;
  blockEnd: Date;
};

/**
 * Duration-weighted mean activity, equivalent to
 * `total active seconds / total tracked seconds`.
 *
 * A plain mean of per-block percentages is badly wrong here because blocks are
 * NOT uniform: every pause, stop and project switch finalizes a short block, and
 * a 5-second block scoring 90% (a stray mouse move) would otherwise carry the
 * same weight as a full 600-second block at 15%. That is what made the number
 * read ~81% during barely-active sessions.
 *
 * Weight by credited (monotonic) seconds where the client reported them, else by
 * the block's wall-clock span. Blocks with no usable duration are skipped rather
 * than silently counted as one unit.
 */
export function weightedActivity(blocks: WeightedBlock[]): number | null {
  let num = 0;
  let den = 0;
  for (const b of blocks) {
    const secs = b.creditedSeconds ?? (b.blockEnd.getTime() - b.blockStart.getTime()) / 1000;
    if (!Number.isFinite(secs) || secs <= 0) continue;
    num += b.activityPct * secs;
    den += secs;
  }
  return den > 0 ? +(num / den).toFixed(1) : null;
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
        // Duration is required to weight the activity average — see weightedActivity().
        activityBlocks: { select: { activityPct: true, creditedSeconds: true, blockStart: true, blockEnd: true } },
        idleDiscards: { select: { seconds: true } },
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
      const secs = workedSeconds(s);
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
    const byProject = new Map<string, { projectId: string; project: string; clientTag: string | null; totalSeconds: number; blocks: WeightedBlock[] }>();
    for (const s of sessions) {
      const p = byProject.get(s.projectId) ?? {
        projectId: s.projectId,
        project: s.project.name,
        clientTag: s.project.clientTag,
        totalSeconds: 0,
        blocks: [] as WeightedBlock[],
      };
      p.totalSeconds += workedSeconds(s);
      p.blocks.push(...s.activityBlocks);
      byProject.set(s.projectId, p);
    }
    const out = [...byProject.values()]
      .map((p) => ({
        projectId: p.projectId,
        project: p.project,
        clientTag: p.clientTag,
        totalSeconds: Math.round(p.totalSeconds),
        avgActivityPct: weightedActivity(p.blocks),
      }))
      .sort((a, b) => b.totalSeconds - a.totalSeconds);
    return reply.send(out);
  });

  // App usage: total foreground seconds per application across the caller's
  // visible sessions in range.
  fastify.get("/reports/app-usage", async (req, reply) => {
    const sessions = await loadSessions(req);
    const ids = sessions.map((s) => s.id);
    if (ids.length === 0) return reply.send([]);
    const usages = await prisma.appUsage.findMany({ where: { sessionId: { in: ids } } });
    const byApp = new Map<string, number>();
    for (const u of usages) byApp.set(u.appName, (byApp.get(u.appName) ?? 0) + u.seconds);
    const out = [...byApp.entries()]
      .map(([appName, seconds]) => ({ appName, seconds }))
      .sort((a, b) => b.seconds - a.seconds);
    return reply.send(out);
  });

  // URL usage: total foreground seconds per domain across the caller's visible
  // sessions in range.
  fastify.get("/reports/url-usage", async (req, reply) => {
    const sessions = await loadSessions(req);
    const ids = sessions.map((s) => s.id);
    if (ids.length === 0) return reply.send([]);
    const usages = await prisma.urlUsage.findMany({ where: { sessionId: { in: ids } } });
    const byDomain = new Map<string, number>();
    for (const u of usages) byDomain.set(u.domain, (byDomain.get(u.domain) ?? 0) + u.seconds);
    const out = [...byDomain.entries()]
      .map(([domain, seconds]) => ({ domain, seconds }))
      .sort((a, b) => b.seconds - a.seconds);
    return reply.send(out);
  });

  // Headline summary: total hours, avg activity %, session count, flags.
  fastify.get("/reports/summary", async (req, reply) => {
    const sessions = await loadSessions(req);
    let totalSeconds = 0;
    const blocks: WeightedBlock[] = [];
    for (const s of sessions) {
      totalSeconds += workedSeconds(s);
      blocks.push(...s.activityBlocks);
    }
    return reply.send({
      totalSeconds: Math.round(totalSeconds),
      avgActivityPct: weightedActivity(blocks),
      sessions: sessions.length,
      flaggedSessions: sessions.filter((s) => s.tamperSuspected).length,
    });
  });
}
