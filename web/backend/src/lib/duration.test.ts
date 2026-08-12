/**
 * Tests for the one place session durations are computed.
 *
 * Uses node:test + tsx, both already present — no new dependency for the sake of
 * one file. Run with `npm test` in web/backend.
 *
 * This is the arithmetic that decides what a person is paid for. It is also the
 * arithmetic whose failure is invisible: a wrong total looks like a plausible
 * total, which is why a phantom 44h58m sat on a dashboard being read as real.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  STALE_GRACE_MS,
  effectiveEnd,
  grossSeconds,
  isAbandoned,
  lastEvidenceAt,
  latestBlockEnd,
  overlapSeconds,
  overlapsRange,
  workedSeconds,
  workedSecondsInRange,
} from "./duration";

const NOW = new Date("2026-08-12T09:07:09.000Z"); // the Wednesday from the report
const mins = (n: number) => n * 60_000;
const hours = (n: number) => n * 3_600_000;
const before = (msAgo: number) => new Date(NOW.getTime() - msAgo);

test("a live session with a fresh heartbeat runs to now", () => {
  const s = {
    startedAt: before(mins(7)),
    endedAt: null,
    device: { lastSeenAt: before(mins(1)) },
  };
  assert.equal(effectiveEnd(s, NOW).getTime(), NOW.getTime());
  assert.equal(Math.round(grossSeconds(s, NOW)), 420);
  assert.equal(isAbandoned(s, NOW), false);
});

test("a session still inside the grace window is not yet abandoned", () => {
  // Two minutes since the last beat: one missed beat, still trusted.
  const s = { startedAt: before(mins(30)), endedAt: null, device: { lastSeenAt: before(mins(2)) } };
  assert.equal(isAbandoned(s, NOW), false);
  assert.equal(effectiveEnd(s, NOW).getTime(), NOW.getTime());
});

test("an abandoned session is pinned to its last evidence, not to now", () => {
  // The reported bug: opened Monday 17:10, machine shut down, reopened Wednesday.
  const startedAt = new Date("2026-08-10T17:10:00.000Z");
  const lastBeat = new Date("2026-08-10T17:22:00.000Z");
  const s = { startedAt, endedAt: null, device: { lastSeenAt: lastBeat } };

  assert.equal(isAbandoned(s, NOW), true);
  assert.equal(effectiveEnd(s, NOW).getTime(), lastBeat.getTime() + STALE_GRACE_MS);
  // 12 minutes of real work plus the grace window — not the 39h50m it used to claim.
  assert.equal(Math.round(grossSeconds(s, NOW)), 12 * 60 + STALE_GRACE_MS / 1000);
  assert.ok(grossSeconds(s, NOW) < hours(1) / 1000);
});

test("the strongest witness wins, whichever it is", () => {
  const startedAt = before(hours(40));
  const beat = before(hours(39));
  const sync = before(hours(20));
  const block = before(hours(30));
  const s = {
    startedAt,
    endedAt: null,
    device: { lastSeenAt: beat },
    lastSyncAt: sync,
    latestBlockEnd: block,
  };
  // lastSyncAt is the most recent of the three.
  assert.equal(lastEvidenceAt(s).getTime(), sync.getTime());
});

test("a session that died before its first heartbeat never goes negative", () => {
  // device.lastSeenAt predates startedAt — a device registered, then the session
  // began, then the app was killed before it could beat.
  const startedAt = before(hours(30));
  const s = { startedAt, endedAt: null, device: { lastSeenAt: before(hours(31)) } };
  assert.equal(lastEvidenceAt(s).getTime(), startedAt.getTime());
  assert.ok(grossSeconds(s, NOW) >= 0);
  assert.equal(Math.round(grossSeconds(s, NOW)), STALE_GRACE_MS / 1000);
});

test("a closed session is its own authority and ignores stale evidence", () => {
  const startedAt = before(hours(3));
  const endedAt = before(hours(1));
  const s = { startedAt, endedAt, device: { lastSeenAt: before(hours(2)) } };
  assert.equal(effectiveEnd(s, NOW).getTime(), endedAt.getTime());
  assert.equal(Math.round(grossSeconds(s, NOW)), 7200);
  assert.equal(isAbandoned(s, NOW), false);
});

test("endedAt before startedAt clamps to zero rather than going negative", () => {
  // Legacy rows written before start reconciliation existed. An unclamped value
  // propagated into every total and formatter — this is where "-1:-1:-1" came from.
  const s = { startedAt: before(hours(1)), endedAt: before(hours(2)) };
  assert.equal(grossSeconds(s, NOW), 0);
  assert.equal(effectiveEnd(s, NOW).getTime(), s.startedAt.getTime());
});

test("worked time subtracts discarded idle; gross does not", () => {
  const s = {
    startedAt: before(hours(2)),
    endedAt: before(hours(1)),
    idleDiscards: [{ seconds: 600 }, { seconds: 300 }],
  };
  assert.equal(Math.round(grossSeconds(s, NOW)), 3600);
  assert.equal(Math.round(workedSeconds(s, NOW)), 2700);
});

test("discards larger than the session clamp to zero, not below", () => {
  const s = {
    startedAt: before(mins(10)),
    endedAt: before(mins(5)),
    idleDiscards: [{ seconds: 99999 }],
  };
  assert.equal(workedSeconds(s, NOW), 0);
});

test("overlap splits a session across a day boundary", () => {
  // 23:00 Tue → 03:00 Wed: one hour to Tuesday, three to Wednesday.
  const s = {
    startedAt: new Date("2026-08-11T23:00:00.000Z"),
    endedAt: new Date("2026-08-12T03:00:00.000Z"),
  };
  const tueStart = new Date("2026-08-11T00:00:00.000Z").getTime();
  const wedStart = new Date("2026-08-12T00:00:00.000Z").getTime();
  const thuStart = new Date("2026-08-13T00:00:00.000Z").getTime();

  assert.equal(overlapSeconds(s, tueStart, wedStart, NOW), 3600);
  assert.equal(overlapSeconds(s, wedStart, thuStart, NOW), 10800);
  // The two slices must add up to the whole, with nothing lost or double-counted.
  assert.equal(
    overlapSeconds(s, tueStart, wedStart, NOW) + overlapSeconds(s, wedStart, thuStart, NOW),
    grossSeconds(s, NOW)
  );
});

test("overlap of an abandoned session is bounded by its evidence", () => {
  // This is the "Tracked today = time since midnight" symptom. The session died
  // Monday, so today's slice must be zero — not midnight-to-now.
  const s = {
    startedAt: new Date("2026-08-10T17:10:00.000Z"),
    endedAt: null,
    device: { lastSeenAt: new Date("2026-08-10T17:22:00.000Z") },
  };
  const todayStart = new Date("2026-08-12T00:00:00.000Z").getTime();
  assert.equal(overlapSeconds(s, todayStart, NOW.getTime(), NOW), 0);
});

test("overlap outside the window is zero, never negative", () => {
  const s = { startedAt: before(hours(50)), endedAt: before(hours(49)) };
  const todayStart = new Date("2026-08-12T00:00:00.000Z").getTime();
  assert.equal(overlapSeconds(s, todayStart, NOW.getTime(), NOW), 0);
});

test("workedSecondsInRange clips a session that began before the window", () => {
  // Sunday 22:00 → Monday 02:00. A Monday-onward report owns two of those hours.
  const s = {
    startedAt: new Date("2026-08-09T22:00:00.000Z"),
    endedAt: new Date("2026-08-10T02:00:00.000Z"),
  };
  const monday = new Date("2026-08-10T00:00:00.000Z").getTime();
  assert.equal(workedSecondsInRange(s, monday, Infinity, NOW), 7200);
  // Unbounded, it is the whole four hours — i.e. clipping is what the range does.
  assert.equal(workedSecondsInRange(s, -Infinity, Infinity, NOW), 14400);
});

test("workedSecondsInRange charges a discard to the window it happened in", () => {
  // 4h span (22:00 Sun → 02:00 Mon) with the 23:00–00:00 hour discarded. That hour
  // is entirely on Sunday, so Monday keeps all of its two hours.
  const s = {
    startedAt: new Date("2026-08-09T22:00:00.000Z"),
    endedAt: new Date("2026-08-10T02:00:00.000Z"),
    idleDiscards: [
      { seconds: 3600, from: new Date("2026-08-09T23:00:00.000Z"), to: new Date("2026-08-10T00:00:00.000Z") },
    ],
  };
  const sunday = new Date("2026-08-09T00:00:00.000Z").getTime();
  const monday = new Date("2026-08-10T00:00:00.000Z").getTime();
  assert.equal(workedSecondsInRange(s, monday, Infinity, NOW), 7200);
  // Sunday held 2h of clock, 1h of it discarded.
  assert.equal(workedSecondsInRange(s, sunday, monday, NOW), 3600);
});

test("a multi-day hole lands on the days it spans, not on the day of real work", () => {
  // The reported incident in miniature: tracked Mon 16:00–17:00, app closed without
  // stopping, reopened Wed 09:00 and tracked to 16:00. The 40h hole is deducted.
  //
  // Spreading that hole proportionally instead reported Wednesday's seven real hours
  // as under three, and still credited Tuesday — when the app was not running at
  // all — with hours.
  const s = {
    startedAt: new Date("2026-08-10T16:00:00.000Z"),
    endedAt: new Date("2026-08-12T16:00:00.000Z"),
    idleDiscards: [
      {
        // Mon 17:00 → Wed 09:00 = exactly 40h.
        seconds: 144_000,
        from: new Date("2026-08-10T17:00:00.000Z"),
        to: new Date("2026-08-12T09:00:00.000Z"),
      },
    ],
  };
  const mon = new Date("2026-08-10T00:00:00.000Z").getTime();
  const tue = new Date("2026-08-11T00:00:00.000Z").getTime();
  const wed = new Date("2026-08-12T00:00:00.000Z").getTime();
  const thu = new Date("2026-08-13T00:00:00.000Z").getTime();

  assert.equal(workedSecondsInRange(s, mon, tue, NOW), 3600); // the real hour
  assert.equal(workedSecondsInRange(s, tue, wed, NOW), 0); // nothing happened
  assert.equal(workedSecondsInRange(s, wed, thu, NOW), 25_200); // 09:00–16:00
  // And the days still sum to the session's own worked total.
  assert.equal(
    workedSecondsInRange(s, mon, tue, NOW) +
      workedSecondsInRange(s, tue, wed, NOW) +
      workedSecondsInRange(s, wed, thu, NOW),
    workedSeconds(s, NOW)
  );
});

test("a discard with no span recorded still falls back to spreading", () => {
  // Rows written before spans existed. 4h span, 1h discarded, half in range → 1.5h.
  const s = {
    startedAt: new Date("2026-08-09T22:00:00.000Z"),
    endedAt: new Date("2026-08-10T02:00:00.000Z"),
    idleDiscards: [{ seconds: 3600 }],
  };
  const monday = new Date("2026-08-10T00:00:00.000Z").getTime();
  assert.equal(workedSecondsInRange(s, monday, Infinity, NOW), 5400);
});

test("workedSecondsInRange is zero outside the window", () => {
  const s = { startedAt: before(hours(50)), endedAt: before(hours(49)) };
  const todayStart = new Date("2026-08-12T00:00:00.000Z").getTime();
  assert.equal(workedSecondsInRange(s, todayStart, NOW.getTime(), NOW), 0);
});

test("range slices of one session sum to its worked total", () => {
  // The invariant that makes per-day charts trustworthy: no time invented, none
  // lost, however the window is cut.
  const s = {
    startedAt: new Date("2026-08-11T23:00:00.000Z"),
    endedAt: new Date("2026-08-12T03:00:00.000Z"),
    idleDiscards: [{ seconds: 1800 }],
  };
  const tue = new Date("2026-08-11T00:00:00.000Z").getTime();
  const wed = new Date("2026-08-12T00:00:00.000Z").getTime();
  const thu = new Date("2026-08-13T00:00:00.000Z").getTime();
  const sum =
    workedSecondsInRange(s, tue, wed, NOW) + workedSecondsInRange(s, wed, thu, NOW);
  assert.ok(Math.abs(sum - workedSeconds(s, NOW)) < 1e-6);
});

test("latestBlockEnd picks the newest, and tolerates nothing loaded", () => {
  assert.equal(latestBlockEnd(undefined), null);
  assert.equal(latestBlockEnd([]), null);
  const newest = before(mins(5));
  assert.equal(
    latestBlockEnd([{ blockEnd: before(mins(30)) }, { blockEnd: newest }, { blockEnd: before(mins(20)) }])!.getTime(),
    newest.getTime()
  );
});

test("overlapsRange admits a session that began before the window", () => {
  const from = new Date("2026-08-10T00:00:00.000Z");
  const to = new Date("2026-08-16T00:00:00.000Z");
  const clauses = overlapsRange(from, to);
  // Must constrain the start by the window's END and let an open or later-ending
  // session through — filtering on startedAt >= from is what dropped night shifts.
  assert.deepEqual(clauses, [
    { startedAt: { lte: to } },
    { OR: [{ endedAt: null }, { endedAt: { gte: from } }] },
  ]);
  assert.deepEqual(overlapsRange(undefined, undefined), []);
});
