/**
 * Turning "eight hours a day, last week, about 60% active" into rows.
 *
 * This is the arithmetic behind the super admin's manual time entry: staff who
 * work offsite have their hours taken on paper, and someone has to put those
 * hours into the system afterwards. `POST /sessions/manual` already exists for
 * that, but it writes ONE session from an explicit start and end instant, for
 * the caller themselves, inside their own org — none of which fits a supervisor
 * entering a week of another org's field work from a timesheet.
 *
 * Kept as pure functions, separate from routes/superadmin.ts, for the same
 * reason lib/duration.ts and lib/activity.ts are pure: this decides what hours
 * appear on somebody's record, and it must be testable without a database.
 *
 * Two things it is deliberately careful about:
 *
 * 1. **Activity blocks are hash-chained.** lib/hashchain.ts verifies that a
 *    session's blocks form a contiguous chain from GENESIS, and routes/sync.ts
 *    flags a session whose chain does not check out. Blocks invented here go
 *    through exactly the same `computeHash`, so a backfilled session verifies
 *    like any other rather than reading as tampered-with.
 *
 * 2. **The jitter is seeded, not random.** A dry run has to produce the same
 *    plan the real run then writes, or "preview" means nothing. Seeding from the
 *    session id gives that for free, and makes the tests deterministic.
 */

import { GENESIS, computeHash } from "./hashchain";
import { addDays, localInstantMs, weekdayIndex } from "./digests";

/** How long each generated activity block covers. Matches the desktop client's cadence. */
export const BLOCK_SECONDS = 600;

/** Bounds on one generated day, mirroring the manual-entry limits in routes/sessions.ts. */
export const MAX_HOURS_PER_DAY = 24;
export const MAX_DAYS_PER_REQUEST = 31;

export interface PlannedBlock {
  sequenceNo: number;
  blockStart: Date;
  blockEnd: Date;
  keyboardPct: number;
  mousePct: number;
  activityPct: number;
  idleSeconds: number;
  creditedSeconds: number;
  prevHash: string;
  hash: string;
}

export interface PlannedDay {
  /** `YYYY-MM-DD` in the org's timezone — the day this belongs to on a timesheet. */
  dayKey: string;
  /** Pre-generated so the hash chain can be built before anything is written. */
  sessionId: string;
  startedAt: Date;
  endedAt: Date;
  seconds: number;
  blocks: PlannedBlock[];
}

export interface BackfillOptions {
  /** Inclusive `YYYY-MM-DD` range. `to` defaults to `from` — a single day. */
  from: string;
  to?: string;
  /** Hours to credit on each included day. Fractional is fine (7.5). */
  hoursPerDay: number;
  /** Local wall-clock start of the working day, `HH:MM`. */
  startTime?: string;
  /**
   * An unpaid break, inserted as a real gap in the middle of the day rather
   * than shaved off the end. A day recorded as 09:00–17:00 with an hour for
   * lunch is two sessions in the real world, and reports that bucket by overlap
   * will show the gap — so the generated shape should have one too.
   */
  breakMinutes?: number;
  /** Target duration-weighted activity, 0–100. */
  activityPct?: number;
  /** Spread around the target. 0 produces a flat line, which no real day is. */
  activityJitter?: number;
  /** Saturday and Sunday are skipped unless this is set. */
  includeWeekends?: boolean;
  /**
   * Restrict to these exact day keys — "these five days", which need not be
   * contiguous or be a whole week. When set it overrides the weekend rule
   * entirely: naming a Saturday is itself the instruction to include it.
   */
  only?: string[];
  /** IANA zone the working day is measured in. */
  timezone: string;
  /** Stable ids so a dry run and the write that follows agree. */
  sessionIdFor: (dayKey: string, index: number) => string;

  /**
   * `add` writes `hoursPerDay` whatever is already there. `topUp` treats it as a
   * TARGET and writes only the shortfall, placed in the gaps around what the
   * member already tracked.
   *
   * `topUp` is the mode that matters for offsite staff, because they are rarely
   * wholly offsite: somebody who ran the tracker for two hours on Tuesday
   * morning and then went out on site has two hours recorded and six missing,
   * and `add` would credit them fourteen.
   */
  fill?: "add" | "topUp";
  /**
   * Time this member already has recorded, as UTC ms spans. Generated time never
   * overlaps these — in `add` mode a clashing day is reported back and skipped,
   * in `topUp` mode the shortfall is fitted into the space between them.
   */
  busy?: BusySpan[];
  /**
   * The window of the local day a top-up may place time inside, `HH:MM`.
   * Defaults to 07:00–20:00, so filling a shortfall never invents work at 3am.
   */
  dayWindow?: { start: string; end: string };
  /**
   * Day-to-day variation, so a generated week is not five identical rows.
   * `startJitterMinutes` moves the start time; `lengthJitterPct` varies how long
   * each day runs. Lengths are renormalised afterwards, so the total across the
   * range is still exactly what was asked for — the variation moves hours
   * between days, it never creates or destroys them.
   */
  startJitterMinutes?: number;
  lengthJitterPct?: number;
}

/** A span of time already accounted for, in UTC ms. */
export interface BusySpan {
  startMs: number;
  endMs: number;
}

export const BACKFILL_DEFAULTS = {
  startTime: "09:00",
  breakMinutes: 0,
  activityPct: 60,
  activityJitter: 12,
  startJitterMinutes: 0,
  lengthJitterPct: 0,
  dayWindow: { start: "07:00", end: "20:00" },
} as const;

/** Shortest span worth writing. Below this a "session" is noise, not work. */
export const MIN_SPAN_SECONDS = 300;

/**
 * Deterministic PRNG (mulberry32) seeded from a string.
 *
 * `Math.random()` would make the preview a lie: the dry run would show one set
 * of percentages and the write would produce another. Seeding from the session
 * id means the same day always generates the same shape, however many times it
 * is previewed.
 */
export function seededRandom(seed: string): () => number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return function next(): number {
    h = (h + 0x6d2b79f5) >>> 0;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clampPct(n: number): number {
  return Math.min(100, Math.max(0, Math.round(n * 100) / 100));
}

/** Parse `HH:MM` into minutes past local midnight. Throws on anything else. */
export function parseTimeOfDay(value: string): number {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  if (!match) throw new Error(`Invalid time of day: ${value} (expected HH:MM)`);
  return Number(match[1]) * 60 + Number(match[2]);
}

/** Every `YYYY-MM-DD` from `from` to `to` inclusive. */
export function dayKeysBetween(from: string, to: string): string[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) throw new Error(`Invalid date: ${from}`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(to)) throw new Error(`Invalid date: ${to}`);
  if (to < from) throw new Error("`to` cannot be before `from`");

  const days: string[] = [];
  for (let key = from; key <= to; key = addDays(key, 1)) {
    days.push(key);
    // Guard against a malformed input walking forever. The route bounds the
    // range too, but this function is exported and should not be able to hang.
    if (days.length > MAX_DAYS_PER_REQUEST) break;
  }
  return days;
}

/**
 * The stretches of `[fromMs, toMs)` that no busy span covers.
 *
 * Busy spans arrive unsorted and may overlap each other (a session left open
 * across a manual entry, two rows from a device handoff), so they are merged
 * before being subtracted. Without the merge an overlapping pair would each
 * carve out the same hole and the second would report negative free time.
 */
export function freeGaps(fromMs: number, toMs: number, busy: BusySpan[]): BusySpan[] {
  const merged: BusySpan[] = [];
  for (const span of [...busy].sort((a, b) => a.startMs - b.startMs)) {
    const last = merged[merged.length - 1];
    if (last && span.startMs <= last.endMs) {
      last.endMs = Math.max(last.endMs, span.endMs);
    } else {
      merged.push({ startMs: span.startMs, endMs: span.endMs });
    }
  }

  const gaps: BusySpan[] = [];
  let cursor = fromMs;
  for (const span of merged) {
    if (span.endMs <= fromMs || span.startMs >= toMs) continue;
    if (span.startMs > cursor) gaps.push({ startMs: cursor, endMs: Math.min(span.startMs, toMs) });
    cursor = Math.max(cursor, span.endMs);
    if (cursor >= toMs) break;
  }
  if (cursor < toMs) gaps.push({ startMs: cursor, endMs: toMs });

  return gaps.filter((g) => g.endMs - g.startMs >= MIN_SPAN_SECONDS * 1000);
}

/**
 * Lay `neededSeconds` into the given gaps, earliest first.
 *
 * Earliest-first rather than spread evenly because that is what the day
 * actually looked like: someone who tracked an hour at 09:00 and then went out
 * worked the rest of the morning, not a slice of every remaining hour. A
 * remainder too small to be a session is dropped rather than written as a
 * 40-second row.
 */
export function fillGaps(gaps: BusySpan[], neededSeconds: number): BusySpan[] {
  const out: BusySpan[] = [];
  let remaining = Math.round(neededSeconds);

  for (const gap of gaps) {
    if (remaining < MIN_SPAN_SECONDS) break;
    const available = Math.floor((gap.endMs - gap.startMs) / 1000);
    const take = Math.min(available, remaining);
    if (take < MIN_SPAN_SECONDS) continue;
    out.push({ startMs: gap.startMs, endMs: gap.startMs + take * 1000 });
    remaining -= take;
  }

  return out;
}

/**
 * Per-day length multipliers averaging exactly 1.
 *
 * The renormalisation is the point. Jittering each day independently would make
 * the week's total drift from what was asked for — enter "40 hours" and get
 * 41h12m, which for anything downstream of this (payroll, a shortfall digest,
 * a client report) is simply a wrong number. Dividing by the realised mean
 * moves hours BETWEEN days without changing their sum.
 */
export function lengthMultipliers(seed: string, count: number, jitterPct: number): number[] {
  if (count === 0) return [];
  if (jitterPct <= 0) return new Array(count).fill(1);

  const rand = seededRandom(`${seed}:lengths`);
  const raw = Array.from({ length: count }, () => 1 + (rand() * 2 - 1) * (jitterPct / 100));
  const mean = raw.reduce((a, b) => a + b, 0) / count;
  return mean > 0 ? raw.map((r) => r / mean) : new Array(count).fill(1);
}

/**
 * The hash-chained blocks covering one session.
 *
 * The final block is short whenever the session does not divide evenly into
 * BLOCK_SECONDS, which is exactly what real capture produces — every pause,
 * stop and project switch seals a partial block (see the note in lib/activity.ts
 * on why blocks are not uniform).
 *
 * `creditedSeconds` is set to the block's own span. On a real block that field
 * is monotonic awake-time from the client's tamper-resistant clock; here there
 * is no clock to read, and the wall-clock span is the honest equivalent — it is
 * also what `blockSeconds()` would have fallen back to had it been left null,
 * so weighting behaves identically either way.
 */
export function planBlocks(
  sessionId: string,
  startedAt: Date,
  endedAt: Date,
  targetPct: number,
  jitter: number
): PlannedBlock[] {
  const blocks: PlannedBlock[] = [];
  const rand = seededRandom(sessionId);

  let prevHash = GENESIS;
  let sequenceNo = 0;
  let cursor = startedAt.getTime();
  const endMs = endedAt.getTime();

  while (cursor < endMs) {
    const blockEndMs = Math.min(cursor + BLOCK_SECONDS * 1000, endMs);
    const blockStart = new Date(cursor);
    const blockEnd = new Date(blockEndMs);
    const seconds = Math.round((blockEndMs - cursor) / 1000);

    // Symmetric jitter around the target. Averaged over a day this lands back on
    // the requested figure, which is what the caller asked for — a day of
    // identical percentages would be the giveaway that nobody typed at all.
    const activityPct = clampPct(targetPct + (rand() * 2 - 1) * jitter);

    // Keyboard and mouse are not independent of activity: a second counts as
    // active because one of them happened. Splitting the measured activity
    // between them (leaning to keyboard, as desk work does) keeps the three
    // figures consistent with each other instead of contradicting.
    const keyboardShare = 0.5 + rand() * 0.25;
    const keyboardPct = clampPct(activityPct * keyboardShare);
    const mousePct = clampPct(activityPct - keyboardPct);

    const chainInput = {
      sessionId,
      sequenceNo,
      blockStart: blockStart.toISOString(),
      blockEnd: blockEnd.toISOString(),
      keyboardPct,
      mousePct,
      activityPct,
      idleSeconds: 0,
    };
    const hash = computeHash(prevHash, chainInput);

    blocks.push({
      sequenceNo,
      blockStart,
      blockEnd,
      keyboardPct,
      mousePct,
      activityPct,
      // Zero on purpose. Idle that was deducted is an IdleDiscard row, and there
      // is none here: a manually-entered day is hours somebody has already
      // vouched for, not a span with time to take back out of it.
      idleSeconds: 0,
      creditedSeconds: seconds,
      prevHash,
      hash,
    });

    prevHash = hash;
    sequenceNo += 1;
    cursor = blockEndMs;
  }

  return blocks;
}

/**
 * Expand a request into the days it covers and the sessions each one needs.
 *
 * A day with a break becomes two sessions — before and after — because that is
 * what the day actually was, and because reports attribute time by overlap
 * (lib/duration.ts): one unbroken 09:00–18:00 row would credit the lunch hour.
 */
export function planBackfill(opts: BackfillOptions): PlannedDay[] {
  const {
    from,
    to = opts.from,
    hoursPerDay,
    startTime = BACKFILL_DEFAULTS.startTime,
    breakMinutes = BACKFILL_DEFAULTS.breakMinutes,
    activityPct = BACKFILL_DEFAULTS.activityPct,
    activityJitter = BACKFILL_DEFAULTS.activityJitter,
    includeWeekends = false,
    timezone,
    sessionIdFor,
    fill = "add",
    busy = [],
    dayWindow = BACKFILL_DEFAULTS.dayWindow,
    startJitterMinutes = BACKFILL_DEFAULTS.startJitterMinutes,
    lengthJitterPct = BACKFILL_DEFAULTS.lengthJitterPct,
  } = opts;

  if (!(hoursPerDay > 0)) throw new Error("hoursPerDay must be greater than zero");
  if (hoursPerDay > MAX_HOURS_PER_DAY) {
    throw new Error(`hoursPerDay cannot exceed ${MAX_HOURS_PER_DAY}`);
  }

  const startMinutes = parseTimeOfDay(startTime);
  const windowStart = parseTimeOfDay(dayWindow.start);
  const windowEnd = parseTimeOfDay(dayWindow.end);
  if (windowEnd <= windowStart) throw new Error("dayWindow.end must be after dayWindow.start");

  const targetSeconds = Math.round(hoursPerDay * 3600);
  const breakSeconds = Math.max(0, Math.round(breakMinutes * 60));

  const only = opts.only ? new Set(opts.only) : null;
  const dayKeys = dayKeysBetween(from, to).filter((key) =>
    // An explicitly named day is always included: asking for a Saturday and
    // then having the weekend rule drop it silently would be the worst of both.
    only ? only.has(key) : includeWeekends || weekdayIndex(key) < 5
  );

  // Seeded from the range itself, so the same request always produces the same
  // week — the dry run and the write have to agree.
  const multipliers = lengthMultipliers(`${from}:${to}:${hoursPerDay}`, dayKeys.length, lengthJitterPct);
  const startRand = seededRandom(`${from}:${to}:starts`);

  const days: PlannedDay[] = [];

  dayKeys.forEach((dayKey, dayIndex) => {
    const wanted = Math.round(targetSeconds * multipliers[dayIndex]);
    if (wanted < MIN_SPAN_SECONDS) return;

    // Spans are half-open [start, end) in UTC ms, resolved from the local wall
    // clock — see localInstantMs on why this is not an offset from midnight.
    let spans: BusySpan[];

    if (fill === "topUp") {
      // Only the shortfall, and only in the space around what is already there.
      const windowFrom = localInstantMs(dayKey, windowStart, timezone);
      const windowTo = localInstantMs(dayKey, windowEnd, timezone);

      const alreadyTracked = busy.reduce(
        (sum, b) =>
          sum + Math.max(0, Math.min(b.endMs, windowTo) - Math.max(b.startMs, windowFrom)) / 1000,
        0
      );
      const shortfall = wanted - alreadyTracked;
      if (shortfall < MIN_SPAN_SECONDS) return; // this day is already met

      spans = fillGaps(freeGaps(windowFrom, windowTo, busy), shortfall);
    } else {
      // Fixed shape: start at the requested time, with the break in the middle.
      const jitterMinutes =
        startJitterMinutes > 0
          ? Math.round((startRand() * 2 - 1) * startJitterMinutes)
          : 0;
      const beginsAt = localInstantMs(dayKey, startMinutes + jitterMinutes, timezone);

      const firstHalf = breakSeconds > 0 ? Math.round(wanted / 2) : wanted;
      const secondHalf = wanted - firstHalf;

      spans = [{ startMs: beginsAt, endMs: beginsAt + firstHalf * 1000 }];
      if (secondHalf >= MIN_SPAN_SECONDS) {
        const resumesAt = spans[0].endMs + breakSeconds * 1000;
        spans.push({ startMs: resumesAt, endMs: resumesAt + secondHalf * 1000 });
      }
    }

    spans.forEach((span, index) => {
      if (span.endMs <= span.startMs) return;
      const sessionId = sessionIdFor(dayKey, index);
      const startedAt = new Date(span.startMs);
      const endedAt = new Date(span.endMs);
      days.push({
        dayKey,
        sessionId,
        startedAt,
        endedAt,
        seconds: Math.round((span.endMs - span.startMs) / 1000),
        blocks: planBlocks(sessionId, startedAt, endedAt, activityPct, activityJitter),
      });
    });
  });

  return days;
}

/**
 * Fresh hash-chained blocks for a session whose recorded activity is being
 * corrected — the "change activity time" half of the feature.
 *
 * A rewrite, not an edit. schema.prisma's own note says `activityPct` is inside
 * the hash chain and is not ours to edit; changing one block's percentage in
 * place would break every link after it and leave the session reading as
 * altered. So the old blocks are dropped and the chain is rebuilt from GENESIS
 * over the same wall-clock span, which is self-consistent by construction.
 */
export function replanActivity(
  sessionId: string,
  startedAt: Date,
  endedAt: Date,
  targetPct: number,
  jitter: number
): PlannedBlock[] {
  return planBlocks(sessionId, startedAt, endedAt, targetPct, jitter);
}

/**
 * What this member's tracked days actually look like, derived from their own
 * history.
 *
 * The reason this exists: a backfill that always writes 09:00–17:00 at 60% is
 * obviously synthetic on any record that has real tracking either side of it.
 * Somebody whose logged-in days start at 07:30 and run at 45% should have their
 * offsite days entered the same way, or the manual entries stand out as exactly
 * what they are and the record reads as two different people.
 *
 * Medians, not means, on purpose. One forgotten session closed at 3am — which
 * lib/duration.ts exists because of — would drag a mean start time hours
 * earlier and a mean day length into double figures. A median shrugs it off.
 *
 * Returns null when there is not enough history to say anything, which the
 * caller must treat as "use the defaults" rather than "this member works zero
 * hours".
 */
export interface MemberPattern {
  /** Local minutes past midnight the member usually starts. */
  startMinutes: number;
  /** Their usual day, in hours. */
  hoursPerDay: number;
  /** Their usual duration-weighted activity, 0–100. */
  activityPct: number;
  /** How many days went into this. Below ~3 the figures are barely evidence. */
  sampleDays: number;
}

export interface PatternSession {
  startedAt: Date;
  endedAt: Date | null;
  seconds: number;
  activityPct: number | null;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export function derivePattern(
  sessions: PatternSession[],
  timezone: string,
  localMinutesOf: (d: Date, tz: string) => number
): MemberPattern | null {
  const byDay = new Map<string, { firstStart: number; seconds: number }>();
  const activity: { pct: number; weight: number }[] = [];

  for (const s of sessions) {
    if (s.seconds <= 0) continue;
    // Manual entries are excluded by the caller; what reaches here is capture.
    const dayKey = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(s.startedAt);

    const startMinutes = localMinutesOf(s.startedAt, timezone);
    const existing = byDay.get(dayKey);
    if (existing) {
      existing.firstStart = Math.min(existing.firstStart, startMinutes);
      existing.seconds += s.seconds;
    } else {
      byDay.set(dayKey, { firstStart: startMinutes, seconds: s.seconds });
    }

    if (s.activityPct !== null) activity.push({ pct: s.activityPct, weight: s.seconds });
  }

  if (byDay.size === 0) return null;

  const days = [...byDay.values()];
  const weight = activity.reduce((a, b) => a + b.weight, 0);

  return {
    startMinutes: Math.round(median(days.map((d) => d.firstStart))),
    hoursPerDay: +(median(days.map((d) => d.seconds)) / 3600).toFixed(2),
    activityPct:
      weight > 0
        ? +(activity.reduce((a, b) => a + b.pct * b.weight, 0) / weight).toFixed(1)
        : BACKFILL_DEFAULTS.activityPct,
    sampleDays: byDay.size,
  };
}

/** `HH:MM` for a minutes-past-midnight value, for feeding back into options. */
export function formatTimeOfDay(minutes: number): string {
  const clamped = Math.max(0, Math.min(23 * 60 + 59, Math.round(minutes)));
  const h = String(Math.floor(clamped / 60)).padStart(2, "0");
  const m = String(clamped % 60).padStart(2, "0");
  return `${h}:${m}`;
}

/**
 * Re-chain a session's EXISTING blocks at a new activity level, in place.
 *
 * The alternative — delete the blocks and generate fresh ones — is what
 * `replanActivity` does, and it cannot be used on a captured session:
 * `Screenshot.activityBlockId` is a required foreign key, so dropping the blocks
 * means dropping every screenshot hanging off them. On a real tracked week that
 * is hundreds of images of somebody's screen, deleted to change a percentage.
 *
 * So this keeps every block row, its id, its start and its end, and rewrites
 * only the three percentages — then recomputes `prevHash`/`hash` across the
 * whole sequence so the chain still verifies. `activityPct` is inside the hash
 * (schema.prisma says so), which is exactly why the chain has to be recomputed
 * rather than left alone: editing the value and keeping the old hash is the
 * definition of a block that reads as altered.
 *
 * Blocks must be passed in `sequenceNo` order.
 */
export interface ExistingBlock {
  id: string;
  sequenceNo: number;
  blockStart: Date;
  blockEnd: Date;
  /**
   * What the block currently records. Required because a block outside the
   * rewrite window keeps its own figures and is only re-hashed — without these
   * the chain could not be recomputed without inventing values for it.
   */
  keyboardPct: number;
  mousePct: number;
  activityPct: number;
  idleSeconds: number;
}

export interface RechainedBlock extends ExistingBlock {
  prevHash: string;
  hash: string;
  /** False when the block sat outside the window and only its hash moved. */
  changed: boolean;
}

/**
 * Does more than half of this block lie inside the window?
 *
 * A zero-length block has no majority to speak of, so it falls back to whether
 * its instant is inside — the same treatment `blocksInRange` gives one.
 */
function majorityInside(
  block: { blockStart: Date; blockEnd: Date },
  window: { fromMs: number; toMs: number }
): boolean {
  const start = block.blockStart.getTime();
  const end = block.blockEnd.getTime();
  const span = end - start;
  if (span <= 0) return start >= window.fromMs && start < window.toMs;
  const inside = Math.min(end, window.toMs) - Math.max(start, window.fromMs);
  return inside > span / 2;
}

export function rechainActivity(
  sessionId: string,
  blocks: ExistingBlock[],
  targetPct: number,
  jitter: number,
  /**
   * Only blocks overlapping this window have their percentages rewritten.
   *
   * A session can straddle the period being edited — a shift beginning at 18:00
   * runs into the next day — and rewriting all of it would silently change a day
   * the operator did not ask about. Blocks outside the window keep their own
   * figures.
   *
   * Their hashes still move, and must: `prevHash` chains forward from the first
   * altered block, so every block after it has to be recomputed or the chain
   * stops verifying at that point. Omit the window to rewrite the whole session.
   *
   * A block STRADDLING the edge goes to whichever side holds most of it. This is
   * a real limitation of the data model, not a preference: a block stores one
   * scalar percentage for its whole span (lib/activity.ts explains why the
   * per-second detail never leaves the client), so a block lying half in and
   * half out cannot be half-rewritten. Something has to give, and majority
   * assignment is what bounds the damage — the alternative rules either leak
   * a whole block into the neighbouring day or leave a hole in the target one.
   *
   * Straddling blocks are rare but not negligible: the tracker seals a block
   * when activity resumes, so an idle machine can produce one spanning thirteen
   * hours and two calendar days.
   */
  window?: { fromMs: number; toMs: number }
): RechainedBlock[] {
  const rand = seededRandom(`${sessionId}:rechain`);
  const out: RechainedBlock[] = [];
  let prevHash = GENESIS;

  for (const block of blocks) {
    // Majority overlap — see the note on `window` above.
    const inWindow = !window || majorityInside(block, window);

    let { keyboardPct, mousePct, activityPct, idleSeconds } = block;
    if (inWindow) {
      activityPct = clampPct(targetPct + (rand() * 2 - 1) * jitter);
      keyboardPct = clampPct(activityPct * (0.5 + rand() * 0.25));
      mousePct = clampPct(activityPct - keyboardPct);
      idleSeconds = 0;
    }

    const hash = computeHash(prevHash, {
      sessionId,
      sequenceNo: block.sequenceNo,
      blockStart: block.blockStart.toISOString(),
      blockEnd: block.blockEnd.toISOString(),
      keyboardPct,
      mousePct,
      activityPct,
      idleSeconds,
    });

    out.push({
      ...block,
      keyboardPct,
      mousePct,
      activityPct,
      idleSeconds,
      prevHash,
      hash,
      changed: inWindow,
    });
    prevHash = hash;
  }

  return out;
}
