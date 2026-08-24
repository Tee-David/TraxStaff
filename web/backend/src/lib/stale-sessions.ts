/**
 * Closes tracking sessions that were abandoned rather than stopped.
 *
 * Until this existed, NOTHING in the system ever closed an open session except
 * the owner's next `POST /sessions/start`. A hard kill, OS shutdown, panic, power
 * loss or a rejected token all leave `endedAt` NULL, and until that member
 * happened to start tracking again the row was read everywhere as "still
 * running". lib/duration.ts stops those rows inflating *reads*; this stops them
 * being wrong in the *database*, which is what reports, exports and payroll
 * ultimately answer to.
 *
 * Deliberately requires no schema change: every input is already persisted
 * (TrackingSession.lastSyncAt, ActivityBlock.blockEnd, Device.lastSeenAt). This
 * backend runs DDL on boot against a database that has drifted from
 * schema.prisma, so adding a column here would be the riskiest part of the fix.
 */

// The client is passed in rather than imported: lib/prisma.ts constructs a
// PrismaClient at module load, which needs DATABASE_URL and connects to a live
// cluster that runs DDL on connect. Importing it here would make this module
// unloadable — and therefore untestable — without touching production.
import type { PrismaClient } from "@prisma/client";
import { lastEvidenceAt } from "./duration";

/** How often the sweeper runs once the server is up. */
export const SWEEP_INTERVAL_MS = 5 * 60_000;

/**
 * How long a session must go without evidence before this sweeper writes an end
 * time into the database.
 *
 * NOT `STALE_GRACE_MS`. That constant is 150 seconds and it is correct for what
 * it does: bounding what an open session *displays* while it is quiet. Being
 * wrong there is free — the row is untouched, and the next heartbeat restores
 * the full duration. This threshold governs an irreversible WRITE, where being
 * wrong destroys work that really happened.
 *
 * At 150 seconds it did exactly that. Every witness requires the network; the
 * desktop tracker is offline-first and keeps recording through an outage; and
 * nothing reopened the row afterwards. So a wifi drop at 09:10 closed the
 * session at 09:10, the member worked until 17:00, and the timesheet said ten
 * minutes — with screenshots and activity blocks on disk proving otherwise. The
 * boot-time sweep made it org-wide: any deploy taking longer than 150 seconds
 * closed every session that was tracking at the time.
 *
 * Six hours is longer than any credible outage, deploy or suspend-and-resume,
 * and still bounded. Combined with `reopenIfStillAlive` in routes/sync.ts —
 * which extends a session this sweeper closed when its blocks turn up later —
 * being early is now recoverable rather than final.
 */
export const ABANDON_AFTER_MS = Number(process.env.TRAX_ABANDON_AFTER_MS ?? 6 * 3_600_000);

/**
 * Never touch a session that started within the abandonment window — it may be a
 * client that has begun locally and not yet had a chance to heartbeat (the
 * desktop app is offline-first and registers when it can).
 */
const MIN_AGE_MS = ABANDON_AFTER_MS;

export type SweepResult = {
  scanned: number;
  closed: number;
  /** Ids closed, so the caller can log or audit them. */
  ids: string[];
};

type OpenSession = {
  id: string;
  userId: string | null;
  startedAt: Date;
  lastSyncAt: Date | null;
  activityBlocks: { blockEnd: Date }[];
};

/**
 * Find every open session whose last evidence of life predates the grace window.
 *
 * Only the newest block is loaded per session: `lastEvidenceAt` needs the maximum
 * `blockEnd`, and pulling a long session's entire chain to compute one maximum
 * would make this sweep proportional to how much work has been tracked.
 */
async function findAbandoned(db: PrismaClient, now: Date): Promise<OpenSession[]> {
  const rows = await db.trackingSession.findMany({
    where: {
      endedAt: null,
      startedAt: { lt: new Date(now.getTime() - MIN_AGE_MS) },
    },
    select: {
      id: true,
      userId: true,
      startedAt: true,
      lastSyncAt: true,
      activityBlocks: { select: { blockEnd: true }, orderBy: { blockEnd: "desc" }, take: 1 },
    },
  });
  const cutoff = now.getTime() - ABANDON_AFTER_MS;
  return rows.filter((r) => lastEvidenceAt(r, now).getTime() < cutoff);
}

/**
 * Close abandoned sessions at their last evidence of life.
 *
 * `abrupt_exit` rather than `stopped`, always: the member never stopped this: the
 * app died. Recording it as a clean stop is exactly what made the original bug
 * undetectable — a 39-hour shutdown was indistinguishable from a 39-hour shift.
 */
export async function sweepStaleSessions(
  db: PrismaClient,
  now: Date = new Date()
): Promise<SweepResult> {
  const abandoned = await findAbandoned(db, now);
  const ids: string[] = [];

  for (const s of abandoned) {
    const endedAt = lastEvidenceAt(s, now);
    // `endedAt: null` in the predicate makes this idempotent under concurrency:
    // if another instance (or a real /stop arriving late) closed it first, this
    // updates nothing rather than overwriting a truthful end time.
    const { count } = await db.trackingSession.updateMany({
      where: { id: s.id, endedAt: null },
      data: { endedAt, endReason: "abrupt_exit" },
    });
    if (count > 0) ids.push(s.id);
  }

  return { scanned: abandoned.length, closed: ids.length, ids };
}

/**
 * Run the sweeper now and then on an interval.
 *
 * `unref()` so a pending timer never holds the process open — Render restarts
 * containers, and a sweeper is not a reason to refuse to exit. Failures are
 * logged and swallowed: a database hiccup here must never take the API down,
 * and the next tick retries anyway.
 */
export function startStaleSessionSweeper(
  log: { info: (o: unknown, m?: string) => void; warn: (o: unknown, m?: string) => void },
  db: PrismaClient
): NodeJS.Timeout {
  const run = async () => {
    try {
      const r = await sweepStaleSessions(db);
      if (r.closed > 0) {
        log.info({ closed: r.closed, ids: r.ids }, "closed abandoned tracking sessions");
      }
    } catch (err) {
      log.warn({ err }, "stale-session sweep failed; will retry next interval");
    }
  };
  void run();
  const timer = setInterval(run, SWEEP_INTERVAL_MS);
  timer.unref();
  return timer;
}
