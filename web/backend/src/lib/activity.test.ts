/**
 * Tests for the activity arithmetic on the reports routes.
 *
 * Uses node:test + tsx, matching src/lib/duration.test.ts. Run with `npm test`
 * in web/backend.
 *
 * These pin the half of the reporting maths that duration.test.ts does not
 * cover. Durations were unified into lib/duration.ts and tested there; the
 * *activity* figures sitting next to them on every page kept their own,
 * unclipped arithmetic, so a session that began before the report window
 * contributed all of its activity against only the hours inside it. That is
 * invisible in the same way a wrong total is invisible — 100% activity on a
 * two-hour Monday looks like a good morning, not like a bug.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { activitySeconds, blocksInRange, weightedActivity, type WeightedBlock } from "./activity";

const MON_00 = Date.UTC(2026, 7, 10, 0, 0, 0); // Mon 2026-08-10 00:00Z
const TUE_00 = MON_00 + 24 * 3_600_000;
const SUN_22 = MON_00 - 2 * 3_600_000;

/** A block of `secs` seconds at `pct`, starting `offsetMs` from the epoch. */
function block(offsetMs: number, secs: number, pct: number, credited = true): WeightedBlock {
  return {
    activityPct: pct,
    creditedSeconds: credited ? secs : null,
    blockStart: new Date(offsetMs),
    blockEnd: new Date(offsetMs + secs * 1000),
  };
}

/** Twenty-four 10-minute blocks at 50%, Sun 22:00 → Mon 02:00. */
function overnightSession(): WeightedBlock[] {
  return Array.from({ length: 24 }, (_, i) => block(SUN_22 + i * 600_000, 600, 50));
}

// ── blocksInRange ─────────────────────────────────────────────────────────

test("blocks wholly inside the range pass through untouched", () => {
  const blocks = [block(MON_00, 600, 40), block(MON_00 + 600_000, 600, 60)];
  const clipped = blocksInRange(blocks, MON_00, TUE_00);
  assert.equal(clipped.length, 2);
  assert.deepEqual(clipped, blocks);
});

test("blocks wholly outside the range are dropped", () => {
  const clipped = blocksInRange([block(SUN_22, 600, 90)], MON_00, TUE_00);
  assert.equal(clipped.length, 0);
});

test("a block straddling the boundary is apportioned, not taken whole", () => {
  // 600s block starting 5 minutes before Monday: half of it is inside.
  const clipped = blocksInRange([block(MON_00 - 300_000, 600, 80)], MON_00, TUE_00);
  assert.equal(clipped.length, 1);
  assert.equal(clipped[0].creditedSeconds, 300);
  assert.equal(clipped[0].blockStart.getTime(), MON_00);
  assert.equal(clipped[0].activityPct, 80, "the percentage is a rate, not a total");
});

test("a clipped block with no credited seconds falls back to its narrowed span", () => {
  const clipped = blocksInRange([block(MON_00 - 300_000, 600, 80, false)], MON_00, TUE_00);
  assert.equal(clipped[0].creditedSeconds, null);
  const spanSecs = (clipped[0].blockEnd.getTime() - clipped[0].blockStart.getTime()) / 1000;
  assert.equal(spanSecs, 300, "the wall-clock fallback must already be clipped");
});

test("a zero-span block is kept or dropped, never apportioned", () => {
  assert.equal(blocksInRange([block(MON_00, 0, 50)], MON_00, TUE_00).length, 1);
  assert.equal(blocksInRange([block(SUN_22, 0, 50)], MON_00, TUE_00).length, 0);
});

// ── the bug this was written for ──────────────────────────────────────────

test("activitySeconds is clipped to the report window", () => {
  // Sun 22:00 → Mon 02:00, 24 blocks at 50%. A Monday report covers the last
  // two hours only, so the honest figure is half of the session's activity.
  const blocks = overnightSession();

  const unclipped = activitySeconds(blocks);
  assert.equal(unclipped, 7_200, "sanity: the whole session carries 4h of 50%");

  const clipped = activitySeconds(blocksInRange(blocks, MON_00, TUE_00));
  assert.equal(clipped, 3_600);

  // The failure this prevents: 7,200 activity-seconds inside a 7,200-second
  // window reads as 100% activity on a two-hour morning.
  const windowSecs = 2 * 3_600;
  assert.equal(clipped / windowSecs, 0.5);
  assert.equal(unclipped / windowSecs, 1.0, "what the bug used to report");
});

test("weightedActivity is unchanged by clipping when the rate is uniform", () => {
  // Clipping apportions the weight, so a uniform session reads the same either
  // way. This is the guard against "fixing" the total by distorting the rate.
  const blocks = overnightSession();
  assert.equal(weightedActivity(blocks), 50);
  assert.equal(weightedActivity(blocksInRange(blocks, MON_00, TUE_00)), 50);
});

test("weightedActivity reflects only the in-range blocks when the rate varies", () => {
  // Idle before midnight, busy after. A Monday report must see the busy half.
  const blocks = [
    ...Array.from({ length: 12 }, (_, i) => block(SUN_22 + i * 600_000, 600, 10)),
    ...Array.from({ length: 12 }, (_, i) => block(MON_00 + i * 600_000, 600, 90)),
  ];
  assert.equal(weightedActivity(blocks), 50, "the whole session averages out");
  assert.equal(weightedActivity(blocksInRange(blocks, MON_00, TUE_00)), 90);
});

test("clipping is monotone: a wider window never reports less activity", () => {
  const blocks = overnightSession();
  let previous = 0;
  for (const hours of [1, 2, 3, 4, 5]) {
    const secs = activitySeconds(blocksInRange(blocks, SUN_22, SUN_22 + hours * 3_600_000));
    assert.ok(secs >= previous, `widening to ${hours}h lowered activity`);
    previous = secs;
  }
});

test("per-window activity sums to the whole", () => {
  // Splitting a range in two must not create or destroy measured activity.
  const blocks = overnightSession();
  const whole = activitySeconds(blocksInRange(blocks, SUN_22, SUN_22 + 4 * 3_600_000));
  const first = activitySeconds(blocksInRange(blocks, SUN_22, MON_00));
  const second = activitySeconds(blocksInRange(blocks, MON_00, SUN_22 + 4 * 3_600_000));
  assert.equal(first + second, whole);
});

// ── properties that must survive any future change ────────────────────────

test("activity can never be manufactured from blocks with no activity", () => {
  const blocks = Array.from({ length: 24 }, (_, i) => block(SUN_22 + i * 600_000, 600, 0));
  assert.equal(activitySeconds(blocksInRange(blocks, MON_00, TUE_00)), 0);
  assert.equal(weightedActivity(blocksInRange(blocks, MON_00, TUE_00)), 0);
});

test("measured activity never exceeds the window it is measured over", () => {
  // 100% blocks, clipped to a window narrower than the session.
  const blocks = Array.from({ length: 24 }, (_, i) => block(SUN_22 + i * 600_000, 600, 100));
  const secs = activitySeconds(blocksInRange(blocks, MON_00, TUE_00));
  assert.ok(secs <= 2 * 3_600, `${secs}s of activity in a 7200s window`);
});

test("weightedActivity ignores blocks with no usable duration", () => {
  const blocks = [block(MON_00, 600, 20), { ...block(MON_00, 0, 100), creditedSeconds: 0 }];
  assert.equal(weightedActivity(blocks), 20);
});

test("an empty block list has no opinion rather than a zero", () => {
  assert.equal(weightedActivity([]), null);
  assert.equal(activitySeconds([]), 0);
});
