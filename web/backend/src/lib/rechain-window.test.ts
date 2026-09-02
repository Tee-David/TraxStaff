import test from "node:test";
import assert from "node:assert/strict";
import { rechainActivity, type ExistingBlock } from "./backfill";
import { GENESIS, verifyChain } from "./hashchain";
import { weightedActivity } from "./activity";

/**
 * Rewriting activity for ONE day of a session that spans two.
 *
 * The bug these cover was reported from the product: activity was set to 45%
 * for a day and the report still read 32%. Two causes, both silent:
 *
 *   1. sessions were selected by `startedAt` inside the window rather than by
 *      OVERLAP, so the largest session of the day — an evening shift that began
 *      the day before — was counted by the report and never rewritten;
 *   2. `endedAt: { not: null }` excluded the session that was still running,
 *      which on "today" is usually the biggest one there is.
 *
 * The route-level queries are asserted by the HTTP checks. What is asserted here
 * is the part that has to be right for those queries to be safe to widen: that
 * rewriting a window inside a session leaves the rest of it alone and still
 * produces a chain that verifies.
 */

const SESSION = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

/** Ten-minute blocks from `startISO`, each carrying the same starting figures. */
function blocks(startISO: string, count: number, pct = 20): ExistingBlock[] {
  const start = Date.parse(startISO);
  return Array.from({ length: count }, (_, i) => ({
    id: `b${i}`,
    sequenceNo: i,
    blockStart: new Date(start + i * 600_000),
    blockEnd: new Date(start + (i + 1) * 600_000),
    keyboardPct: pct * 0.6,
    mousePct: pct * 0.4,
    activityPct: pct,
    idleSeconds: 0,
  }));
}

function verify(out: ReturnType<typeof rechainActivity>) {
  return verifyChain(
    out.map((b) => ({
      sessionId: SESSION,
      sequenceNo: b.sequenceNo,
      blockStart: b.blockStart.toISOString(),
      blockEnd: b.blockEnd.toISOString(),
      keyboardPct: b.keyboardPct,
      mousePct: b.mousePct,
      activityPct: b.activityPct,
      idleSeconds: b.idleSeconds,
      prevHash: b.prevHash,
      hash: b.hash,
    })),
    GENESIS,
    0
  );
}

test("a window rewrites only the blocks inside it", () => {
  // 22:00 to 02:00 — six blocks on the first day, eighteen on the second.
  const all = blocks("2026-08-30T22:00:00.000Z", 24, 20);
  const day2 = {
    fromMs: Date.parse("2026-08-31T00:00:00.000Z"),
    toMs: Date.parse("2026-09-01T00:00:00.000Z"),
  };

  const out = rechainActivity(SESSION, all, 45, 0, day2);

  const before = out.filter((b) => b.blockEnd.getTime() <= day2.fromMs);
  const inside = out.filter((b) => b.blockStart.getTime() >= day2.fromMs);

  assert.equal(before.length, 12, "22:00-00:00 is twelve ten-minute blocks");
  assert.ok(inside.length > 0);

  for (const b of before) {
    assert.equal(b.activityPct, 20, "a block outside the window keeps its own figure");
    assert.equal(b.changed, false);
  }
  for (const b of inside) {
    assert.equal(b.activityPct, 45, "a block inside the window takes the new target");
    assert.equal(b.changed, true);
  }
});

test("the chain still verifies after a partial rewrite", () => {
  // The whole point: changing block 12 moves every hash after it, so a partial
  // rewrite that did not re-chain would leave the session reading as altered.
  const all = blocks("2026-08-30T22:00:00.000Z", 24, 20);
  const out = rechainActivity(SESSION, all, 45, 6, {
    fromMs: Date.parse("2026-08-31T00:00:00.000Z"),
    toMs: Date.parse("2026-09-01T00:00:00.000Z"),
  });

  const result = verify(out);
  assert.equal(result.ok, true, result.reasons.join("; "));
  assert.equal(result.altered, false);
});

test("an untouched block's hash still moves when an earlier one changes", () => {
  // Which is why the route writes every block back, not just the changed ones.
  const all = blocks("2026-08-31T08:00:00.000Z", 10, 20);
  const firstHalf = {
    fromMs: Date.parse("2026-08-31T08:00:00.000Z"),
    toMs: Date.parse("2026-08-31T09:00:00.000Z"),
  };

  const out = rechainActivity(SESSION, all, 45, 0, firstHalf);
  const untouched = out.filter((b) => !b.changed);
  assert.ok(untouched.length > 0);

  const original = rechainActivity(SESSION, all, 20, 0, { fromMs: 0, toMs: 0 });
  for (const b of untouched) {
    const same = original.find((o) => o.sequenceNo === b.sequenceNo)!;
    assert.equal(b.activityPct, same.activityPct, "figures unchanged");
    assert.notEqual(b.hash, same.hash, "but the hash moved, so it must be written back");
  }
});

test("no window rewrites the whole session", () => {
  const all = blocks("2026-08-31T08:00:00.000Z", 8, 20);
  const out = rechainActivity(SESSION, all, 45, 0);
  assert.ok(out.every((b) => b.activityPct === 45 && b.changed));
  assert.equal(verify(out).ok, true);
});

test("a window covering nothing changes nothing but still verifies", () => {
  const all = blocks("2026-08-31T08:00:00.000Z", 8, 20);
  const out = rechainActivity(SESSION, all, 45, 0, {
    fromMs: Date.parse("2026-09-05T00:00:00.000Z"),
    toMs: Date.parse("2026-09-06T00:00:00.000Z"),
  });
  assert.ok(out.every((b) => b.activityPct === 20 && !b.changed));
  assert.equal(verify(out).ok, true);
});

test("the rewritten day reads back at the requested percentage", () => {
  // Read through weightedActivity(), which is what the report actually calls —
  // the figure the user was looking at when they said it had not changed.
  const all = blocks("2026-08-30T22:00:00.000Z", 24, 20);
  const day2 = {
    fromMs: Date.parse("2026-08-31T00:00:00.000Z"),
    toMs: Date.parse("2026-09-01T00:00:00.000Z"),
  };
  const out = rechainActivity(SESSION, all, 45, 8, day2);

  const inDay2 = out
    .filter((b) => b.blockStart.getTime() >= day2.fromMs)
    .map((b) => ({
      activityPct: b.activityPct,
      creditedSeconds: 600,
      blockStart: b.blockStart,
      blockEnd: b.blockEnd,
    }));

  const measured = weightedActivity(inDay2);
  assert.ok(measured !== null);
  assert.ok(Math.abs(measured - 45) < 3, `expected ~45, got ${measured}`);

  // ...and the previous day is genuinely untouched, not merely close.
  const inDay1 = out
    .filter((b) => b.blockEnd.getTime() <= day2.fromMs)
    .map((b) => ({
      activityPct: b.activityPct,
      creditedSeconds: 600,
      blockStart: b.blockStart,
      blockEnd: b.blockEnd,
    }));
  assert.equal(weightedActivity(inDay1), 20);
});

test("a straddling block goes to whichever day holds most of it", () => {
  // A block stores ONE percentage for its whole span, so it cannot be half
  // rewritten. Majority assignment is what bounds the error — this is the case
  // that leaked 1.5pp into the previous day in production: the tracker sealed a
  // block spanning 18:37 to 07:24 across an idle machine.
  const window = {
    fromMs: Date.parse("2026-09-01T00:00:00.000Z"),
    toMs: Date.parse("2026-09-02T00:00:00.000Z"),
  };

  // 23:55 to 00:05 — two minutes before midnight, eight after. Mostly inside.
  const mostlyIn: ExistingBlock[] = [{
    id: "x", sequenceNo: 0,
    blockStart: new Date("2026-08-31T23:58:00.000Z"),
    blockEnd: new Date("2026-09-01T00:08:00.000Z"),
    keyboardPct: 12, mousePct: 8, activityPct: 20, idleSeconds: 0,
  }];
  assert.equal(rechainActivity(SESSION, mostlyIn, 45, 0, window)[0].changed, true);

  // 23:50 to 00:02 — ten minutes before midnight, two after. Mostly outside.
  const mostlyOut: ExistingBlock[] = [{
    id: "y", sequenceNo: 0,
    blockStart: new Date("2026-08-31T23:50:00.000Z"),
    blockEnd: new Date("2026-09-01T00:02:00.000Z"),
    keyboardPct: 12, mousePct: 8, activityPct: 20, idleSeconds: 0,
  }];
  const out = rechainActivity(SESSION, mostlyOut, 45, 0, window);
  assert.equal(out[0].changed, false, "left to the day that owns most of it");
  assert.equal(out[0].activityPct, 20);
});

test("a long block spanning an idle gap follows the same rule", () => {
  // The production case: sealed at 18:37, reopened at 07:24 the next morning.
  // Most of it lies in the second day, so that is where it belongs.
  const block: ExistingBlock[] = [{
    id: "z", sequenceNo: 0,
    blockStart: new Date("2026-08-30T18:37:00.000Z"),
    blockEnd: new Date("2026-08-31T07:24:00.000Z"),
    keyboardPct: 24, mousePct: 16, activityPct: 40, idleSeconds: 0,
  }];
  const day2 = {
    fromMs: Date.parse("2026-08-30T23:00:00.000Z"),
    toMs: Date.parse("2026-08-31T23:00:00.000Z"),
  };
  assert.equal(rechainActivity(SESSION, block, 88, 0, day2)[0].changed, true,
    "8h24m of it is in day 2 against 4h23m in day 1");
});
