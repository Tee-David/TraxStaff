import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma";

const rangeSchema = z.object({
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  userId: z.string().uuid().optional(),
  // Explicit opt-in for a privileged caller to get the whole org rather than
  // just themselves (see loadSessions below) — only the admin-only Insights
  // dashboard sets this today.
  scope: z.enum(["self", "team"]).optional(),
  // IANA zone the caller wants days bucketed in. Defaults to UTC, which is what
  // this endpoint always did — so an old client keeps its previous behaviour.
  tz: z.string().min(1).max(64).optional(),
});

/** Local calendar day (YYYY-MM-DD) of an instant, in `tz`. */
function localDayKey(d: Date, tz: string): string {
  // en-CA formats as YYYY-MM-DD, which sorts lexicographically.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/** Seconds from local midnight to `d`, in `tz`. */
function secondsIntoLocalDay(d: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  // "24" shows up at exactly midnight in some ICU builds.
  return (get("hour") % 24) * 3600 + get("minute") * 60 + get("second");
}

/**
 * Split a span across local calendar days.
 *
 * A shift from 23:00 to 03:00 owns time on two days. Bucketing the whole span by
 * its start instant — which this endpoint used to do, in UTC — put all four
 * hours on the first day and left the second showing nothing, so a day's total
 * never "reset" at midnight for anyone who worked across it.
 *
 * DST caveat: the boundary is found by adding the remainder of the local day,
 * so a transition inside the span shifts a slice by the offset change. Totals
 * stay correct; only the split point moves, twice a year.
 */
function splitByLocalDay(start: Date, end: Date, tz: string): Map<string, number> {
  const out = new Map<string, number>();
  let cursor = start.getTime();
  const endMs = end.getTime();
  if (!(endMs > cursor)) return out;

  // Bounded so a corrupt row can never spin here.
  for (let guard = 0; guard < 400 && cursor < endMs; guard++) {
    const at = new Date(cursor);
    const key = localDayKey(at, tz);
    const nextMidnight = cursor + (86_400 - secondsIntoLocalDay(at, tz)) * 1000;
    const sliceEnd = Math.min(nextMidnight, endMs);
    out.set(key, (out.get(key) ?? 0) + (sliceEnd - cursor) / 1000);
    cursor = sliceEnd;
  }
  return out;
}

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
  //
  // Used by both the ordinary Timesheets/Reports/Dashboard pages (where every
  // caller, admin included, must default to their OWN data) and the
  // admin-only Insights dashboard (which needs the whole org's numbers by
  // default). The two are told apart by explicit query params rather than
  // role alone: no filter → self; ?userId=<id> → that one member (privileged
  // only); ?scope=team → the whole org (privileged only, what Insights sends).
  async function loadSessions(req: import("fastify").FastifyRequest) {
    const q = rangeSchema.parse(req.query);
    const privileged = req.user.role === "owner" || req.user.role === "admin";
    const where: Record<string, unknown> = {};
    if (privileged) {
      where.user = { orgId: req.user.orgId };
      if (q.userId) {
        where.userId = q.userId;
      } else if (q.scope !== "team") {
        where.userId = req.user.userId;
      }
      // scope === "team" and no userId: leave where.userId unset → whole org.
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
        project: { select: { id: true, name: true, clientTag: true, archivedAt: true } },
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
    const tz = rangeSchema.parse(req.query).tz ?? "UTC";
    const byDay = new Map<string, { date: string; totalSeconds: number; trackedSeconds: number; manualSeconds: number; sessions: number }>();

    for (const s of sessions) {
      const worked = workedSeconds(s);
      const end = s.endedAt ?? new Date();
      const slices = splitByLocalDay(s.startedAt, end, tz);
      const spanned = [...slices.values()].reduce((sum, v) => sum + v, 0);
      if (spanned <= 0) continue;

      // Idle discards have no timestamps, so worked < span. Spread the shortfall
      // across the days proportionally rather than dropping it on the start day.
      const scale = worked / spanned;

      let first = true;
      for (const [day, rawSecs] of slices) {
        const d = byDay.get(day) ?? { date: day, totalSeconds: 0, trackedSeconds: 0, manualSeconds: 0, sessions: 0 };
        const secs = rawSecs * scale;
        d.totalSeconds += secs;
        if (s.isManual) d.manualSeconds += secs;
        else d.trackedSeconds += secs;
        // Counted once, on the day it began — a session split across midnight is
        // still one session, and summing the column must not double it.
        if (first) d.sessions += 1;
        byDay.set(day, d);
        first = false;
      }
    }

    const rows = [...byDay.values()].map((d) => ({
      ...d,
      totalSeconds: Math.round(d.totalSeconds),
      trackedSeconds: Math.round(d.trackedSeconds),
      manualSeconds: Math.round(d.manualSeconds),
    }));
    return reply.send(rows.sort((a, b) => b.date.localeCompare(a.date)));
  });

  // Time grouped by project (+ task), with average activity %.
  fastify.get("/reports/by-project", async (req, reply) => {
    const sessions = await loadSessions(req);
    const byProject = new Map<string, { projectId: string; project: string; clientTag: string | null; archived: boolean; totalSeconds: number; blocks: WeightedBlock[] }>();
    for (const s of sessions) {
      const p = byProject.get(s.projectId) ?? {
        projectId: s.projectId,
        project: s.project.name,
        clientTag: s.project.clientTag,
        // Reported, not filtered. Time tracked against a project that was later
        // archived is still real time and still belongs in a historical report,
        // so this endpoint keeps returning it — callers that only want live
        // projects (Insights' Project Health) filter on this flag instead.
        archived: s.project.archivedAt !== null,
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
        archived: p.archived,
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
    // Honoured here, not just in the dashboard: with the panel switched off the
    // per-domain breakdown should not leave the server at all, or "hidden" is
    // only true of the UI that happens to ask nicely.
    //
    // Tolerates the column not existing yet (a deploy whose migration has not
    // run) — the setting defaults to visible, so failing open matches the
    // default rather than blanking the panel for everyone. See orgs.ts.
    let visible = true;
    try {
      const org = await prisma.organization.findUnique({
        where: { id: req.user.orgId },
        select: { showWebsiteUsage: true },
      });
      visible = org?.showWebsiteUsage ?? true;
    } catch {
      visible = true;
    }
    if (!visible) return reply.send([]);

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
