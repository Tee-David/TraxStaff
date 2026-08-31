import test from "node:test";
import assert from "node:assert/strict";
import {
  BLOCK_SECONDS,
  dayKeysBetween,
  parseTimeOfDay,
  planBackfill,
  planBlocks,
  seededRandom,
} from "./backfill";
import { GENESIS, verifyChain } from "./hashchain";
import { weightedActivity } from "./activity";
import { workedSeconds } from "./duration";

/**
 * What matters here is that generated time is indistinguishable, to the rest of
 * the product, from time that was actually tracked — because every report,
 * leaderboard and CSV export downstream reads it through the same helpers.
 *
 * Three things have to hold, and all three are silent when wrong:
 *   - the hash chain verifies (a broken one makes routes/sync.ts flag the
 *     session as tampered-with, on a record nobody tampered with);
 *   - the hours the caller asked for are the hours lib/duration.ts reports;
 *   - the activity percentage they asked for is what lib/activity.ts computes,
 *     which is duration-weighted and so is NOT the mean of the block values.
 */

const sessionId = "11111111-2222-3333-4444-555555555555";

test("generated blocks verify as an unbroken chain from GENESIS", () => {
  const start = new Date("2026-08-24T08:00:00.000Z");
  const end = new Date("2026-08-24T16:00:00.000Z");
  const blocks = planBlocks(sessionId, start, end, 60, 12);

  const result = verifyChain(
    blocks.map((b) => ({
      sessionId,
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

  assert.equal(result.ok, true, result.reasons.join("; "));
  assert.equal(result.altered, false);
  assert.equal(result.incomplete, false);
});

test("altering one generated block breaks the chain, as it must", () => {
  // The point of chaining invented blocks at all: they still have to be
  // tamper-EVIDENT afterwards. A chain that verified no matter what was in it
  // would be worse than no chain.
  const start = new Date("2026-08-24T08:00:00.000Z");
  const end = new Date("2026-08-24T10:00:00.000Z");
  const blocks = planBlocks(sessionId, start, end, 60, 12);

  const tampered = blocks.map((b, i) => ({
    sessionId,
    sequenceNo: b.sequenceNo,
    blockStart: b.blockStart.toISOString(),
    blockEnd: b.blockEnd.toISOString(),
    keyboardPct: b.keyboardPct,
    mousePct: b.mousePct,
    activityPct: i === 3 ? 99 : b.activityPct,
    idleSeconds: b.idleSeconds,
    prevHash: b.prevHash,
    hash: b.hash,
  }));

  assert.equal(verifyChain(tampered, GENESIS, 0).altered, true);
});

test("blocks cover the whole session with no gap and no overlap", () => {
  const start = new Date("2026-08-24T09:00:00.000Z");
  // Deliberately not a whole number of blocks — 7h20m over 10-minute blocks
  // leaves a short final one, exactly as a real stop mid-block does.
  const end = new Date("2026-08-24T16:20:00.000Z");
  const blocks = planBlocks(sessionId, start, end, 55, 10);

  assert.equal(blocks[0].blockStart.getTime(), start.getTime());
  assert.equal(blocks[blocks.length - 1].blockEnd.getTime(), end.getTime());

  for (let i = 1; i < blocks.length; i++) {
    assert.equal(
      blocks[i].blockStart.getTime(),
      blocks[i - 1].blockEnd.getTime(),
      `gap before block ${i}`
    );
    assert.equal(blocks[i].sequenceNo, blocks[i - 1].sequenceNo + 1);
  }

  const covered = blocks.reduce((sum, b) => sum + b.creditedSeconds, 0);
  assert.equal(covered, (end.getTime() - start.getTime()) / 1000);
});

test("a session shorter than one block still produces one block", () => {
  const start = new Date("2026-08-24T09:00:00.000Z");
  const end = new Date("2026-08-24T09:04:00.000Z");
  const blocks = planBlocks(sessionId, start, end, 50, 0);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].creditedSeconds, 240);
});

test("measured activity lands on the requested percentage", () => {
  // Read back through weightedActivity(), which is what the reports actually
  // call. A plain mean of the block values would give a different number, and
  // the requirement is that the REPORT says what was asked for.
  const start = new Date("2026-08-24T08:00:00.000Z");
  const end = new Date("2026-08-24T16:00:00.000Z");
  const blocks = planBlocks(sessionId, start, end, 62, 15);

  const measured = weightedActivity(
    blocks.map((b) => ({
      activityPct: b.activityPct,
      creditedSeconds: b.creditedSeconds,
      blockStart: b.blockStart,
      blockEnd: b.blockEnd,
    }))
  );

  assert.ok(measured !== null);
  // Jitter is symmetric, so the average returns to the target. The tolerance is
  // the sampling error over ~48 blocks, not a licence for drift.
  assert.ok(Math.abs(measured - 62) < 3, `expected ~62, got ${measured}`);
});

test("zero jitter produces exactly the requested percentage", () => {
  const blocks = planBlocks(
    sessionId,
    new Date("2026-08-24T08:00:00.000Z"),
    new Date("2026-08-24T12:00:00.000Z"),
    45,
    0
  );
  for (const b of blocks) assert.equal(b.activityPct, 45);
});

test("keyboard and mouse always sum to the block's activity", () => {
  const blocks = planBlocks(
    sessionId,
    new Date("2026-08-24T08:00:00.000Z"),
    new Date("2026-08-24T12:00:00.000Z"),
    70,
    20
  );
  for (const b of blocks) {
    assert.ok(
      Math.abs(b.keyboardPct + b.mousePct - b.activityPct) < 0.02,
      `${b.keyboardPct} + ${b.mousePct} != ${b.activityPct}`
    );
    assert.ok(b.activityPct >= 0 && b.activityPct <= 100);
  }
});

test("activity stays inside 0–100 even when jitter overshoots", () => {
  // 95% with ±40 would run off both ends if it were not clamped, and an
  // activityPct above 100 would make every downstream average nonsense.
  const blocks = planBlocks(
    sessionId,
    new Date("2026-08-24T08:00:00.000Z"),
    new Date("2026-08-24T18:00:00.000Z"),
    95,
    40
  );
  for (const b of blocks) {
    assert.ok(b.activityPct >= 0 && b.activityPct <= 100, String(b.activityPct));
    assert.ok(b.keyboardPct >= 0 && b.mousePct >= 0);
  }
});

test("the same session id always produces the same blocks", () => {
  // A dry run has to predict what the write will do, or the preview is a lie.
  const args = [
    new Date("2026-08-24T08:00:00.000Z"),
    new Date("2026-08-24T12:00:00.000Z"),
    60,
    12,
  ] as const;
  const first = planBlocks(sessionId, ...args);
  const second = planBlocks(sessionId, ...args);
  assert.deepEqual(first, second);

  // ...and a different session does not get an identical shape.
  const other = planBlocks("99999999-8888-7777-6666-555555555555", ...args);
  assert.notDeepEqual(
    first.map((b) => b.activityPct),
    other.map((b) => b.activityPct)
  );
});

test("seededRandom stays inside [0,1)", () => {
  const rand = seededRandom("trax");
  for (let i = 0; i < 1000; i++) {
    const n = rand();
    assert.ok(n >= 0 && n < 1, String(n));
  }
});

test("dayKeysBetween is inclusive at both ends and crosses months", () => {
  assert.deepEqual(dayKeysBetween("2026-08-30", "2026-09-02"), [
    "2026-08-30",
    "2026-08-31",
    "2026-09-01",
    "2026-09-02",
  ]);
  assert.deepEqual(dayKeysBetween("2026-08-24", "2026-08-24"), ["2026-08-24"]);
  assert.throws(() => dayKeysBetween("2026-08-24", "2026-08-20"), /cannot be before/);
});

test("parseTimeOfDay rejects anything that is not HH:MM", () => {
  assert.equal(parseTimeOfDay("09:00"), 540);
  assert.equal(parseTimeOfDay("00:00"), 0);
  assert.equal(parseTimeOfDay("23:59"), 1439);
  for (const bad of ["24:00", "9:00", "09:60", "0900", "", "noon"]) {
    assert.throws(() => parseTimeOfDay(bad), /Invalid time of day/, bad);
  }
});

test("a working week skips the weekend unless asked not to", () => {
  // 2026-08-24 is a Monday.
  const base = {
    from: "2026-08-24",
    to: "2026-08-30",
    hoursPerDay: 8,
    timezone: "UTC",
    sessionIdFor: (day: string, i: number) => `${day}-${i}`,
  };

  const weekdays = planBackfill(base);
  assert.deepEqual(
    weekdays.map((d) => d.dayKey),
    ["2026-08-24", "2026-08-25", "2026-08-26", "2026-08-27", "2026-08-28"]
  );

  const everyDay = planBackfill({ ...base, includeWeekends: true });
  assert.equal(new Set(everyDay.map((d) => d.dayKey)).size, 7);
});

test("the hours asked for are the hours duration.ts reports", () => {
  const days = planBackfill({
    from: "2026-08-24",
    to: "2026-08-28",
    hoursPerDay: 7.5,
    timezone: "UTC",
    sessionIdFor: (day, i) => `${day}-${i}`,
  });

  const total = days.reduce((sum, d) => sum + workedSeconds({ ...d, idleDiscards: [] }), 0);
  assert.equal(total, 5 * 7.5 * 3600);
});

test("a break becomes a real gap, not time shaved off the end", () => {
  // A single 09:00–17:30 row would credit the lunch hour, because reports
  // attribute time by overlap. Two rows with a hole between them do not.
  const days = planBackfill({
    from: "2026-08-24",
    to: "2026-08-24",
    hoursPerDay: 8,
    startTime: "09:00",
    breakMinutes: 60,
    timezone: "UTC",
    sessionIdFor: (day, i) => `${day}-${i}`,
  });

  assert.equal(days.length, 2);
  assert.equal(days[0].startedAt.toISOString(), "2026-08-24T09:00:00.000Z");
  assert.equal(days[0].endedAt.toISOString(), "2026-08-24T13:00:00.000Z");
  assert.equal(days[1].startedAt.toISOString(), "2026-08-24T14:00:00.000Z");
  assert.equal(days[1].endedAt.toISOString(), "2026-08-24T18:00:00.000Z");

  const worked = days.reduce((sum, d) => sum + d.seconds, 0);
  assert.equal(worked, 8 * 3600, "the break must not be credited");
});

test("start time is local to the org's zone, not UTC", () => {
  // Lagos is UTC+1 with no DST, so a 09:00 local start is 08:00Z. Getting this
  // wrong puts a member's whole day on the neighbouring one in their timesheet.
  const [day] = planBackfill({
    from: "2026-08-24",
    to: "2026-08-24",
    hoursPerDay: 8,
    startTime: "09:00",
    timezone: "Africa/Lagos",
    sessionIdFor: (d, i) => `${d}-${i}`,
  });
  assert.equal(day.startedAt.toISOString(), "2026-08-24T08:00:00.000Z");
});

test("a DST boundary does not shift the local start time", () => {
  // New York moves to EST on 2026-11-01. A day either side of that must still
  // start at 09:00 where the person is — arithmetic on a fixed offset would put
  // one of them at 08:00 or 10:00.
  const days = planBackfill({
    from: "2026-10-30",
    to: "2026-11-02",
    hoursPerDay: 8,
    startTime: "09:00",
    includeWeekends: true,
    timezone: "America/New_York",
    sessionIdFor: (d, i) => `${d}-${i}`,
  });

  const localHour = (d: Date) =>
    Number(
      new Intl.DateTimeFormat("en-GB", {
        timeZone: "America/New_York",
        hour12: false,
        hour: "2-digit",
      }).format(d)
    );

  for (const day of days) {
    assert.equal(localHour(day.startedAt), 9, day.dayKey);
  }
});

test("every generated day carries enough blocks to cover it", () => {
  const days = planBackfill({
    from: "2026-08-24",
    to: "2026-08-26",
    hoursPerDay: 8,
    timezone: "UTC",
    sessionIdFor: (day, i) => `${day}-${i}`,
  });

  for (const day of days) {
    assert.equal(day.blocks.length, Math.ceil(day.seconds / BLOCK_SECONDS));
    assert.equal(day.blocks[0].prevHash, GENESIS);
    assert.equal(day.blocks[0].sequenceNo, 0);
  }
});

test("an impossible request is refused rather than silently clamped", () => {
  const base = {
    from: "2026-08-24",
    to: "2026-08-24",
    timezone: "UTC",
    sessionIdFor: (d: string, i: number) => `${d}-${i}`,
  };
  assert.throws(() => planBackfill({ ...base, hoursPerDay: 0 }), /greater than zero/);
  assert.throws(() => planBackfill({ ...base, hoursPerDay: 25 }), /cannot exceed/);
});
