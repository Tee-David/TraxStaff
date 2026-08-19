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
 * Idempotency lives in the `Notification` table rather than a new column: each
 * digest writes one row, and the next tick refuses to send a period that
 * already has one. The check is deliberately FAIL-CLOSED — if the lookup itself
 * errors we skip the send, because the failure mode of guessing "not sent yet"
 * is an email every fifteen minutes.
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
 * Whether this period's digest already went out.
 *
 * Fail-closed: a thrown lookup returns `true` (treat as sent). Guessing the
 * other way turns one broken query into an email every fifteen minutes.
 */
async function alreadySent(
  db: DigestDb,
  orgId: string,
  type: string,
  periodStartMs: number,
  log: Logger
): Promise<boolean> {
  try {
    const row = await db.notification.findFirst({
      where: { orgId, type, createdAt: { gte: new Date(periodStartMs) } },
      select: { id: true },
    });
    return row !== null;
  } catch (err) {
    log.warn(
      `[digests] could not check whether ${type} was already sent for org ${orgId} (${
        err instanceof Error ? err.message : err
      }) — skipping this tick rather than risking a duplicate.`
    );
    return true;
  }
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
  todayKey: string,
  now: Date,
  mail: DigestMailer,
  log: Logger
): Promise<void> {
  const yesterday = addDays(todayKey, -1);
  const fromMs = localDayStartMs(yesterday, org.timezone);
  const toMs = localDayStartMs(todayKey, org.timezone);

  const sessions = await loadSessions(db, org.id, fromMs, toMs);
  const rows = dailyShortfalls(
    members,
    sessions,
    yesterday,
    org.timezone,
    org.dailyTargetMinutes,
    org.weeklyTargetMinutes,
    now
  );

  // Recorded before sending: if the process dies between the two, the cost is a
  // missed digest, not the same digest every quarter of an hour thereafter.
  const recorded = await record(
    db,
    org.id,
    "daily_shortfall",
    {
      periodKey: yesterday,
      shortfallCount: rows.length,
      totalMembers: members.length,
      targetMinutes: org.dailyTargetMinutes,
      members: rows.map((r) => ({ name: r.name, trackedHours: r.trackedHours })),
    },
    log
  );
  if (!recorded) return;

  const dashboardUrl = `${appUrl()}/app/timesheets`;
  const dateLabel = formatDayLabel(yesterday, org.timezone);
  for (const admin of adminsOf(members)) {
    await mail.daily(admin.email, {
      orgName: org.name,
      dateLabel,
      targetHours: org.dailyTargetMinutes / 60,
      totalMembers: members.length,
      dashboardUrl,
      rows: toMailRows(rows),
    });
  }
  log.info(`[digests] daily shortfall for ${org.name}: ${rows.length} below target on ${yesterday}`);
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

  const recorded = await record(
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
  if (!recorded) return;

  const dashboardUrl = `${appUrl()}/app/reports`;
  const rangeLabel = formatWeekLabel(lastWeekStart, org.timezone);
  for (const admin of adminsOf(members)) {
    await mail.weekly(admin.email, {
      orgName: org.name,
      rangeLabel,
      targetHours: org.weeklyTargetMinutes / 60,
      totalMembers: members.length,
      dashboardUrl,
      rows: toMailRows(rows),
    });
  }
  log.info(`[digests] weekly shortfall for ${org.name}: ${rows.length} below target, week of ${lastWeekStart}`);
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

  const recorded = await record(
    db,
    org.id,
    "member_weekly_summary",
    { periodKey: lastWeekStart, recipients: totals.length },
    log
  );
  if (!recorded) return;

  const byId = new Map(members.map((m) => [m.id, m]));
  const rangeLabel = formatWeekLabel(lastWeekStart, org.timezone);
  const dashboardUrl = `${appUrl()}/app/timesheets`;
  for (const row of totals) {
    const member = byId.get(row.userId);
    if (!member) continue;
    await mail.memberWeekly(member.email, {
      orgName: org.name,
      rangeLabel,
      name: displayName(member),
      trackedHours: row.trackedHours,
      targetHours: row.targetHours,
      dashboardUrl,
    });
  }
  log.info(`[digests] member weekly summaries for ${org.name}: ${totals.length} sent`);
}

async function runUnusualActivity(
  db: DigestDb,
  org: OrgRow,
  members: (MemberInput & { role: string })[],
  todayKey: string,
  mail: DigestMailer,
  log: Logger
): Promise<void> {
  const yesterday = addDays(todayKey, -1);
  const fromMs = localDayStartMs(yesterday, org.timezone);
  const toMs = localDayStartMs(todayKey, org.timezone);

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
  // "no anomalies" note that trains admins to ignore the whole channel.
  if (flags.length === 0) return;

  const recorded = await record(
    db,
    org.id,
    "unusual_activity_digest",
    { periodKey: yesterday, flagCount: flags.length },
    log
  );
  if (!recorded) return;

  const rangeLabel = formatDayLabel(yesterday, org.timezone);
  const dashboardUrl = `${appUrl()}/app/insights`;
  for (const admin of adminsOf(members)) {
    await mail.unusual(admin.email, { orgName: org.name, rangeLabel, flags, dashboardUrl });
  }
  log.info(`[digests] unusual-activity digest for ${org.name}: ${flags.length} flags on ${yesterday}`);
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
      const todayStartMs = localDayStartMs(todayKey, tz);
      const thisWeekStart = weekStartKey(todayKey);
      const thisWeekStartMs = localDayStartMs(thisWeekStart, tz);
      const isMonday = weekdayIndex(todayKey) === 0;

      // The master switch. Digests still get recorded in-app below when their own
      // toggle is on — turning email off should not blind the notification bell.
      const members = await loadMembers(db, org.id);
      if (members.length === 0) continue;

      const silent: DigestMailer = {
        daily: async () => false,
        weekly: async () => false,
        unusual: async () => false,
        memberWeekly: async () => false,
      };
      const out = org.emailsEnabled ? mail : silent;

      if (
        org.notifyDailyShortfall &&
        !(await alreadySent(db, org.id, "daily_shortfall", todayStartMs, log))
      ) {
        await runDailyShortfall(db, org, members, todayKey, now, out, log);
      }

      if (
        org.notifyUnusualActivity &&
        !(await alreadySent(db, org.id, "unusual_activity_digest", todayStartMs, log))
      ) {
        await runUnusualActivity(db, org, members, todayKey, out, log);
      }

      if (isMonday) {
        const lastWeekStart = addDays(thisWeekStart, -7);
        if (
          org.notifyWeeklyShortfall &&
          !(await alreadySent(db, org.id, "weekly_shortfall", thisWeekStartMs, log))
        ) {
          await runWeeklyShortfall(db, org, members, lastWeekStart, now, out, log);
        }
        if (
          org.notifyMemberWeeklySummary &&
          !(await alreadySent(db, org.id, "member_weekly_summary", thisWeekStartMs, log))
        ) {
          await runMemberWeeklySummary(db, org, members, lastWeekStart, now, out, log);
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
