import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { orgScoped } from "../lib/org-scope";
import {
  effectiveEnd,
  evidenceSelect,
  overlapSeconds,
  overlapsRange,
  workedSeconds,
  workedSecondsInRange,
} from "../lib/duration";
import {
  activitySeconds,
  blocksInRange,
  weightedActivity,
  type WeightedBlock,
} from "../lib/activity";

// Activity arithmetic lives in lib/activity.ts, alongside lib/duration.ts and
// for the same reasons: several routes need it, and it must stay reachable
// without importing a module that opens a database connection.

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

// Duration lives in lib/duration.ts now. It used to be `(endedAt ?? now) -
// startedAt` right here, with near-identical copies in insights.ts, the web
// dashboard, the desktop widget and the mobile app — the "three conflicting
// definitions of hours worked" in plans/checklist.md §1.4. That formula treats an
// abandoned session as still running, and nothing in the system ever closed one,
// so a single forgotten row grew without bound across every report.

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
  /**
   * The window a report is scoped to, in ms. Unbounded ends become ±Infinity so
   * range-scoping arithmetic works without special cases.
   *
   * Every total below must be scoped to this, because `overlapsRange` deliberately
   * returns sessions that began before `from` — a shift started on Sunday evening
   * owns time in Monday's week, but only the part after the boundary.
   */
  function rangeMs(req: import("fastify").FastifyRequest): { fromMs: number; toMs: number } {
    const q = rangeSchema.parse(req.query);
    return {
      fromMs: q.from ? new Date(q.from).getTime() : -Infinity,
      toMs: q.to ? new Date(q.to).getTime() : Infinity,
    };
  }

  async function loadSessions(req: import("fastify").FastifyRequest) {
    const q = rangeSchema.parse(req.query);
    const privileged = req.user.role === "owner" || req.user.role === "admin";
    const where: Record<string, unknown> = {};
    if (privileged) {
      // OR rather than `user: { orgId }` alone: a session whose owner has been
      // hard-deleted has userId IS NULL, and Prisma compiles a relation filter
      // as an inner join, so those rows would drop out of every org-wide report
      // entirely. They reach the org through their project instead.
      where.OR = orgScoped(req.user.orgId);
      if (q.userId) {
        where.userId = q.userId;
      } else if (q.scope !== "team") {
        where.userId = req.user.userId;
      }
      // scope === "team" and no userId: leave where.userId unset → whole org,
      // orphaned work included.
    } else {
      where.userId = req.user.userId;
    }
    // Matched by OVERLAP, not by start instant. Filtering on `startedAt >= from`
    // dropped every session that began before the window and ran into it — a night
    // shift vanished from the next day's report, and an open session that started
    // before the range was excluded from the very report that would have exposed
    // it, while one starting inside the range ran to `now`. The range filter and
    // the duration maths have to share a definition.
    const range = overlapsRange(
      q.from ? new Date(q.from) : undefined,
      q.to ? new Date(q.to) : undefined
    );
    if (range.length) where.AND = range;
    return prisma.trackingSession.findMany({
      where,
      include: {
        project: { select: { id: true, name: true, clientTag: true, archivedAt: true } },
        task: { select: { id: true, title: true } },
        user: { select: { id: true, email: true } },
        // Duration is required to weight the activity average — see weightedActivity().
        // blockEnd doubles as evidence of life for lib/duration.ts.
        activityBlocks: { select: { activityPct: true, creditedSeconds: true, blockStart: true, blockEnd: true } },
        // from/to as well as the total: a discard is a specific span, and every
        // per-day and per-range figure below attributes it to the window it
        // actually happened in rather than spreading it.
        idleDiscards: { select: { seconds: true, from: true, to: true } },
        // Heartbeat, the third witness that an open session is still alive.
        ...evidenceSelect,
      },
      orderBy: { startedAt: "asc" },
    });
  }

  // Daily timesheet: hours per day (optionally per member), tracked vs manual.
  fastify.get("/reports/timesheet", async (req, reply) => {
    const sessions = await loadSessions(req);
    const tz = rangeSchema.parse(req.query).tz ?? "UTC";
    // One instant for the whole response: computing `new Date()` per session hands
    // out subtly different "now"s across a long loop, so slices wouldn't sum to
    // the totals reported beside them.
    const now = new Date();
    const { fromMs, toMs } = rangeMs(req);
    const byDay = new Map<string, { date: string; totalSeconds: number; trackedSeconds: number; manualSeconds: number; sessions: number }>();

    for (const s of sessions) {
      // Clipped to the requested window. `overlapsRange` deliberately returns a
      // session that began before `from`, so splitting its FULL span would emit
      // day rows for dates the caller never asked about — and a "this week"
      // timesheet would sprout a row for last Sunday.
      const startMs = Math.max(new Date(s.startedAt).getTime(), fromMs);
      const endMs = Math.min(effectiveEnd(s, now).getTime(), toMs);
      if (!(endMs > startMs)) continue;
      const slices = splitByLocalDay(new Date(startMs), new Date(endMs), tz);
      if (slices.size === 0) continue;

      // Each day gets its OWN worked total, computed against that day's window.
      //
      // This used to scale every slice by one session-wide `worked / gross` ratio,
      // on the stated assumption that idle discards carry no timestamps. They do,
      // and the difference is not cosmetic: a session spanning Monday to Wednesday
      // with a two-day hole in the middle had the hole smeared evenly across all
      // three days, so a Wednesday of real work reported a fraction of itself while
      // Tuesday — when nothing happened at all — still reported hours.
      let first = true;
      let cursor = startMs;
      for (const [day, rawSecs] of slices) {
        const dayEnd = Math.min(cursor + rawSecs * 1000, endMs);
        const d = byDay.get(day) ?? { date: day, totalSeconds: 0, trackedSeconds: 0, manualSeconds: 0, sessions: 0 };
        const secs = workedSecondsInRange(s, cursor, dayEnd, now);
        d.totalSeconds += secs;
        if (s.isManual) d.manualSeconds += secs;
        else d.trackedSeconds += secs;
        // Counted once, on the first day it appears in this window — a session
        // split across midnight is still one session, and summing the column must
        // not double it.
        if (first) d.sessions += 1;
        byDay.set(day, d);
        first = false;
        cursor = dayEnd;
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
    const now = new Date();
    const { fromMs, toMs } = rangeMs(req);
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
      p.totalSeconds += workedSecondsInRange(s, fromMs, toMs, now);
      // Clipped to the same window as totalSeconds above — see blocksInRange().
      p.blocks.push(...blocksInRange(s.activityBlocks, fromMs, toMs));
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
    const now = new Date();
    const { fromMs, toMs } = rangeMs(req);
    let totalSeconds = 0;
    let trackedSeconds = 0;
    let discardedSeconds = 0;
    const blocks: WeightedBlock[] = [];
    for (const s of sessions) {
      // Gross clock and the idle taken off it, reported alongside the net so a
      // client can show why "worked" is smaller than the time on the timer.
      // Without these the two numbers look like synonyms that disagree, and the
      // only way to reconcile them was to read this file.
      //
      // Derived so that `tracked − discarded === total`, by construction. The
      // Activity panel renders that subtraction literally, and it used to be
      // false: `totalSeconds` honours each discard's exact span while the old
      // `discardedSeconds` spread every discard proportionally across the
      // session. A two-hour Monday lunch on a Monday-to-Wednesday session showed
      // up as one invented hour in a Tuesday-only report, printed directly under
      // a worked figure that had correctly excluded it.
      const inWindow = overlapSeconds(s, fromMs, toMs, now);
      const worked = workedSecondsInRange(s, fromMs, toMs, now);
      totalSeconds += worked;
      trackedSeconds += inWindow;
      discardedSeconds += Math.max(0, inWindow - worked);
      // Clipped to the same window as the totals above — see blocksInRange().
      blocks.push(...blocksInRange(s.activityBlocks, fromMs, toMs));
    }
    return reply.send({
      totalSeconds: Math.round(totalSeconds),
      trackedSeconds: Math.round(trackedSeconds),
      discardedSeconds: Math.round(discardedSeconds),
      avgActivityPct: weightedActivity(blocks),
      // Measured directly rather than left for the client to derive as
      // `totalSeconds * avgActivityPct`. That derivation is wrong — see
      // activitySeconds() — and both clients were doing it.
      activitySeconds: activitySeconds(blocks),
      sessions: sessions.length,
      flaggedSessions: sessions.filter((s) => s.tamperSuspected).length,
    });
  });
}
