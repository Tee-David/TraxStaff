/**
 * Sends the work-target digests: daily the morning after, weekly on Monday.
 *
 * Shaped like `stale-sessions.ts` and for the same reasons — a plain unref'd
 * `setInterval` rather than `node-cron`, and the Prisma client injected rather
 * than imported, so the whole thing is testable without a live cluster.
 *
 * Why a 15-minute tick instead of firing at 08:00: orgs sit in different
 * timezones, a process that was asleep or redeploying at 08:00 would otherwise
 * skip the day entirely, and Render restarts often enough for that to matter.
 * The tick asks "is this org's local morning, and has this period been sent
 * yet?" — so a late boot still sends, and a boot loop does not resend.
 *
 * Idempotency is keyed on the PERIOD, not on the clock. Each digest writes a
 * `Notification` row carrying its `periodKey`, and a period that already has one
 * is never sent again. The clock-based check this replaces — "has anything of
 * this type been written since local midnight?" — was wrong in both directions
 * on an instance that hibernates: a day whose send hour passed while the process
 * was asleep could never be caught up, because by the time it woke the window it
 * compared against had already moved on. Hence `CATCHUP_DAYS`: each pass looks
 * back over the last few periods and sends whatever is genuinely missing.
 *
 * The check is deliberately FAIL-CLOSED — if the lookup itself errors we skip
 * the send, because the failure mode of guessing "not sent yet" is an email
 * every fifteen minutes.
 *
 * Mail is handed to lib/email-queue.ts rather than sent inline, and it is queued
 * BEFORE the Notification row is written. The old order recorded first and
 * abandoned the send if that write failed, so a hiccup on a bell-notification
 * row silently cancelled the whole digest; and a crash between the two lost the
 * mail with nothing to retry from. Ordering it the other way is safe because the
 * dedupe key, not the Notification row, is what prevents a second copy.
 */
import type { Prisma, PrismaClient } from "@prisma/client";
import { env } from "../env";
import {
  addDays,
  dailyShortfalls,
  displayName,
  formatDayLabel,
  formatWeekLabel,
  localDayKey,
  localDayStartMs,
  localHour,
  weekStartKey,
  weekdayIndex,
  weeklyShortfalls,
  weeklyTotals,
  type MemberInput,
  type SessionInput,
  type Shortfall,
} from "./digests";
import {
  sendDailyShortfallEmail,
  sendMemberWeeklySummaryEmail,
  sendUnusualActivityEmail,
  sendWeeklyShortfallEmail,
  type FlagRow,
} from "./mailer";
import { overlapsRange } from "./duration";

export const DIGEST_INTERVAL_MS = 15 * 60_000;

/** Local hour at which a morning digest becomes due. */
export const SEND_HOUR = 8;

/**
 * How many past days a pass will still send a daily digest for.
 *
 * Not one: this API hibernates, so "today's send hour has passed" is no
 * guarantee that any process was alive to act on it. Three days is a compromise
 * — long enough to survive a weekend asleep, short enough that nobody is mailed
 * a report about last week's Tuesday, which is noise rather than news.
 */
export const CATCHUP_DAYS = 3;

/**
 * How many days after Monday the weekly digests stay claimable.
 *
 * Monday is still when they are due; this only means a Monday spent hibernating
 * no longer loses the week outright. Kept short so the digest still reads as a
 * Monday-morning review rather than turning up on Friday.
 */
export const WEEKLY_CATCHUP_DAYS = 3;

type Logger = { info: (msg: string) => void; warn: (msg: string) => void };

/**
 * Type-only, exactly as stale-sessions.ts does it: the client is passed in so
 * this module never imports lib/prisma.ts and can be loaded — and tested —
 * without a live cluster. A test passes a hand-built stub cast to this type.
 */
export type DigestDb = PrismaClient;

/** Injectable so tests never open an SMTP socket. */
export type DigestMailer = {
  daily: typeof sendDailyShortfallEmail;
  weekly: typeof sendWeeklyShortfallEmail;
  unusual: typeof sendUnusualActivityEmail;
  memberWeekly: typeof sendMemberWeeklySummaryEmail;
};

const realMailer: DigestMailer = {
  daily: sendDailyShortfallEmail,
  weekly: sendWeeklyShortfallEmail,
  unusual: sendUnusualActivityEmail,
  memberWeekly: sendMemberWeeklySummaryEmail,
};

type OrgRow = {
  id: string;
  name: string;
  timezone: string;
  dailyTargetMinutes: number;
  weeklyTargetMinutes: number;
  emailsEnabled: boolean;
  notifyDailyShortfall: boolean;
  notifyWeeklyShortfall: boolean;
  notifyUnusualActivity: boolean;
  notifyMemberWeeklySummary: boolean;
};

/** Served when the database predates a column — same values as routes/orgs.ts. */
const OPTIONAL_DEFAULTS = {
  timezone: "Africa/Lagos",
  emailsEnabled: true,
  notifyDailyShortfall: true,
  notifyWeeklyShortfall: true,
  notifyUnusualActivity: true,
  notifyMemberWeeklySummary: false,
} as const;

const BASE_ORG_SELECT = {
  id: true,
  name: true,
  dailyTargetMinutes: true,
  weeklyTargetMinutes: true,
} as const;

const appUrl = () => (env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");

/**
 * Normalised once, here, rather than at each use: an empty or unrecognised zone
 * makes every `Intl` call downstream throw, and a single org with a bad value
 * would otherwise take out that org's digests on every tick. Falls back to the
 * same default the missing-column path serves, so there is one answer to "which
 * zone do we assume".
 */
function safeZone(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") return OPTIONAL_DEFAULTS.timezone;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return value;
  } catch {
    return OPTIONAL_DEFAULTS.timezone;
  }
}

/**
 * Orgs with their notification settings, tolerating a database that has not yet
 * grown the columns — the same drift the settings route handles, for the same
 * reason (code and DDL do not land at the same instant).
 */
async function loadOrgs(db: DigestDb): Promise<OrgRow[]> {
  const full = {
    ...BASE_ORG_SELECT,
    ...Object.fromEntries(Object.keys(OPTIONAL_DEFAULTS).map((k) => [k, true])),
  };
  const rows = await db.organization
    .findMany({ select: full })
    .catch(() => db.organization.findMany({ select: BASE_ORG_SELECT }));

  return (rows as unknown as Record<string, unknown>[]).map((r) => {
    const merged = { ...OPTIONAL_DEFAULTS, ...r };
    return { ...merged, timezone: safeZone(merged.timezone) } as unknown as OrgRow;
  });
}

async function loadMembers(db: DigestDb, orgId: string): Promise<(MemberInput & { role: string })[]> {
  const rows = await db.user.findMany({
    where: { orgId, status: "active" },
    // Explicit select, never a bare findMany: a not-yet-migrated column must not
    // be able to 500 this job (the rule sync.ts states outright).
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      dailyTargetMinutes: true,
      weeklyTargetMinutes: true,
    },
  });
  return rows as unknown as (MemberInput & { role: string })[];
}

async function loadSessions(
  db: DigestDb,
  orgId: string,
  fromMs: number,
  toMs: number
): Promise<SessionInput[]> {
  const from = new Date(fromMs);
  const to = new Date(toMs);
  const rows = await db.trackingSession.findMany({
    where: {
      user: { orgId },
      AND: overlapsRange(from, to),
    },
    select: {
      userId: true,
      startedAt: true,
      endedAt: true,
      lastSyncAt: true,
      activityBlocks: { select: { blockEnd: true } },
      idleDiscards: { select: { seconds: true, from: true, to: true } },
    },
  });
  return rows as unknown as SessionInput[];
}

/**
 * The set of period keys this org has already had a digest of `type` for.
 *
 * Reads `periodKey` back out of the recorded payload instead of asking "was
 * anything of this type written recently". That distinction is the whole fix for
 * the missed-day bug: the old clock-window check could not tell "already sent"
 * from "the window has moved on", so a period the process slept through was
 * unrecoverable.
 *
 * Fail-closed: a thrown lookup returns `null`, and the caller sends nothing.
 * Guessing the other way turns one broken query into an email every fifteen
 * minutes.
 *
 * `take` is bounded because only the recent past is ever a candidate — see
 * `CATCHUP_DAYS`. Sixty rows covers weeks of every digest type.
 */
async function sentPeriods(
  db: DigestDb,
  orgId: string,
  type: string,
  log: Logger
): Promise<Set<string> | null> {
  try {
    const rows = await db.notification.findMany({
      where: { orgId, type },
      select: { payload: true },
      orderBy: { createdAt: "desc" },
      take: 60,
    });
    const keys = new Set<string>();
    for (const row of rows) {
      const key = (row.payload as { periodKey?: unknown } | null)?.periodKey;
      if (typeof key === "string") keys.add(key);
    }
    return keys;
  } catch (err) {
    log.warn(
      `[digests] could not check which ${type} periods were already sent for org ${orgId} (${
        err instanceof Error ? err.message : err
      }) — skipping this tick rather than risking a duplicate.`
    );
    return null;
  }
}

/**
 * The daily periods still owed, oldest first, so a backlog arrives in the order
 * it happened rather than backwards.
 *
 * Two rules keep catch-up from turning into backfill:
 *
 *   - with no history at all, only yesterday is owed. Catching up implies there
 *     was something to catch up ON; an org whose very first pass runs today has
 *     not "missed" the two days before it existed, and mailing them would open
 *     the account with three days of reports nobody asked for.
 *   - otherwise nothing at or before the newest period already sent is
 *     reconsidered, so a digest deliberately skipped (the toggle was off, the
 *     org had no members) does not reappear once it is behind the high-water
 *     mark.
 *
 * Day keys are ISO `YYYY-MM-DD`, so string ordering is date ordering.
 */
function missingDays(todayKey: string, sent: Set<string>): string[] {
  const yesterday = addDays(todayKey, -1);
  if (sent.size === 0) return [yesterday];

  const newest = [...sent].sort().at(-1)!;
  const days: string[] = [];
  for (let back = CATCHUP_DAYS; back >= 1; back--) {
    const day = addDays(todayKey, -back);
    if (day <= newest || sent.has(day)) continue;
    days.push(day);
  }
  return days;
}

/**
 * Whether last week's digest is still owed.
 *
 * Monday remains when these are due. The catch-up window only means a Monday
 * spent hibernating no longer loses the week — and, as with `missingDays`, an
 * org with no history at all waits for an actual Monday rather than being handed
 * last week's review on whatever day it first ran.
 */
function weeklyDue(lastWeekStart: string, sent: Set<string>, daysSinceMonday: number): boolean {
  if (sent.has(lastWeekStart)) return false;
  if (sent.size === 0) return daysSinceMonday === 0;
  return daysSinceMonday < WEEKLY_CATCHUP_DAYS;
}

async function record(
  db: DigestDb,
  orgId: string,
  type: string,
  payload: Record<string, unknown>,
  log: Logger
): Promise<boolean> {
  try {
    // `userId: null` is what scopes this to admins: routes/insights.ts filters
    // members down to their own rows, so an org-wide row is admin-only by
    // construction rather than by an extra check.
    await db.notification.create({
      data: { orgId, userId: null, type, payload: payload as Prisma.InputJsonValue },
    });
    return true;
  } catch (err) {
    log.warn(
      `[digests] could not record ${type} for org ${orgId}: ${
        err instanceof Error ? err.message : err
      }`
    );
    return false;
  }
}

const adminsOf = <T extends { role: string }>(members: T[]): T[] =>
  members.filter((m) => m.role === "owner" || m.role === "admin");

/**
 * Hands one digest to each admin and says how many got through.
 *
 * The return value used to be discarded, which is why a digest that never
 * reached anybody looked identical in the logs to one that reached everybody.
 * A `false` here now means "queued, not yet delivered" rather than "lost", so it
 * is worth a line each — that line is the only place a stuck recipient shows up.
 */
async function mailAdmins<T extends { email: string; role: string }>(
  members: T[],
  label: string,
  log: Logger,
  sendOne: (email: string) => Promise<boolean>
): Promise<{ delivered: number; total: number }> {
  const admins = adminsOf(members);
  let delivered = 0;
  for (const admin of admins) {
    if (await sendOne(admin.email)) delivered++;
    else log.warn(`[digests] ${label} not yet delivered to ${admin.email} — queued for retry`);
  }
  return { delivered, total: admins.length };
}

/** Rows as the mailer wants them — it takes plain hours, not member records. */
const toMailRows = (rows: Shortfall[]) =>
  rows.map((r) => ({
    name: r.name,
    trackedHours: r.trackedHours,
    targetHours: r.targetHours,
    daysMet: r.daysMet,
    daysExpected: r.daysExpected,
  }));

async function runDailyShortfall(
  db: DigestDb,
  org: OrgRow,
  members: (MemberInput & { role: string })[],
  dayKey: string,
  now: Date,
  mail: DigestMailer,
  log: Logger
): Promise<void> {
  const fromMs = localDayStartMs(dayKey, org.timezone);
  const toMs = localDayStartMs(addDays(dayKey, 1), org.timezone);

  const sessions = await loadSessions(db, org.id, fromMs, toMs);
  const rows = dailyShortfalls(
    members,
    sessions,
    dayKey,
    org.timezone,
    org.dailyTargetMinutes,
    org.weeklyTargetMinutes,
    now
  );

  const dashboardUrl = `${appUrl()}/app/timesheets`;
  const dateLabel = formatDayLabel(dayKey, org.timezone);

  // Queued before the Notification row is written, and safe in that order
  // because the dedupe key makes a second copy impossible even if this whole
  // function runs again.
  const { delivered, total } = await mailAdmins(
    members,
    `daily shortfall for ${dayKey}`,
    log,
    (email) =>
      mail.daily(email, {
        orgName: org.name,
        dateLabel,
        targetHours: org.dailyTargetMinutes / 60,
        totalMembers: members.length,
        dashboardUrl,
        rows: toMailRows(rows),
        dedupeKey: `daily_shortfall:${org.id}:${dayKey}:${email}`,
      })
  );

  await record(
    db,
    org.id,
    "daily_shortfall",
    {
      periodKey: dayKey,
      shortfallCount: rows.length,
      totalMembers: members.length,
      targetMinutes: org.dailyTargetMinutes,
      members: rows.map((r) => ({ name: r.name, trackedHours: r.trackedHours })),
    },
    log
  );

  log.info(
    `[digests] daily shortfall for ${org.name}: ${rows.length} below target on ${dayKey}, ${delivered}/${total} delivered`
  );
}

async function runWeeklyShortfall(
  db: DigestDb,
  org: OrgRow,
  members: (MemberInput & { role: string })[],
  lastWeekStart: string,
  now: Date,
  mail: DigestMailer,
  log: Logger
): Promise<void> {
  const fromMs = localDayStartMs(lastWeekStart, org.timezone);
  const toMs = localDayStartMs(addDays(lastWeekStart, 7), org.timezone);

  const sessions = await loadSessions(db, org.id, fromMs, toMs);
  const rows = weeklyShortfalls(
    members,
    sessions,
    lastWeekStart,
    org.timezone,
    org.dailyTargetMinutes,
    org.weeklyTargetMinutes,
    now
  );

  const dashboardUrl = `${appUrl()}/app/reports`;
  const rangeLabel = formatWeekLabel(lastWeekStart, org.timezone);

  const { delivered, total } = await mailAdmins(
    members,
    `weekly shortfall for week of ${lastWeekStart}`,
    log,
    (email) =>
      mail.weekly(email, {
        orgName: org.name,
        rangeLabel,
        targetHours: org.weeklyTargetMinutes / 60,
        totalMembers: members.length,
        dashboardUrl,
        rows: toMailRows(rows),
        dedupeKey: `weekly_shortfall:${org.id}:${lastWeekStart}:${email}`,
      })
  );

  await record(
    db,
    org.id,
    "weekly_shortfall",
    {
      periodKey: lastWeekStart,
      shortfallCount: rows.length,
      totalMembers: members.length,
      targetMinutes: org.weeklyTargetMinutes,
      members: rows.map((r) => ({ name: r.name, trackedHours: r.trackedHours })),
    },
    log
  );

  log.info(
    `[digests] weekly shortfall for ${org.name}: ${rows.length} below target, week of ${lastWeekStart}, ${delivered}/${total} delivered`
  );
}

async function runMemberWeeklySummary(
  db: DigestDb,
  org: OrgRow,
  members: (MemberInput & { role: string })[],
  lastWeekStart: string,
  now: Date,
  mail: DigestMailer,
  log: Logger
): Promise<void> {
  const fromMs = localDayStartMs(lastWeekStart, org.timezone);
  const toMs = localDayStartMs(addDays(lastWeekStart, 7), org.timezone);
  const sessions = await loadSessions(db, org.id, fromMs, toMs);
  const totals = weeklyTotals(
    members,
    sessions,
    lastWeekStart,
    org.timezone,
    org.dailyTargetMinutes,
    org.weeklyTargetMinutes,
    now
  );

  const byId = new Map(members.map((m) => [m.id, m]));
  const rangeLabel = formatWeekLabel(lastWeekStart, org.timezone);
  const dashboardUrl = `${appUrl()}/app/timesheets`;

  let delivered = 0;
  for (const row of totals) {
    const member = byId.get(row.userId);
    if (!member) continue;
    const ok = await mail.memberWeekly(member.email, {
      orgName: org.name,
      rangeLabel,
      name: displayName(member),
      trackedHours: row.trackedHours,
      targetHours: row.targetHours,
      dashboardUrl,
      dedupeKey: `member_weekly_summary:${org.id}:${lastWeekStart}:${member.email}`,
    });
    if (ok) delivered++;
    else
      log.warn(
        `[digests] weekly summary for week of ${lastWeekStart} not yet delivered to ${member.email} — queued for retry`
      );
  }

  await record(
    db,
    org.id,
    "member_weekly_summary",
    { periodKey: lastWeekStart, recipients: totals.length },
    log
  );

  log.info(
    `[digests] member weekly summaries for ${org.name}: ${delivered}/${totals.length} delivered`
  );
}

async function runUnusualActivity(
  db: DigestDb,
  org: OrgRow,
  members: (MemberInput & { role: string })[],
  dayKey: string,
  mail: DigestMailer,
  log: Logger
): Promise<void> {
  const fromMs = localDayStartMs(dayKey, org.timezone);
  const toMs = localDayStartMs(addDays(dayKey, 1), org.timezone);

  let flags: FlagRow[] = [];
  try {
    const rows = await db.unusualActivityFlag.findMany({
      where: {
        detectedAt: { gte: new Date(fromMs), lt: new Date(toMs) },
        session: { user: { orgId: org.id } },
      },
      select: {
        type: true,
        session: { select: { user: { select: { email: true, name: true } } } },
      },
    });
    flags = (rows as unknown as {
      type: string;
      session: { user: { email: string; name: string | null } | null } | null;
    }[]).map((f) => ({
      member: f.session?.user?.name?.trim() || f.session?.user?.email || "Deleted member",
      type: f.type,
    }));
  } catch (err) {
    log.warn(
      `[digests] could not load flags for org ${org.id}: ${err instanceof Error ? err.message : err}`
    );
    return;
  }

  // Nothing flagged is the normal case — say nothing rather than mail a daily
  // "no anomalies" note that trains admins to ignore the whole channel. Note
  // this also leaves no Notification row, so a quiet day stays a candidate for
  // the rest of the catch-up window: if a session syncs late and is flagged
  // afterwards, the digest still goes out.
  if (flags.length === 0) return;

  const rangeLabel = formatDayLabel(dayKey, org.timezone);
  const dashboardUrl = `${appUrl()}/app/insights`;

  const { delivered, total } = await mailAdmins(
    members,
    `unusual-activity digest for ${dayKey}`,
    log,
    (email) =>
      mail.unusual(email, {
        orgName: org.name,
        rangeLabel,
        flags,
        dashboardUrl,
        dedupeKey: `unusual_activity_digest:${org.id}:${dayKey}:${email}`,
      })
  );

  await record(
    db,
    org.id,
    "unusual_activity_digest",
    { periodKey: dayKey, flagCount: flags.length },
    log
  );

  log.info(
    `[digests] unusual-activity digest for ${org.name}: ${flags.length} flags on ${dayKey}, ${delivered}/${total} delivered`
  );
}

/**
 * One pass over every org. Exported for tests and for a manual trigger; the
 * interval below is the only thing that calls it in production.
 */
export async function runDigests(
  db: DigestDb,
  log: Logger,
  now: Date = new Date(),
  mail: DigestMailer = realMailer
): Promise<void> {
  const orgs = await loadOrgs(db);

  for (const org of orgs) {
    try {
      const tz = org.timezone; // already normalised by loadOrgs
      if (localHour(now, tz) < SEND_HOUR) continue; // not morning there yet

      const todayKey = localDayKey(now, tz);
      const thisWeekStart = weekStartKey(todayKey);
      const lastWeekStart = addDays(thisWeekStart, -7);
      // 0 is Monday. The weekly digests are due then, but stay claimable for a
      // few days after so a Monday spent hibernating does not lose the week.
      const daysSinceMonday = weekdayIndex(todayKey);

      const members = await loadMembers(db, org.id);
      if (members.length === 0) continue;

      // The master switch. Digests still get recorded in-app below when their own
      // toggle is on — turning email off should not blind the notification bell.
      //
      // Reports success: from the digest's point of view "email is switched off"
      // is not a delivery failure, and treating it as one would log a warning per
      // admin per period.
      const silent: DigestMailer = {
        daily: async () => true,
        weekly: async () => true,
        unusual: async () => true,
        memberWeekly: async () => true,
      };
      const out = org.emailsEnabled ? mail : silent;

      if (org.notifyDailyShortfall) {
        const sent = await sentPeriods(db, org.id, "daily_shortfall", log);
        if (sent) {
          for (const day of missingDays(todayKey, sent)) {
            await runDailyShortfall(db, org, members, day, now, out, log);
          }
        }
      }

      if (org.notifyUnusualActivity) {
        const sent = await sentPeriods(db, org.id, "unusual_activity_digest", log);
        if (sent) {
          for (const day of missingDays(todayKey, sent)) {
            await runUnusualActivity(db, org, members, day, out, log);
          }
        }
      }

      if (daysSinceMonday < WEEKLY_CATCHUP_DAYS) {
        if (org.notifyWeeklyShortfall) {
          const sent = await sentPeriods(db, org.id, "weekly_shortfall", log);
          if (sent && weeklyDue(lastWeekStart, sent, daysSinceMonday)) {
            await runWeeklyShortfall(db, org, members, lastWeekStart, now, out, log);
          }
        }
        if (org.notifyMemberWeeklySummary) {
          const sent = await sentPeriods(db, org.id, "member_weekly_summary", log);
          if (sent && weeklyDue(lastWeekStart, sent, daysSinceMonday)) {
            await runMemberWeeklySummary(db, org, members, lastWeekStart, now, out, log);
          }
        }
      }
    } catch (err) {
      // One bad org must not stop the rest.
      log.warn(
        `[digests] org ${org.id} failed: ${err instanceof Error ? err.message : err}`
      );
    }
  }
}

export function startDigestScheduler(log: Logger, db: DigestDb): void {
  const run = () =>
    runDigests(db, log).catch((err) =>
      log.warn(`[digests] pass failed: ${err instanceof Error ? err.message : err}`)
    );

  void run();
  const timer = setInterval(run, DIGEST_INTERVAL_MS);
  // Never hold the process open on its own account, exactly as the sweeper does.
  timer.unref();
}
