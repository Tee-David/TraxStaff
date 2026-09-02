/**
 * Work-target digests: who fell short, over which local day or week.
 *
 * Pure by construction — no Prisma import, every input passed in — for the same
 * reason as stale-sessions.ts: `lib/prisma.ts` connects to a live cluster at
 * module load, and this logic has to be testable without one.
 *
 * Two things here are easy to get wrong and are therefore centralised:
 *
 *  - **Local days, not UTC days.** A "day" is a wall-clock day in the org's
 *    timezone. Bucketing on UTC shifts every boundary by the offset, which for
 *    a UTC+1 org means an hour of Monday morning is credited to Sunday and the
 *    Monday digest under-reports it.
 *  - **Week starts Monday.** That is what all five client-side copies already
 *    do (`(d.getDay() + 6) % 7`), and a server that disagreed would report a
 *    different week than the dashboard the admin clicks through to.
 */
import {
  workedSecondsInRange,
  type DurationInput,
  type IdleDiscardInput,
} from "./duration";

/** A member as far as target resolution is concerned. */
export type MemberInput = {
  id: string;
  email: string;
  name?: string | null;
  /** Null means "inherit the org target" — distinct from 0, a real target of no hours. */
  dailyTargetMinutes: number | null;
  weeklyTargetMinutes: number | null;
};

export type SessionInput = DurationInput & {
  userId: string | null;
  idleDiscards?: IdleDiscardInput[];
};

export type Shortfall = {
  userId: string;
  name: string;
  trackedHours: number;
  targetHours: number;
  daysMet?: number;
  daysExpected?: number;
};

/* ─────────────────────────────  Timezone  ───────────────────────────── */

/**
 * The offset, in ms, that `tz` was at the given instant (`local - utc`).
 *
 * Derived by formatting the instant in `tz` and reading the wall clock back as
 * if it were UTC. This is the only approach that stays correct across DST
 * without shipping a timezone database.
 */
function offsetMsAt(utcMs: number, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(utcMs));

  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
  // ICU renders midnight as hour "24" in some locales; normalise it.
  const hour = get("hour") % 24;
  const asIfUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    hour,
    get("minute"),
    get("second")
  );
  return asIfUtc - utcMs;
}

/** `YYYY-MM-DD` for an instant, in `tz`. Lexicographically sortable. */
export function localDayKey(d: Date, tz: string): string {
  // en-CA formats as YYYY-MM-DD natively, which is why reports.ts uses it too.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/**
 * The UTC instant at which the local day `YYYY-MM-DD` begins in `tz`.
 *
 * Two passes: the offset is itself a function of the instant, so the first
 * guess is corrected using the offset actually in force at that guess. This is
 * what makes the two DST changeover days land on the right instant.
 */
export function localDayStartMs(dayKey: string, tz: string): number {
  return localInstantMs(dayKey, 0, tz);
}

/**
 * The UTC instant of a local wall-clock time on `dayKey` in `tz`, given as
 * minutes past local midnight.
 *
 * The generalisation of `localDayStartMs`, which is now this with `0`. Adding
 * the minutes to the day-start instant instead would be wrong on the two
 * changeover days: the offset in force at local midnight is not necessarily the
 * one in force at 09:00, so a fixed addition lands an hour out — 09:00 becomes
 * 08:00 on the day the clocks go back. The minutes therefore go into the naive
 * wall-clock value BEFORE the two-pass offset correction, which is the only
 * placement that resolves the wall clock the way a person reading it would.
 */
export function localInstantMs(dayKey: string, minutesOfDay: number, tz: string): number {
  const [y, m, d] = dayKey.split("-").map(Number);
  const naive = Date.UTC(y, m - 1, d, 0, 0, 0) + minutesOfDay * 60_000;
  const firstPass = naive - offsetMsAt(naive, tz);
  return naive - offsetMsAt(firstPass, tz);
}

/** Day key `n` days before/after `dayKey`. Calendar arithmetic, so DST cannot drift it. */
export function addDays(dayKey: string, n: number): string {
  const [y, m, d] = dayKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** Monday of the week containing `dayKey`. Matches every client-side copy. */
export function weekStartKey(dayKey: string): string {
  const [y, m, d] = dayKey.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday
  return addDays(dayKey, -((dow + 6) % 7));
}

/** 0 = Monday … 6 = Sunday. */
export function weekdayIndex(dayKey: string): number {
  const [y, m, d] = dayKey.split("-").map(Number);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}

/** Whole hours into the org's local day, for deciding whether a digest is due. */
export function localHour(now: Date, tz: string): number {
  const h = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    hour12: false,
    hour: "2-digit",
  }).format(now);
  return Number(h) % 24;
}

/* ─────────────────────────  Target resolution  ───────────────────────── */

/**
 * `member ?? org`, never `member || org` — 0 is a real target (someone on
 * leave), and `||` would silently promote it back to the org default.
 */
export function resolveTargetMinutes(
  member: MemberInput,
  orgDailyMinutes: number,
  orgWeeklyMinutes: number
): { daily: number; weekly: number } {
  return {
    daily: member.dailyTargetMinutes ?? orgDailyMinutes,
    weekly: member.weeklyTargetMinutes ?? orgWeeklyMinutes,
  };
}

/** Display name if set, otherwise the email — matching how the dashboard names people. */
export function displayName(member: MemberInput): string {
  const trimmed = member.name?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : member.email;
}

/* ─────────────────────────────  Shortfalls  ──────────────────────────── */

function trackedSecondsFor(
  userId: string,
  sessions: SessionInput[],
  fromMs: number,
  toMs: number,
  now: Date
): number {
  let total = 0;
  for (const s of sessions) {
    if (s.userId !== userId) continue;
    total += workedSecondsInRange(s, fromMs, toMs, now);
  }
  return total;
}

/** Biggest shortfall first — that is the row an admin actually needs to see. */
function bySizeOfShortfall(a: Shortfall, b: Shortfall): number {
  return b.targetHours - b.trackedHours - (a.targetHours - a.trackedHours);
}

/**
 * Members who tracked less than their daily target on `dayKey`.
 *
 * A target of 0 can never be missed, so those members are skipped outright
 * rather than reported as "0h short" — that is the documented meaning of an
 * explicit zero override.
 */
export function dailyShortfalls(
  members: MemberInput[],
  sessions: SessionInput[],
  dayKey: string,
  tz: string,
  orgDailyMinutes: number,
  orgWeeklyMinutes: number,
  now: Date
): Shortfall[] {
  const fromMs = localDayStartMs(dayKey, tz);
  const toMs = localDayStartMs(addDays(dayKey, 1), tz);

  const rows: Shortfall[] = [];
  for (const member of members) {
    const { daily } = resolveTargetMinutes(member, orgDailyMinutes, orgWeeklyMinutes);
    if (daily <= 0) continue;
    const tracked = trackedSecondsFor(member.id, sessions, fromMs, toMs, now);
    if (tracked >= daily * 60) continue;
    rows.push({
      userId: member.id,
      name: displayName(member),
      trackedHours: tracked / 3600,
      targetHours: daily / 60,
    });
  }
  return rows.sort(bySizeOfShortfall);
}

/**
 * Members who tracked less than their weekly target across the week starting
 * `weekStart` (a Monday), with a count of how many of the seven local days they
 * did meet the daily target on.
 */
export function weeklyShortfalls(
  members: MemberInput[],
  sessions: SessionInput[],
  weekStart: string,
  tz: string,
  orgDailyMinutes: number,
  orgWeeklyMinutes: number,
  now: Date
): Shortfall[] {
  const dayKeys = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const fromMs = localDayStartMs(weekStart, tz);
  const toMs = localDayStartMs(addDays(weekStart, 7), tz);

  const rows: Shortfall[] = [];
  for (const member of members) {
    const { daily, weekly } = resolveTargetMinutes(member, orgDailyMinutes, orgWeeklyMinutes);
    if (weekly <= 0) continue;
    const tracked = trackedSecondsFor(member.id, sessions, fromMs, toMs, now);
    if (tracked >= weekly * 60) continue;

    let daysMet = 0;
    if (daily > 0) {
      for (const key of dayKeys) {
        const dayFrom = localDayStartMs(key, tz);
        const dayTo = localDayStartMs(addDays(key, 1), tz);
        if (trackedSecondsFor(member.id, sessions, dayFrom, dayTo, now) >= daily * 60) daysMet++;
      }
    }

    rows.push({
      userId: member.id,
      name: displayName(member),
      trackedHours: tracked / 3600,
      targetHours: weekly / 60,
      daysMet: daily > 0 ? daysMet : undefined,
      daysExpected: daily > 0 ? 7 : undefined,
    });
  }
  return rows.sort(bySizeOfShortfall);
}

/** Every member's own week, shortfall or not — for the member-facing summary. */
export function weeklyTotals(
  members: MemberInput[],
  sessions: SessionInput[],
  weekStart: string,
  tz: string,
  orgDailyMinutes: number,
  orgWeeklyMinutes: number,
  now: Date
): Shortfall[] {
  const fromMs = localDayStartMs(weekStart, tz);
  const toMs = localDayStartMs(addDays(weekStart, 7), tz);
  return members.map((member) => {
    const { weekly } = resolveTargetMinutes(member, orgDailyMinutes, orgWeeklyMinutes);
    return {
      userId: member.id,
      name: displayName(member),
      trackedHours: trackedSecondsFor(member.id, sessions, fromMs, toMs, now) / 3600,
      targetHours: weekly / 60,
    };
  });
}

/* ──────────────────────────────  Labels  ─────────────────────────────── */

/** Noon avoids the DST hour where a local midnight may not exist at all. */
function noonOf(dayKey: string, tz: string): Date {
  return new Date(localDayStartMs(dayKey, tz) + 12 * 3_600_000);
}

/**
 * "Monday, 17 August" — the heading a daily digest is titled with.
 *
 * Composed from two formatters rather than one: en-GB renders the combined form
 * as "Monday 17 August", and the comma is what makes it read as a heading.
 */
export function formatDayLabel(dayKey: string, tz: string): string {
  const noon = noonOf(dayKey, tz);
  const weekday = new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "long" }).format(noon);
  const date = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    day: "numeric",
    month: "long",
  }).format(noon);
  return `${weekday}, ${date}`;
}

/** "10–16 August 2026", collapsing a shared month and year. */
export function formatWeekLabel(weekStart: string, tz: string): string {
  const end = addDays(weekStart, 6);
  const dayOf = (key: string) =>
    new Intl.DateTimeFormat("en-GB", { timeZone: tz, day: "numeric" }).format(noonOf(key, tz));
  const monthYearOf = (key: string) =>
    new Intl.DateTimeFormat("en-GB", { timeZone: tz, month: "long", year: "numeric" }).format(
      noonOf(key, tz)
    );

  const startMonthYear = monthYearOf(weekStart);
  const endMonthYear = monthYearOf(end);
  return startMonthYear === endMonthYear
    ? `${dayOf(weekStart)}–${dayOf(end)} ${endMonthYear}`
    : `${dayOf(weekStart)} ${startMonthYear} – ${dayOf(end)} ${endMonthYear}`;
}
