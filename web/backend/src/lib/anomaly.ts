import { blockSeconds } from "./activity";

// Server-side "unusual activity" detection, thresholds adapted from Hubstaff's
// documented rules. Operates on a session's activity blocks. Pure function →
// returns the flag types that currently apply; the caller persists new ones.
// Never mutates input.
//
// Two things this must get right, because the output is an accusation against a
// named person:
//
// 1. **Blocks are not ten minutes long.** They are finalized on every pause,
//    stop, project switch and suspend-wake, so five-second blocks are routine.
//    The rules below therefore measure real elapsed time rather than counting
//    blocks and multiplying by ten. Counting blocks meant three project switches
//    in a minute — three short blocks, each trivially 100% because a single
//    input second over a one-second denominator is 100% — reported as
//    "sustained high activity for 30 minutes".
//
// 2. **Absence of activity is not evidence of gaming.** A jiggler produces
//    sustained, unnaturally steady *non-zero* activity. A flat run of zeros is
//    someone who walked away, or a tracker whose input hook has died (capture.rs
//    warns the UI about exactly this). Flagging that as robotic accuses a member
//    of fraud for the crime of taking a break, or for our own bug.

export type DetectedFlag =
  | "sustained_high_activity"
  | "low_variance_robotic"
  | "input_channel_imbalance";

/**
 * Activity floor below which a flat run means "nobody was there", not "a machine
 * was pretending to be there". Deliberately above zero: a jiggler that produced
 * genuinely 0% would not be a jiggler.
 */
const ROBOTIC_MIN_ACTIVITY_PCT = 5;

type Scored = { pct: number; keyboardPct: number; mousePct: number; seconds: number };

/**
 * Exactly the columns this module reads — structural, not the full Prisma row.
 *
 * Callers can then `select` these and nothing else. An unqualified Prisma read
 * asks for every column in schema.prisma, which breaks the moment the schema
 * gains a column the database has not been migrated for; taking the whole row
 * here is what forced those callers to over-select in the first place.
 */
export type AnomalyBlock = {
  activityPct: number;
  keyboardPct: number;
  mousePct: number;
  creditedSeconds: number | null;
  blockStart: Date;
  blockEnd: Date;
};

export function detectAnomalies(blocks: AnomalyBlock[]): {
  type: DetectedFlag;
  details: Record<string, unknown>;
}[] {
  const found: { type: DetectedFlag; details: Record<string, unknown> }[] = [];
  if (blocks.length === 0) return found;

  // Chronological order, each block carrying its real duration. Blocks with no
  // usable span are dropped rather than counted as a unit of anything.
  const b: Scored[] = [...blocks]
    .sort((x, y) => x.blockStart.getTime() - y.blockStart.getTime())
    .map((blk) => ({
      pct: blk.activityPct,
      keyboardPct: blk.keyboardPct,
      mousePct: blk.mousePct,
      seconds: blockSeconds(blk) ?? 0,
    }))
    .filter((blk) => blk.seconds > 0);
  if (b.length === 0) return found;

  const minutes = (secs: number) => +(secs / 60).toFixed(1);

  // 1) Sustained ≥95% activity for ≥30 minutes of real elapsed time.
  let runSecs = 0;
  for (const blk of b) {
    runSecs = blk.pct >= 95 ? runSecs + blk.seconds : 0;
    if (runSecs >= 30 * 60) {
      found.push({
        type: "sustained_high_activity",
        details: { thresholdPct: 95, minutes: minutes(runSecs) },
      });
      break;
    }
  }

  // 2) Low variance (robotic): activity varies ≤4 points across 90 minutes, or
  //    is perfectly flat across 40 minutes — but only where there is activity to
  //    be flat about. See note 2 at the top.
  outer: for (let i = 0; i < b.length; i++) {
    for (const [winMinutes, spread] of [[90, 4], [40, 0]] as const) {
      // Walk forward from i until the window is genuinely covered.
      let secs = 0;
      let lo = Infinity;
      let hi = -Infinity;
      for (let j = i; j < b.length; j++) {
        secs += b[j].seconds;
        lo = Math.min(lo, b[j].pct);
        hi = Math.max(hi, b[j].pct);
        if (secs < winMinutes * 60) continue;

        if (hi - lo <= spread && lo > ROBOTIC_MIN_ACTIVITY_PCT) {
          found.push({
            type: "low_variance_robotic",
            details: {
              windowMinutes: winMinutes,
              maxSpread: spread,
              observedSpread: +(hi - lo).toFixed(2),
              observedMinutes: minutes(secs),
            },
          });
          break outer;
        }
        break; // window covered and not flat — try the next rule / start index
      }
    }
  }

  // 3) Input-channel imbalance: one channel near-zero while the other is active,
  //    sustained ≥50 minutes — the classic mouse-jiggler signature.
  for (const [active, quiet, label] of [
    ["mousePct", "keyboardPct", "keyboard"],
    ["keyboardPct", "mousePct", "mouse"],
  ] as const) {
    let imbalanceSecs = 0;
    for (const blk of b) {
      imbalanceSecs = blk[active] > 10 && blk[quiet] <= 1 ? imbalanceSecs + blk.seconds : 0;
      if (imbalanceSecs >= 50 * 60) {
        found.push({
          type: "input_channel_imbalance",
          details: { silentChannel: label, minutes: minutes(imbalanceSecs) },
        });
        break;
      }
    }
  }

  return found;
}
