/**
 * Tests for the abandoned-session sweeper.
 *
 * This is the only code in the product that rewrites a recorded end time, so its
 * predicate matters more than its plumbing: closing a live session would cut
 * someone's timer off mid-shift, and failing to close a dead one leaves the
 * original bug in place. Prisma is stubbed rather than reached — the real client
 * points at a live cluster that runs DDL on connect.
 */

import test from "node:test";
import assert from "node:assert/strict";
import type { PrismaClient } from "@prisma/client";
import { STALE_GRACE_MS } from "./duration";
import { sweepStaleSessions } from "./stale-sessions";

const NOW = new Date("2026-08-12T09:07:09.000Z");
const before = (ms: number) => new Date(NOW.getTime() - ms);
const mins = (n: number) => n * 60_000;
const hours = (n: number) => n * 3_600_000;

type Row = {
  id: string;
  userId: string | null;
  startedAt: Date;
  lastSyncAt: Date | null;
  activityBlocks: { blockEnd: Date }[];
};

type Update = { id: string; endedAt: Date; endReason: string };

/**
 * Minimal stand-in for Prisma. `findMany` honours the `startedAt` floor the real
 * query applies so the test exercises the same two-stage filter (SQL predicate,
 * then evidence check) rather than only the JS half.
 */
function fakeDb(rows: Row[], opts: { alreadyClosed?: Set<string> } = {}) {
  const updates: Update[] = [];
  const db = {
    trackingSession: {
      findMany: async (args: { where: { startedAt: { lt: Date } } }) =>
        rows.filter((r) => r.startedAt < args.where.startedAt.lt),
      updateMany: async (args: { where: { id: string }; data: { endedAt: Date; endReason: string } }) => {
        if (opts.alreadyClosed?.has(args.where.id)) return { count: 0 };
        updates.push({ id: args.where.id, ...args.data });
        return { count: 1 };
      },
    },
  } as unknown as PrismaClient;
  return { db, updates };
}

function row(over: Partial<Row> & { id: string }): Row {
  return {
    userId: "u1",
    startedAt: before(hours(40)),
    lastSyncAt: null,
    activityBlocks: [],
    ...over,
  };
}

test("closes an abandoned session at its last evidence, as abrupt_exit", () => {
  const startedAt = new Date("2026-08-10T17:10:00.000Z");
  const lastBeat = new Date("2026-08-10T17:22:00.000Z");
  const { db, updates } = fakeDb([
    row({ id: "dead", startedAt, lastSyncAt: lastBeat }),
  ]);

  return sweepStaleSessions(db, NOW).then((r) => {
    assert.equal(r.closed, 1);
    assert.deepEqual(r.ids, ["dead"]);
    assert.equal(updates.length, 1);
    assert.equal(updates[0].endedAt.getTime(), lastBeat.getTime());
    // Never `stopped` — the member didn't stop this, the app died. Recording it as
    // a clean stop is what made the original 39-hour phantom undetectable.
    assert.equal(updates[0].endReason, "abrupt_exit");
  });
});

test("leaves a live session alone", async () => {
  const { db, updates } = fakeDb([
    row({ id: "live", startedAt: before(hours(3)), lastSyncAt: before(mins(1)) }),
  ]);
  const r = await sweepStaleSessions(db, NOW);
  assert.equal(r.closed, 0);
  assert.equal(updates.length, 0);
});

test("leaves a session inside the grace window alone", async () => {
  // One missed heartbeat. Cutting this off would end a real shift early.
  const { db, updates } = fakeDb([
    row({
      id: "quiet",
      startedAt: before(hours(2)),
      lastSyncAt: before(STALE_GRACE_MS - 10_000),
    }),
  ]);
  const r = await sweepStaleSessions(db, NOW);
  assert.equal(r.closed, 0);
  assert.equal(updates.length, 0);
});

test("never touches a session younger than the grace window", async () => {
  // The desktop app is offline-first: it can register a session before it has had
  // any chance to heartbeat, and that must not read as abandoned.
  const { db, updates } = fakeDb([row({ id: "fresh", startedAt: before(5_000) })]);
  const r = await sweepStaleSessions(db, NOW);
  assert.equal(r.scanned, 0);
  assert.equal(updates.length, 0);
});

test("uses the newest witness, so recent blocks keep a session open", async () => {
  // Heartbeat is ancient but capture was producing work a minute ago — a device
  // that can write blocks but not reach /heartbeat is still working.
  const { db, updates } = fakeDb([
    row({
      id: "working",
      startedAt: before(hours(5)),
      lastSyncAt: before(hours(4)),
      activityBlocks: [{ blockEnd: before(mins(1)) }],
    }),
  ]);
  const r = await sweepStaleSessions(db, NOW);
  assert.equal(r.closed, 0);
  assert.equal(updates.length, 0);
});

test("a session with no evidence at all closes at its own start", async () => {
  const startedAt = before(hours(30));
  const { db, updates } = fakeDb([row({ id: "orphan", startedAt })]);
  const r = await sweepStaleSessions(db, NOW);
  assert.equal(r.closed, 1);
  // Zero duration, not thirty hours.
  assert.equal(updates[0].endedAt.getTime(), startedAt.getTime());
});

test("a row closed by someone else in the meantime is not overwritten", async () => {
  // Two instances sweeping, or a real /stop landing late. The `endedAt: null`
  // predicate must win, so a truthful end time is never replaced by an estimate.
  const { db, updates } = fakeDb(
    [row({ id: "raced", lastSyncAt: before(hours(20)) })],
    { alreadyClosed: new Set(["raced"]) }
  );
  const r = await sweepStaleSessions(db, NOW);
  assert.equal(r.scanned, 1);
  assert.equal(r.closed, 0);
  assert.deepEqual(r.ids, []);
  assert.equal(updates.length, 0);
});

test("sweeps a mixed batch, closing only the dead", async () => {
  const { db, updates } = fakeDb([
    row({ id: "live", startedAt: before(hours(1)), lastSyncAt: before(mins(1)) }),
    row({ id: "dead-a", lastSyncAt: before(hours(38)) }),
    row({ id: "dead-b", lastSyncAt: before(hours(12)) }),
  ]);
  const r = await sweepStaleSessions(db, NOW);
  assert.equal(r.closed, 2);
  assert.deepEqual(r.ids.sort(), ["dead-a", "dead-b"]);
  assert.deepEqual(
    updates.map((u) => u.id).sort(),
    ["dead-a", "dead-b"]
  );
});

// ── the outage cases: closing early is what destroyed real work ────────────

test("a network outage does not end a session that is still being worked", async () => {
  // The reported failure. Wifi drops at 09:10; the tracker is offline-first and
  // keeps recording locally; the member works until 17:00. At the old 150-second
  // threshold the sweeper closed the row at 09:10 and nothing ever reopened it,
  // so the timesheet said ten minutes while the screenshots said eight hours.
  const { db, updates } = fakeDb([
    row({ id: "offline", startedAt: before(hours(1)), lastSyncAt: before(mins(10)) }),
  ]);
  const r = await sweepStaleSessions(db, NOW);
  assert.equal(r.closed, 0);
  assert.equal(updates.length, 0);
});

test("a backend deploy does not close every session that was tracking", async () => {
  // The sweeper runs on boot. At 150 seconds, any deploy slower than that closed
  // the whole table at its pre-deploy evidence — org-wide, every release.
  const rows = Array.from({ length: 5 }, (_, i) =>
    row({ id: `tracking-${i}`, startedAt: before(hours(2)), lastSyncAt: before(mins(4)) })
  );
  const { db, updates } = fakeDb(rows);
  const r = await sweepStaleSessions(db, NOW);
  assert.equal(r.closed, 0);
  assert.equal(updates.length, 0);
});

test("a long lunch with the laptop shut does not end the session", async () => {
  const { db, updates } = fakeDb([
    row({ id: "lunch", startedAt: before(hours(4)), lastSyncAt: before(mins(90)) }),
  ]);
  assert.equal((await sweepStaleSessions(db, NOW)).closed, 0);
  assert.equal(updates.length, 0);
});

test("a genuinely abandoned session is still closed, at its last evidence", async () => {
  // The sweeper must not become a no-op: an app killed overnight still has to be
  // closed, or the original unbounded-session bug returns.
  const lastBeat = before(hours(9));
  const { db, updates } = fakeDb([
    row({ id: "dead", startedAt: before(hours(10)), lastSyncAt: lastBeat }),
  ]);
  const r = await sweepStaleSessions(db, NOW);
  assert.equal(r.closed, 1);
  assert.equal(updates[0].endedAt.getTime(), lastBeat.getTime());
  assert.equal(updates[0].endReason, "abrupt_exit");
});

test("the threshold sits between an outage and an abandonment", async () => {
  // Anything under the window survives; anything past it is closed. Pinned so a
  // future tweak has to be deliberate about which side real outages fall on.
  const { db: quiet } = fakeDb([row({ id: "q", startedAt: before(hours(8)), lastSyncAt: before(hours(5)) })]);
  assert.equal((await sweepStaleSessions(quiet, NOW)).closed, 0);

  const { db: gone } = fakeDb([row({ id: "g", startedAt: before(hours(8)), lastSyncAt: before(hours(7)) })]);
  assert.equal((await sweepStaleSessions(gone, NOW)).closed, 1);
});

test("one device's live session cannot keep another session immortal", async () => {
  // Evidence is per-session now. Two open rows on one machine used to share the
  // Device row, so the live one's heartbeat testified that the dead one was also
  // alive — it could never be swept and grew by sixty seconds a minute while
  // double-counting the live session's hours.
  const { db, updates } = fakeDb([
    row({ id: "live", startedAt: before(hours(2)), lastSyncAt: before(mins(1)) }),
    row({ id: "stale-same-device", startedAt: before(hours(30)), lastSyncAt: before(hours(29)) }),
  ]);
  const r = await sweepStaleSessions(db, NOW);
  assert.deepEqual(r.ids, ["stale-same-device"]);
  assert.equal(updates.length, 1);
});
