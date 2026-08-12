/**
 * The one definition of how long a tracking session lasted.
 *
 * Every total in this product used to compute `(endedAt ?? new Date()) - startedAt`
 * independently — reports.ts, insights.ts, the web dashboard, the desktop widget
 * and the mobile app each had their own copy (see plans/checklist.md §1.4). That
 * arithmetic is correct for a closed session and catastrophic for an open one,
 * because NOTHING closes an abandoned session:
 *
 *   - a hard kill, OS shutdown, panic or power loss never posts /sessions/:id/stop
 *     (the desktop's ExitRequested handler only flushes to the local queue), and
 *   - a rejected token can't post one, by definition.
 *
 * So `endedAt` stays NULL forever and "still running" grows by sixty seconds a
 * minute, for months, across the member's dashboard, the admin leaderboard and
 * every report. One forgotten row is how a member who had tracked seven minutes
 * was shown 44h58m for the week.
 *
 * The fix is to stop treating NULL as "now" and treat it as "until we last had
 * evidence this session was alive". That evidence is already persisted — this
 * module needs no schema change, which matters because this backend runs DDL on
 * boot against a database that has drifted from schema.prisma.
 */

/**
 * Grace period past the last evidence of life before a session is considered
 * abandoned rather than merely quiet.
 *
 * Deliberately the same 150s as STALE_SESSION_MS in routes/sessions.ts, which
 * already decides when a session may be taken over by another device: heartbeats
 * are every 60s, so this tolerates one missed beat. A genuinely live session is
 * never affected (its evidence is at most a minute old); an abandoned one stops
 * accruing two and a half minutes after its last breath instead of indefinitely.
 */
export const STALE_GRACE_MS = 150_000;

/**
 * The minimum a session needs to carry for its duration to be computable.
 *
 * Structural rather than a Prisma type: callers select different shapes (the
 * timesheet needs idle discards, the session list does not), and each of the
 * evidence fields is optional so a caller that genuinely cannot load one degrades
 * to the remaining evidence instead of failing to compile.
 */
export type EvidenceInput = {
  startedAt: Date;
  /**
   * Last time this session's device successfully synced. Server-stamped only
   * (schema.prisma's own comment says so) — which is exactly what makes it
   * trustworthy evidence rather than a client claim.
   */
  lastSyncAt?: Date | null;
  /** Latest `blockEnd` across the session's activity blocks, if loaded. */
  latestBlockEnd?: Date | null;
  /**
   * Convenience for the routes that already load blocks for activity weighting —
   * pass them straight through instead of reducing to `latestBlockEnd` at every
   * call site. Either field works; the later of the two wins.
   */
  activityBlocks?: { blockEnd: Date }[];
  device?: { lastSeenAt: Date } | null;
};

/**
 * Evidence plus the session's own end, for anything that computes a duration.
 * Split from EvidenceInput because the sweeper only ever looks at OPEN sessions
 * and has no `endedAt` to hand — asking it to pass `endedAt: null` just to satisfy
 * a type would be noise.
 */
export type DurationInput = EvidenceInput & {
  endedAt: Date | null;
};

/**
 * A stretch of a session that was deducted from worked time.
 *
 * `from`/`to` are optional only for callers that select just the total. Where they
 * ARE present they must be used: a discard is a specific span of wall clock, and
 * spreading it evenly over the session instead is the difference between "you
 * worked 7h today" and "you worked 2h50m today".
 *
 * (The original code carried a comment saying idle discards have no timestamps and
 * therefore had to be spread proportionally. That was simply untrue — `IdleDiscard`
 * has had `from` and `to` columns all along — and the day-splitting in
 * /reports/timesheet was built on it.)
 */
export type IdleDiscardInput = { seconds: number; from?: Date | null; to?: Date | null };

/** Seconds of the given discards that fall inside [fromMs, toMs). */
export function idleSecondsInRange(
  discards: IdleDiscardInput[] | undefined,
  fromMs: number,
  toMs: number
): number {
  if (!discards || discards.length === 0) return 0;
  let total = 0;
  for (const d of discards) {
    if (!d.from || !d.to) continue;
    total += Math.max(0, Math.min(ms(d.to), toMs) - Math.max(ms(d.from), fromMs)) / 1000;
  }
  return total;
}

/** Seconds of discards that have no span recorded, so can only be spread. */
function untimedIdleSeconds(discards: IdleDiscardInput[] | undefined): number {
  if (!discards) return 0;
  return discards.reduce((a, d) => a + (d.from && d.to ? 0 : d.seconds || 0), 0);
}

function ms(d: Date | null | undefined): number {
  if (!d) return 0;
  const t = d.getTime();
  return Number.isFinite(t) ? t : 0;
}

/**
 * The last instant we have server-side evidence that this session was alive.
 *
 * Three independent witnesses, strongest first, and the latest of them wins:
 *  - `lastSyncAt` — the session itself reached us.
 *  - the newest `ActivityBlock.blockEnd` — capture was running and producing work.
 *  - `device.lastSeenAt` — the heartbeat, which is what /sessions/start already
 *    trusts when finalizing a session abandoned on *another* device.
 *
 * Floored at `startedAt`: a session that never lived long enough to heartbeat has
 * a `device.lastSeenAt` predating its own start, and a duration must never be
 * negative.
 */
export function lastEvidenceAt(s: EvidenceInput): Date {
  return new Date(
    Math.max(
      ms(s.startedAt),
      ms(s.lastSyncAt),
      ms(s.latestBlockEnd),
      ms(latestBlockEnd(s.activityBlocks)),
      ms(s.device?.lastSeenAt)
    )
  );
}

/**
 * When this session effectively ended.
 *
 * A closed session is its own authority. An open one runs to `now` only while it
 * is still proving it exists; past the grace window it is pinned to its last
 * evidence, so an abandoned row is frozen rather than unbounded.
 *
 * `now` is injectable so callers computing many sessions share one instant —
 * otherwise a long loop hands out subtly different "now"s — and so the tests can
 * pin it.
 */
export function effectiveEnd(s: DurationInput, now: Date = new Date()): Date {
  if (s.endedAt) {
    // Legacy rows written before start-reconciliation existed can have an
    // endedAt before startedAt. Clamp rather than propagate a negative.
    return ms(s.endedAt) < ms(s.startedAt) ? s.startedAt : s.endedAt;
  }
  const cap = ms(lastEvidenceAt(s)) + STALE_GRACE_MS;
  return new Date(Math.min(ms(now), Math.max(cap, ms(s.startedAt))));
}

/** True once a session has stopped proving it is alive. */
export function isAbandoned(s: DurationInput, now: Date = new Date()): boolean {
  return !s.endedAt && ms(now) > ms(lastEvidenceAt(s)) + STALE_GRACE_MS;
}

/** Gross wall-clock seconds, bounded by `effectiveEnd`. Never negative. */
export function grossSeconds(s: DurationInput, now: Date = new Date()): number {
  return Math.max(0, (ms(effectiveEnd(s, now)) - ms(s.startedAt)) / 1000);
}

/**
 * Worked seconds — gross wall clock minus idle the member chose to discard.
 *
 * This is the number that should appear anywhere the product says "hours
 * worked". Previously reports.ts subtracted the discards and insights.ts
 * (the leaderboard) did not, so the same range read differently depending on
 * which page you opened. IdleDiscard rows are an accounting adjustment;
 * ActivityBlocks are never mutated.
 */
export function workedSeconds(
  s: DurationInput & { idleDiscards?: IdleDiscardInput[] },
  now: Date = new Date()
): number {
  const discarded = (s.idleDiscards ?? []).reduce((sum, d) => sum + (d.seconds || 0), 0);
  return Math.max(0, grossSeconds(s, now) - discarded);
}

/**
 * Seconds of a session falling inside [fromMs, toMs).
 *
 * Time is attributed by OVERLAP, never by which day or week a session began. A
 * shift from 23:00 to 03:00 belongs to both days — one hour to the first, three to
 * the second — and bucketing it by its start instant is what put 39 hours on a
 * single Monday in the performance chart.
 */
export function overlapSeconds(
  s: DurationInput,
  fromMs: number,
  toMs: number,
  now: Date = new Date()
): number {
  const start = ms(s.startedAt);
  const end = ms(effectiveEnd(s, now));
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  return Math.max(0, Math.min(end, toMs) - Math.max(start, fromMs)) / 1000;
}

/**
 * Worked seconds attributable to [fromMs, toMs) — the range-scoped counterpart of
 * `workedSeconds`.
 *
 * Needed because `overlapsRange` deliberately returns sessions that started before
 * the window: without scoping, a shift begun on Sunday evening would contribute all
 * of its hours to the Monday-to-Sunday report. Discarded idle has no timestamps, so
 * the shortfall is spread proportionally across the span — the same treatment
 * /reports/timesheet already applies when splitting a session across days.
 *
 * Pass `-Infinity`/`Infinity` (or simply use `workedSeconds`) for an unbounded range.
 */
export function workedSecondsInRange(
  s: DurationInput & { idleDiscards?: IdleDiscardInput[] },
  fromMs: number,
  toMs: number,
  now: Date = new Date()
): number {
  const gross = grossSeconds(s, now);
  if (gross <= 0) return 0;
  // Clip the window to the session, so idle overlap is measured against the same
  // span the gross figure covers.
  const startMs = ms(s.startedAt);
  const endMs = ms(effectiveEnd(s, now));
  const winFrom = Math.max(fromMs, startMs);
  const winTo = Math.min(toMs, endMs);
  const inside = Math.max(0, winTo - winFrom) / 1000;
  if (inside <= 0) return 0;

  // Timed discards come off the exact window they happened in. This is what makes
  // a two-day hole land on the two days it actually spans instead of shaving an
  // even slice off every day of the session.
  const timed = idleSecondsInRange(s.idleDiscards, winFrom, winTo);

  // Anything with no span recorded can only be spread across the session, which is
  // the old behaviour — kept as a fallback for rows written before spans existed.
  const untimed = untimedIdleSeconds(s.idleDiscards);
  const spread = untimed > 0 ? untimed * (inside / gross) : 0;

  return Math.max(0, inside - timed - spread);
}

/**
 * Prisma `where` fragment matching sessions that OVERLAP [from, to], for use as
 * `AND: overlapsRange(from, to)`.
 *
 * Range filters used to constrain `startedAt` alone, which silently dropped any
 * session that began before the window and ran into it — the exact opposite of how
 * the durations above are computed. The two must agree, or a night shift
 * disappears from Monday's report and a stale open session is excluded from the
 * very range that would have revealed it.
 */
export function overlapsRange(from?: Date, to?: Date) {
  const clauses: Record<string, unknown>[] = [];
  if (to) clauses.push({ startedAt: { lte: to } });
  if (from) clauses.push({ OR: [{ endedAt: null }, { endedAt: { gte: from } }] });
  return clauses;
}

/**
 * The subset of a Prisma `include`/`select` that the helpers above need, so route
 * handlers can't quietly forget a witness and silently degrade the maths.
 * `activityBlocks` is intentionally not here — callers that need block-derived
 * evidence pass `latestBlockEnd` themselves, since some already load full blocks
 * for activity weighting and others must not.
 */
export const evidenceSelect = {
  device: { select: { lastSeenAt: true } },
} as const;

/** Newest `blockEnd` from an already-loaded block list, or null. */
export function latestBlockEnd(blocks: { blockEnd: Date }[] | undefined): Date | null {
  if (!blocks || blocks.length === 0) return null;
  let max = 0;
  for (const b of blocks) max = Math.max(max, ms(b.blockEnd));
  return max > 0 ? new Date(max) : null;
}
