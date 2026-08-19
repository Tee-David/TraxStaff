import test from "node:test";
import assert from "node:assert/strict";
import {
  addDays,
  dailyShortfalls,
  displayName,
  formatDayLabel,
  formatWeekLabel,
  localDayKey,
  localDayStartMs,
  localHour,
  resolveTargetMinutes,
  weekStartKey,
  weekdayIndex,
  weeklyShortfalls,
  weeklyTotals,
  type MemberInput,
  type SessionInput,
} from "./digests";

/** Pinned so a test never depends on when it runs. */
const NOW = new Date("2026-08-18T12:00:00.000Z");

const LAGOS = "Africa/Lagos"; // UTC+1 all year — no DST
const LONDON = "Europe/London"; // BST in summer, GMT in winter

function member(over: Partial<MemberInput> = {}): MemberInput {
  return {
    id: "u1",
    email: "jordan@acme.test",
    name: null,
    dailyTargetMinutes: null,
    weeklyTargetMinutes: null,
    ...over,
  };
}

/** A closed session, which is all the bucketing tests need. */
function session(startIso: string, endIso: string, userId = "u1"): SessionInput {
  return { userId, startedAt: new Date(startIso), endedAt: new Date(endIso) };
}

/* ─────────────────────────────  Timezone  ───────────────────────────── */

test("a local day starts at the offset, not at UTC midnight", () => {
  // 00:00 in Lagos (UTC+1) is 23:00 the previous day in UTC.
  assert.equal(localDayStartMs("2026-08-17", LAGOS), Date.parse("2026-08-16T23:00:00.000Z"));
});

test("an instant just after local midnight belongs to the new local day", () => {
  // 23:30 UTC is already 00:30 the next day in Lagos.
  assert.equal(localDayKey(new Date("2026-08-16T23:30:00.000Z"), LAGOS), "2026-08-17");
  assert.equal(localDayKey(new Date("2026-08-16T23:30:00.000Z"), "UTC"), "2026-08-16");
});

test("the day boundary follows the DST changeover rather than drifting an hour", () => {
  // BST (UTC+1) in August, GMT (UTC+0) in December — the same helper must give both.
  assert.equal(localDayStartMs("2026-08-17", LONDON), Date.parse("2026-08-16T23:00:00.000Z"));
  assert.equal(localDayStartMs("2026-12-14", LONDON), Date.parse("2026-12-14T00:00:00.000Z"));
});

test("localHour reads the org's wall clock, not the server's", () => {
  assert.equal(localHour(new Date("2026-08-18T07:30:00.000Z"), LAGOS), 8);
  assert.equal(localHour(new Date("2026-08-18T07:30:00.000Z"), "UTC"), 7);
});

test("addDays crosses a month boundary without drifting", () => {
  assert.equal(addDays("2026-08-31", 1), "2026-09-01");
  assert.equal(addDays("2026-01-01", -1), "2025-12-31");
});

/* ───────────────────────────  Week bucketing  ────────────────────────── */

test("the week starts on Monday, and Sunday belongs to the week that just ended", () => {
  assert.equal(weekStartKey("2026-08-19"), "2026-08-17"); // Wednesday → Monday
  assert.equal(weekStartKey("2026-08-17"), "2026-08-17"); // Monday → itself
  assert.equal(weekStartKey("2026-08-23"), "2026-08-17"); // Sunday → the SAME Monday
});

test("weekdayIndex is Monday-based, matching the clients", () => {
  assert.equal(weekdayIndex("2026-08-17"), 0); // Monday
  assert.equal(weekdayIndex("2026-08-23"), 6); // Sunday
});

/* ─────────────────────────  Target resolution  ───────────────────────── */

test("a member with no override inherits the org target", () => {
  assert.deepEqual(resolveTargetMinutes(member(), 480, 2400), { daily: 480, weekly: 2400 });
});

test("a zero target is a real target, not a missing one", () => {
  // The `?? vs ||` bug: someone on leave has a real target of no hours, and `||`
  // would silently promote it back to the org default and then flag them.
  const onLeave = member({ dailyTargetMinutes: 0, weeklyTargetMinutes: 0 });
  assert.deepEqual(resolveTargetMinutes(onLeave, 480, 2400), { daily: 0, weekly: 0 });
});

test("someone with a zero target is never reported as short", () => {
  const rows = dailyShortfalls(
    [member({ dailyTargetMinutes: 0 })],
    [],
    "2026-08-17",
    LAGOS,
    480,
    2400,
    NOW
  );
  assert.deepEqual(rows, []);
});

test("a member is named by their display name, falling back to the email", () => {
  assert.equal(displayName(member({ name: "Jordan Ade" })), "Jordan Ade");
  assert.equal(displayName(member({ name: "   " })), "jordan@acme.test");
  assert.equal(displayName(member()), "jordan@acme.test");
});

/* ────────────────────────────  Shortfalls  ───────────────────────────── */

test("a full day of work is not a shortfall", () => {
  // 08:00–16:00 Lagos = 07:00–15:00 UTC.
  const rows = dailyShortfalls(
    [member()],
    [session("2026-08-17T07:00:00.000Z", "2026-08-17T15:00:00.000Z")],
    "2026-08-17",
    LAGOS,
    480,
    2400,
    NOW
  );
  assert.deepEqual(rows, []);
});

test("a short day is reported with the hours actually tracked", () => {
  const rows = dailyShortfalls(
    [member()],
    [session("2026-08-17T07:00:00.000Z", "2026-08-17T13:00:00.000Z")], // 6h
    "2026-08-17",
    LAGOS,
    480,
    2400,
    NOW
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].trackedHours, 6);
  assert.equal(rows[0].targetHours, 8);
});

test("work done on the next local day does not count towards this one", () => {
  // 23:30 UTC on the 17th is already 00:30 on the 18th in Lagos.
  const rows = dailyShortfalls(
    [member()],
    [session("2026-08-17T23:30:00.000Z", "2026-08-18T05:30:00.000Z")],
    "2026-08-17",
    LAGOS,
    480,
    2400,
    NOW
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].trackedHours, 0);
});

test("a session spanning local midnight is split across the two days", () => {
  // 20:00–02:00 Lagos = 19:00 UTC on the 17th to 01:00 UTC on the 18th.
  const overnight = [session("2026-08-17T19:00:00.000Z", "2026-08-18T01:00:00.000Z")];
  const first = dailyShortfalls([member()], overnight, "2026-08-17", LAGOS, 480, 2400, NOW);
  const second = dailyShortfalls([member()], overnight, "2026-08-18", LAGOS, 480, 2400, NOW);
  assert.equal(first[0].trackedHours, 4); // 20:00 → midnight
  assert.equal(second[0].trackedHours, 2); // midnight → 02:00
});

test("idle discards come off the tracked total", () => {
  const withIdle: SessionInput = {
    ...session("2026-08-17T07:00:00.000Z", "2026-08-17T15:00:00.000Z"),
    idleDiscards: [
      {
        seconds: 3600,
        from: new Date("2026-08-17T09:00:00.000Z"),
        to: new Date("2026-08-17T10:00:00.000Z"),
      },
    ],
  };
  const rows = dailyShortfalls([member()], [withIdle], "2026-08-17", LAGOS, 480, 2400, NOW);
  assert.equal(rows.length, 1); // 8h gross − 1h idle = 7h, so now short
  assert.equal(rows[0].trackedHours, 7);
});

test("another member's sessions are never credited to this one", () => {
  const rows = dailyShortfalls(
    [member({ id: "u1" })],
    [session("2026-08-17T07:00:00.000Z", "2026-08-17T15:00:00.000Z", "u2")],
    "2026-08-17",
    LAGOS,
    480,
    2400,
    NOW
  );
  assert.equal(rows[0].trackedHours, 0);
});

test("the biggest shortfall is listed first", () => {
  const members = [
    member({ id: "a", email: "a@acme.test" }),
    member({ id: "b", email: "b@acme.test" }),
  ];
  const rows = dailyShortfalls(
    members,
    [session("2026-08-17T07:00:00.000Z", "2026-08-17T13:00:00.000Z", "a")], // a: 6h, b: 0h
    "2026-08-17",
    LAGOS,
    480,
    2400,
    NOW
  );
  assert.deepEqual(rows.map((r) => r.userId), ["b", "a"]);
});

/* ──────────────────────────────  Weekly  ─────────────────────────────── */

test("a week that meets its target produces no row", () => {
  const sessions = Array.from({ length: 5 }, (_, i) =>
    session(`2026-08-${17 + i}T07:00:00.000Z`, `2026-08-${17 + i}T15:00:00.000Z`)
  );
  const rows = weeklyShortfalls([member()], sessions, "2026-08-17", LAGOS, 480, 2400, NOW);
  assert.deepEqual(rows, []); // 40h against a 40h target
});

test("a short week reports how many days did meet the daily target", () => {
  const sessions = [
    session("2026-08-17T07:00:00.000Z", "2026-08-17T15:00:00.000Z"), // Mon, 8h — met
    session("2026-08-18T07:00:00.000Z", "2026-08-18T15:00:00.000Z"), // Tue, 8h — met
    session("2026-08-19T07:00:00.000Z", "2026-08-19T11:00:00.000Z"), // Wed, 4h — missed
  ];
  const rows = weeklyShortfalls([member()], sessions, "2026-08-17", LAGOS, 480, 2400, NOW);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].trackedHours, 20);
  assert.equal(rows[0].daysMet, 2);
  assert.equal(rows[0].daysExpected, 7);
});

test("weeklyTotals reports everyone, including those who met the target", () => {
  const rows = weeklyTotals(
    [member({ id: "a", email: "a@acme.test" }), member({ id: "b", email: "b@acme.test" })],
    [session("2026-08-17T07:00:00.000Z", "2026-08-17T15:00:00.000Z", "a")],
    "2026-08-17",
    LAGOS,
    480,
    2400,
    NOW
  );
  assert.equal(rows.length, 2);
  assert.equal(rows[0].trackedHours, 8);
  assert.equal(rows[1].trackedHours, 0);
});

/* ──────────────────────────────  Labels  ─────────────────────────────── */

test("the day label names the weekday the org actually worked", () => {
  assert.equal(formatDayLabel("2026-08-17", LAGOS), "Monday, 17 August");
});

test("a week inside one month collapses to a single month and year", () => {
  assert.equal(formatWeekLabel("2026-08-10", LAGOS), "10–16 August 2026");
});

test("a week straddling two months names both", () => {
  assert.equal(formatWeekLabel("2026-08-31", LAGOS), "31 August 2026 – 6 September 2026");
});
