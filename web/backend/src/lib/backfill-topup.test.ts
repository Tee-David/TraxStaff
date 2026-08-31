import test from "node:test";
import assert from "node:assert/strict";
import {
  derivePattern,
  fillGaps,
  formatTimeOfDay,
  freeGaps,
  lengthMultipliers,
  parseTimeOfDay,
  planBackfill,
} from "./backfill";

/**
 * The half of lib/backfill.ts that has to reckon with time the member already
 * tracked, kept separate from backfill.test.ts (which covers generating from
 * nothing) because the failure modes are different in kind.
 *
 * Everything here is about NOT double-counting. A top-up that ignores existing
 * tracking credits somebody twice for the same hours, and it does so silently:
 * the sessions do not overlap visually in any UI, the totals are simply wrong,
 * and the first sign of it is a payroll figure nobody can reconcile.
 */

const t = (day: string, h: number, m = 0) =>
  Date.parse(`2026-08-${day}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00Z`);

test("freeGaps subtracts busy spans and merges overlapping ones", () => {
  // Two overlapping busy spans must carve ONE hole, not two. Unmerged, the
  // second would start before the first ended and report negative free time.
  const gaps = freeGaps(t("24", 7), t("24", 20), [
    { startMs: t("24", 9), endMs: t("24", 12) },
    { startMs: t("24", 11), endMs: t("24", 13) },
  ]);

  assert.deepEqual(
    gaps.map((g) => [g.startMs, g.endMs]),
    [
      [t("24", 7), t("24", 9)],
      [t("24", 13), t("24", 20)],
    ]
  );
});

test("freeGaps ignores busy spans outside the window", () => {
  const gaps = freeGaps(t("24", 9), t("24", 17), [
    { startMs: t("24", 3), endMs: t("24", 5) },
    { startMs: t("24", 20), endMs: t("24", 22) },
  ]);
  assert.deepEqual(
    gaps.map((g) => [g.startMs, g.endMs]),
    [[t("24", 9), t("24", 17)]]
  );
});

test("fillGaps takes only what is needed, earliest first", () => {
  const filled = fillGaps(
    [
      { startMs: t("24", 7), endMs: t("24", 9) }, // 2h free
      { startMs: t("24", 13), endMs: t("24", 20) }, // 7h free
    ],
    3 * 3600
  );

  assert.equal(filled.length, 2);
  assert.equal(filled[0].startMs, t("24", 7));
  assert.equal(filled[0].endMs, t("24", 9), "the first gap is used in full");
  assert.equal(filled[1].startMs, t("24", 13));
  assert.equal(filled[1].endMs, t("24", 14), "only the remaining hour comes from the second");
});

test("fillGaps drops a remainder too small to be a session", () => {
  const filled = fillGaps([{ startMs: t("24", 9), endMs: t("24", 17) }], 60);
  assert.deepEqual(filled, [], "a 60-second session is noise, not work");
});

test("topUp writes only the shortfall, around what was already tracked", () => {
  // The case this exists for: the member ran the tracker 09:00-11:00 and then
  // went out on site. Their target is 8 hours, so 6 are missing — NOT 8.
  const tracked = { startMs: t("24", 9), endMs: t("24", 11) };

  const days = planBackfill({
    from: "2026-08-24",
    to: "2026-08-24",
    hoursPerDay: 8,
    fill: "topUp",
    busy: [tracked],
    timezone: "UTC",
    sessionIdFor: (d, i) => `${d}-${i}`,
  });

  const added = days.reduce((sum, d) => sum + d.seconds, 0);
  assert.equal(added, 6 * 3600, "8h target minus the 2h already tracked");

  for (const d of days) {
    assert.ok(
      d.endedAt.getTime() <= tracked.startMs || d.startedAt.getTime() >= tracked.endMs,
      `${d.startedAt.toISOString()} to ${d.endedAt.toISOString()} overlaps tracked time`
    );
  }
});

test("topUp skips a day that already meets its target", () => {
  const days = planBackfill({
    from: "2026-08-24",
    to: "2026-08-24",
    hoursPerDay: 6,
    fill: "topUp",
    busy: [{ startMs: t("24", 9), endMs: t("24", 16) }], // 7h, over the 6h target
    timezone: "UTC",
    sessionIdFor: (d, i) => `${d}-${i}`,
  });
  assert.deepEqual(days, []);
});

test("topUp keeps inside the working window rather than inventing night work", () => {
  const days = planBackfill({
    from: "2026-08-24",
    to: "2026-08-24",
    hoursPerDay: 12,
    fill: "topUp",
    dayWindow: { start: "07:00", end: "20:00" },
    busy: [],
    timezone: "UTC",
    sessionIdFor: (d, i) => `${d}-${i}`,
  });

  for (const d of days) {
    assert.ok(d.startedAt.toISOString() >= "2026-08-24T07:00:00.000Z");
    assert.ok(d.endedAt.toISOString() <= "2026-08-24T20:00:00.000Z");
  }
});

test("add mode ignores what is already tracked", () => {
  // The other half of the contract: `add` is for a day the tracker genuinely
  // recorded nothing on, and must not silently become a top-up.
  const days = planBackfill({
    from: "2026-08-24",
    to: "2026-08-24",
    hoursPerDay: 8,
    fill: "add",
    busy: [{ startMs: t("24", 9), endMs: t("24", 11) }],
    timezone: "UTC",
    sessionIdFor: (d, i) => `${d}-${i}`,
  });
  assert.equal(
    days.reduce((sum, d) => sum + d.seconds, 0),
    8 * 3600
  );
});

test("length variation moves hours between days without changing the total", () => {
  // The renormalisation is the whole point: a week asked for as 40 hours has to
  // still be 40 hours, or every figure downstream of it is wrong.
  const days = planBackfill({
    from: "2026-08-24",
    to: "2026-08-28",
    hoursPerDay: 8,
    lengthJitterPct: 25,
    startJitterMinutes: 45,
    timezone: "UTC",
    sessionIdFor: (d, i) => `${d}-${i}`,
  });

  const total = days.reduce((sum, d) => sum + d.seconds, 0);
  assert.ok(Math.abs(total - 5 * 8 * 3600) < 60, `expected ~40h, got ${total / 3600}h`);

  const lengths = new Set(days.map((d) => d.seconds));
  assert.ok(lengths.size > 1, "every day came out the same length");

  const starts = new Set(days.map((d) => d.startedAt.toISOString().slice(11, 16)));
  assert.ok(starts.size > 1, "every day started at the same minute");
});

test("lengthMultipliers average exactly one", () => {
  const m = lengthMultipliers("seed", 7, 30);
  const mean = m.reduce((a, b) => a + b, 0) / m.length;
  assert.ok(Math.abs(mean - 1) < 1e-9, String(mean));
  assert.deepEqual(lengthMultipliers("seed", 5, 0), [1, 1, 1, 1, 1]);
});

/* ──────────────────────  Matching the member's habits  ─────────────────── */

const minutesOf = (d: Date) => d.getUTCHours() * 60 + d.getUTCMinutes();

test("derivePattern reads a member's usual day out of their history", () => {
  const pattern = derivePattern(
    [
      { startedAt: new Date("2026-08-17T07:30:00Z"), endedAt: new Date("2026-08-17T15:30:00Z"), seconds: 8 * 3600, activityPct: 44 },
      { startedAt: new Date("2026-08-18T07:35:00Z"), endedAt: new Date("2026-08-18T15:05:00Z"), seconds: 7.5 * 3600, activityPct: 46 },
      { startedAt: new Date("2026-08-19T07:25:00Z"), endedAt: new Date("2026-08-19T15:25:00Z"), seconds: 8 * 3600, activityPct: 45 },
    ],
    "UTC",
    minutesOf
  );

  assert.ok(pattern);
  assert.equal(pattern.sampleDays, 3);
  assert.equal(pattern.startMinutes, 7 * 60 + 30);
  assert.equal(pattern.hoursPerDay, 8);
  assert.ok(Math.abs(pattern.activityPct - 45) < 1);
});

test("derivePattern is not dragged off by one abandoned session", () => {
  // The 3am row is exactly what lib/duration.ts exists because of. A mean would
  // put this member's "usual" start in the small hours; a median must not.
  const normal = (day: string) => ({
    startedAt: new Date(`2026-08-${day}T09:00:00Z`),
    endedAt: new Date(`2026-08-${day}T17:00:00Z`),
    seconds: 8 * 3600,
    activityPct: 60,
  });

  const pattern = derivePattern(
    [
      normal("17"),
      normal("18"),
      normal("19"),
      normal("20"),
      {
        startedAt: new Date("2026-08-21T03:00:00Z"),
        endedAt: new Date("2026-08-22T03:00:00Z"),
        seconds: 24 * 3600,
        activityPct: 2,
      },
    ],
    "UTC",
    minutesOf
  );

  assert.ok(pattern);
  assert.equal(pattern.startMinutes, 9 * 60);
  assert.equal(pattern.hoursPerDay, 8);
});

test("derivePattern sums a split day rather than counting it twice", () => {
  // Morning and afternoon around a lunch break is ONE day of 7 hours, not two
  // days of 3.5 — and the start time is the morning one.
  const pattern = derivePattern(
    [
      { startedAt: new Date("2026-08-17T08:00:00Z"), endedAt: new Date("2026-08-17T12:00:00Z"), seconds: 4 * 3600, activityPct: 50 },
      { startedAt: new Date("2026-08-17T13:00:00Z"), endedAt: new Date("2026-08-17T16:00:00Z"), seconds: 3 * 3600, activityPct: 50 },
    ],
    "UTC",
    minutesOf
  );

  assert.ok(pattern);
  assert.equal(pattern.sampleDays, 1);
  assert.equal(pattern.hoursPerDay, 7);
  assert.equal(pattern.startMinutes, 8 * 60);
});

test("derivePattern returns null when there is nothing to learn from", () => {
  assert.equal(derivePattern([], "UTC", minutesOf), null);
  assert.equal(
    derivePattern(
      [{ startedAt: new Date("2026-08-17T09:00:00Z"), endedAt: null, seconds: 0, activityPct: null }],
      "UTC",
      minutesOf
    ),
    null
  );
});

test("formatTimeOfDay round-trips through parseTimeOfDay", () => {
  for (const minutes of [0, 1, 450, 540, 1439]) {
    assert.equal(parseTimeOfDay(formatTimeOfDay(minutes)), minutes);
  }
});
