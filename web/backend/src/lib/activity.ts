/**
 * The one definition of how active a stretch of tracked time was.
 *
 * The sibling of lib/duration.ts, and split out of routes/reports.ts for the
 * same reason that module exists: this arithmetic decides what appears on a
 * member's record, several routes need it, and it must not be reachable only
 * through a module that opens a database connection on import.
 *
 * Activity is measured on the client, per second, and arrives here already
 * reduced to one percentage per block. That reduction is lossy and it shapes
 * everything below: the server can apportion a block, weight it, or ignore it,
 * but it can never recover which seconds inside it were active. Anything that
 * needs finer resolution has to be computed in desktop/src-tauri/src/capture.rs
 * before the block is sealed and hashed.
 */

export type WeightedBlock = {
  activityPct: number;
  creditedSeconds: number | null;
  blockStart: Date;
  blockEnd: Date;
};

/**
 * Seconds this block should be weighted by, or null if it has no usable span.
 *
 * Credited (monotonic) seconds where the client reported them, else the
 * wall-clock span. Exported because blocks are NOT uniform — every pause, stop
 * and project switch finalizes a short one — so anything reasoning about "how
 * long" a run of blocks covers has to ask rather than assume.
 */
export function blockSeconds(b: WeightedBlock): number | null {
  const secs = b.creditedSeconds ?? (b.blockEnd.getTime() - b.blockStart.getTime()) / 1000;
  return Number.isFinite(secs) && secs > 0 ? secs : null;
}

/**
 * The portion of each block that falls inside [fromMs, toMs).
 *
 * Every activity figure has to be clipped to the report window for the same
 * reason every duration already is: `overlapsRange` deliberately returns
 * sessions that *started before* the window, so their blocks arrive with them.
 * Callers used to push those blocks in whole, which measured the activity of one
 * span against the hours of a different, shorter one.
 *
 * A Sunday-22:00-to-Monday-02:00 session of 24 blocks at 50%, read as a Monday
 * report, contributed two hours of worked time and four hours' worth of measured
 * activity: 7,200 activity-seconds inside a 7,200-second window, i.e. 100%, when
 * the honest in-range figure is half that. The same distortion reordered the
 * leaderboard, where it decided who appeared to be working hardest.
 *
 * Activity is apportioned by the block's overlapping *wall-clock* fraction,
 * because a block stores only a scalar percentage — the per-second detail that
 * would let us do better never leaves the client. That assumes activity is
 * spread evenly within a block, which is the only assumption the stored data
 * supports; it is exact for a fully-contained block (the overwhelming majority)
 * and approximate only for the one or two straddling each boundary.
 */
export function blocksInRange(
  blocks: WeightedBlock[],
  fromMs: number,
  toMs: number
): WeightedBlock[] {
  const out: WeightedBlock[] = [];
  for (const b of blocks) {
    const startMs = b.blockStart.getTime();
    const endMs = b.blockEnd.getTime();
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) continue;

    const span = endMs - startMs;
    if (span <= 0) {
      // Nothing to apportion — a zero-span block is either inside or it is not.
      if (startMs >= fromMs && startMs < toMs) out.push(b);
      continue;
    }

    const inside = Math.min(endMs, toMs) - Math.max(startMs, fromMs);
    if (inside <= 0) continue;
    if (inside >= span) {
      out.push(b);
      continue;
    }

    // Partial overlap. Narrow the span so the wall-clock fallback in the two
    // functions below is already correct, and scale credited seconds by the same
    // fraction so a client-reported (monotonic) duration is apportioned too.
    const share = inside / span;
    out.push({
      ...b,
      creditedSeconds: b.creditedSeconds === null ? null : b.creditedSeconds * share,
      blockStart: new Date(Math.max(startMs, fromMs)),
      blockEnd: new Date(Math.min(endMs, toMs)),
    });
  }
  return out;
}

/**
 * Actual seconds of measured activity — the sum of each block's own active
 * portion, not a percentage applied to some other total.
 *
 * This exists because the obvious shortcut is wrong. Multiplying
 * `weightedActivity()` by a worked-seconds total mixes two different
 * denominators: the percentage is weighted over *block* seconds, while worked
 * time is session wall-clock. Blocks only cover the stretches the tracker
 * actually sampled, so block seconds are typically well short of wall-clock —
 * and multiplying the block-weighted percentage by the larger wall-clock figure
 * inflates the result, sometimes by a lot.
 *
 * Summing per block keeps one denominator throughout and yields a number that
 * means what it says: how long input was actually detected.
 */
export function activitySeconds(blocks: WeightedBlock[]): number {
  let total = 0;
  for (const b of blocks) {
    const secs = blockSeconds(b);
    if (secs === null) continue;
    total += (b.activityPct / 100) * secs;
  }
  return Math.round(total);
}

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
    const secs = blockSeconds(b);
    if (secs === null) continue;
    num += b.activityPct * secs;
    den += secs;
  }
  return den > 0 ? +(num / den).toFixed(1) : null;
}
