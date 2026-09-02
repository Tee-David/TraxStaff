/**
 * Tests for the tamper-evident chain.
 *
 * The distinction these pin is the whole point of the module: an ALTERED block
 * is proof that stored data was edited, while a MISSING block is the ordinary
 * state of an offline-first client whose queue flushes out of order. Conflating
 * the two put a permanent red "Flagged" badge on honest sessions for the crime
 * of a three-second network blip.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { GENESIS, canonical, computeHash, verifyChain, type ChainBlock } from "./hashchain";

const SESSION = "0f9d8c7b-6a5e-4d3c-2b1a-0f9e8d7c6b5a";

function block(seq: number, pct = 50): ChainBlock {
  const start = Date.UTC(2026, 7, 10, 9, 0, 0) + seq * 600_000;
  return {
    sessionId: SESSION,
    sequenceNo: seq,
    blockStart: new Date(start).toISOString(),
    blockEnd: new Date(start + 600_000).toISOString(),
    keyboardPct: pct / 2,
    mousePct: pct / 2,
    activityPct: pct,
    idleSeconds: 600 - Math.round((pct / 100) * 600),
  };
}

/** A correctly-chained run of `n` blocks. */
function chain(n: number): (ChainBlock & { prevHash: string; hash: string })[] {
  let prevHash = GENESIS;
  return Array.from({ length: n }, (_, i) => {
    const b = block(i);
    const hash = computeHash(prevHash, b);
    const row = { ...b, prevHash, hash };
    prevHash = hash;
    return row;
  });
}

test("an intact chain verifies", () => {
  const r = verifyChain(chain(5), GENESIS, 0);
  assert.equal(r.ok, true);
  assert.equal(r.altered, false);
  assert.equal(r.incomplete, false);
  assert.deepEqual(r.reasons, []);
});

test("a missing block reads as incomplete, not as tampering", () => {
  // Block 1's POST hit a network blip and is still queued on the client. Blocks
  // 0 and 2 are stored. This is normal, expected, and self-correcting.
  const full = chain(4);
  const withHole = [full[0], full[2], full[3]];

  const r = verifyChain(withHole, GENESIS, 0);
  assert.equal(r.incomplete, true);
  assert.equal(r.altered, false, "a gap is not evidence that anything was edited");
  assert.equal(r.ok, false);
});

test("the gap resolves itself once the missing block arrives", () => {
  const full = chain(4);
  assert.equal(verifyChain([full[0], full[2], full[3]], GENESIS, 0).incomplete, true);
  // Same session, once the queue drains.
  assert.equal(verifyChain(full, GENESIS, 0).incomplete, false);
  assert.equal(verifyChain(full, GENESIS, 0).ok, true);
});

test("editing a stored block's activity is detected as alteration", () => {
  const rows = chain(4);
  rows[2] = { ...rows[2], activityPct: 99 };

  const r = verifyChain(rows, GENESIS, 0);
  assert.equal(r.altered, true);
  assert.ok(r.reasons.some((x) => x.includes("hash mismatch")));
});

test("editing a block's timestamps is detected as alteration", () => {
  const rows = chain(3);
  rows[1] = { ...rows[1], blockEnd: new Date(Date.UTC(2026, 8, 15)).toISOString() };
  assert.equal(verifyChain(rows, GENESIS, 0).altered, true);
});

test("alteration is detected even when the chain is also incomplete", () => {
  const full = chain(5);
  const rows = [full[0], { ...full[2], activityPct: 100 }, full[3]];
  const r = verifyChain(rows, GENESIS, 0);
  assert.equal(r.altered, true);
  assert.equal(r.incomplete, true);
});

test("a chain restarted at sequence zero is incomplete, not altered", () => {
  // What a client restart produces today: a second run of blocks beginning again
  // at seq 0 from GENESIS. Every block is internally valid, so this is a
  // delivery/sequencing problem rather than an accusation.
  const first = chain(3);
  const second = chain(2);
  const r = verifyChain([...first, ...second], GENESIS, 0);
  assert.equal(r.altered, false);
  assert.equal(r.incomplete, true);
});

test("an empty chain is trivially valid", () => {
  const r = verifyChain([], GENESIS, 0);
  assert.equal(r.ok, true);
  assert.equal(r.altered, false);
  assert.equal(r.incomplete, false);
});

test("canonical is stable and order-sensitive across its fields", () => {
  const b = block(1);
  assert.equal(canonical(b), canonical({ ...b }));
  assert.notEqual(canonical(b), canonical({ ...b, activityPct: b.activityPct + 1 }));
  assert.notEqual(canonical(b), canonical({ ...b, sequenceNo: 2 }));
});

test("canonical pins the wire format the Rust client must reproduce", () => {
  // Both sides format numbers to exactly two decimals, timestamps as ISO-8601
  // UTC with milliseconds, joined by pipes. A drift here silently flags every
  // block from every client as altered, so the shape is asserted literally.
  const b: ChainBlock = {
    sessionId: SESSION,
    sequenceNo: 7,
    blockStart: "2026-08-10T09:00:00.000Z",
    blockEnd: "2026-08-10T09:10:00.000Z",
    keyboardPct: 31,
    mousePct: 24.5,
    activityPct: 47.25,
    idleSeconds: 317,
  };
  assert.equal(
    canonical(b),
    `${SESSION}|7|2026-08-10T09:00:00.000Z|2026-08-10T09:10:00.000Z|31.00|24.50|47.25|317`
  );
});
