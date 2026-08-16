/**
 * Tests for unusual-activity detection.
 *
 * The output of this module is an accusation against a named person, surfaced to
 * their admin as a fraud signal. A false positive here is not a cosmetic bug —
 * it is the product telling an employer that someone is faking their work. These
 * tests exist mostly to pin the cases where it must stay silent.
 */

import test from "node:test";
import assert from "node:assert/strict";
import type { ActivityBlock } from "@prisma/client";
import { detectAnomalies, type DetectedFlag } from "./anomaly";

const T0 = Date.UTC(2026, 7, 10, 9, 0, 0);

/** A block of `seconds` at `pct`, with keyboard/mouse defaulting to plausible. */
function blk(
  index: number,
  pct: number,
  seconds = 600,
  channels: { keyboardPct?: number; mousePct?: number } = {}
): ActivityBlock {
  const start = T0 + index * seconds * 1000;
  return {
    id: `b${index}`,
    sessionId: "s",
    blockStart: new Date(start),
    blockEnd: new Date(start + seconds * 1000),
    keyboardPct: channels.keyboardPct ?? pct / 2,
    mousePct: channels.mousePct ?? pct / 2,
    activityPct: pct,
    idleSeconds: 0,
    sequenceNo: index,
    prevHash: "p",
    hash: "h",
    creditedSeconds: seconds,
    suspendedSeconds: 0,
    clockSkewSeconds: 0,
    pauseDefinitionSecs: 3,
    createdAt: new Date(start),
  } as ActivityBlock;
}

const types = (blocks: ActivityBlock[]): DetectedFlag[] =>
  detectAnomalies(blocks).map((f) => f.type);

// ── absence of activity is not gaming ─────────────────────────────────────

test("a flat run of zeros is not flagged as robotic", () => {
  // Someone walked away for 40 minutes, or the input hook died. Either way this
  // is not a jiggler, and saying so accuses them of fraud for taking a break.
  const blocks = [0, 1, 2, 3].map((i) => blk(i, 0));
  assert.deepEqual(types(blocks), []);
});

test("a flat run just above the floor is still flagged", () => {
  // The rule must keep working where there is activity to be suspiciously flat.
  const blocks = [0, 1, 2, 3].map((i) => blk(i, 40));
  assert.ok(types(blocks).includes("low_variance_robotic"));
});

test("a genuinely steady jiggler signature is still caught", () => {
  const blocks = Array.from({ length: 9 }, (_, i) => blk(i, 62 + (i % 2)));
  assert.ok(types(blocks).includes("low_variance_robotic"));
});

// ── blocks are not ten minutes long ───────────────────────────────────────

test("short blocks do not fabricate a sustained-high-activity flag", () => {
  // Three project switches in a minute. Each finalizes a ~5s block, and a single
  // input second over a 5-second denominator scores 100%. Counting blocks and
  // multiplying by ten called this "30 minutes of sustained 100% activity".
  const blocks = [0, 1, 2].map((i) => blk(i, 100, 5));
  assert.deepEqual(types(blocks), []);
});

test("short blocks do not fabricate a robotic flag", () => {
  // Nine 5-second blocks all reading 100% used to report a "90-minute" robotic
  // window — 45 seconds of real time.
  const blocks = Array.from({ length: 9 }, (_, i) => blk(i, 100, 5));
  assert.ok(!types(blocks).includes("low_variance_robotic"));
});

test("sustained high activity is flagged on real elapsed time", () => {
  // Three genuine 10-minute blocks at 100% is a real 30 minutes.
  const blocks = [0, 1, 2].map((i) => blk(i, 100));
  const flags = detectAnomalies(blocks);
  const high = flags.find((f) => f.type === "sustained_high_activity");
  assert.ok(high);
  assert.equal(high.details.minutes, 30);
});

test("reported minutes reflect real duration, not a block count", () => {
  // Six 5-minute blocks at 100% = 30 real minutes.
  const blocks = Array.from({ length: 6 }, (_, i) => blk(i, 100, 300));
  const high = detectAnomalies(blocks).find((f) => f.type === "sustained_high_activity");
  assert.ok(high);
  assert.equal(high.details.minutes, 30);
});

// ── channel imbalance ─────────────────────────────────────────────────────

test("mouse active with a silent keyboard is flagged after 50 real minutes", () => {
  const blocks = Array.from({ length: 5 }, (_, i) =>
    blk(i, 50, 600, { mousePct: 50, keyboardPct: 0 })
  );
  assert.ok(types(blocks).includes("input_channel_imbalance"));
});

test("a short imbalanced run is not flagged", () => {
  const blocks = Array.from({ length: 5 }, (_, i) =>
    blk(i, 50, 30, { mousePct: 50, keyboardPct: 0 })
  );
  assert.ok(!types(blocks).includes("input_channel_imbalance"));
});

test("balanced input is never flagged as imbalanced", () => {
  const blocks = Array.from({ length: 8 }, (_, i) =>
    blk(i, 50, 600, { mousePct: 30, keyboardPct: 25 })
  );
  assert.ok(!types(blocks).includes("input_channel_imbalance"));
});

// ── degenerate input ──────────────────────────────────────────────────────

test("no blocks means no flags", () => {
  assert.deepEqual(types([]), []);
});

test("blocks with no usable duration are ignored, not counted as one unit", () => {
  const zero = { ...blk(0, 100, 600), creditedSeconds: 0, blockEnd: new Date(T0) };
  assert.deepEqual(types([zero as ActivityBlock]), []);
});

test("ordinary varied work triggers nothing", () => {
  const blocks = [35, 52, 18, 61, 44, 29, 70, 40, 55].map((pct, i) => blk(i, pct));
  assert.deepEqual(types(blocks), []);
});
