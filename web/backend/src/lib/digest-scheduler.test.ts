import test from "node:test";
import assert from "node:assert/strict";
import type { PrismaClient } from "@prisma/client";
import { runDigests, SEND_HOUR, type DigestMailer } from "./digest-scheduler";

/**
 * Lagos is UTC+1 with no DST, so "08:00 local" is a fixed 07:00 UTC all year and
 * these tests never drift with the seasons.
 */
const TZ = "Africa/Lagos";

/** Tuesday 18 August 2026, 08:30 in Lagos. */
const TUESDAY_MORNING = new Date("2026-08-18T07:30:00.000Z");
/** The same Tuesday, 06:30 local — before the send hour. */
const TUESDAY_EARLY = new Date("2026-08-18T05:30:00.000Z");
/** Monday 17 August 2026, 08:30 in Lagos. */
const MONDAY_MORNING = new Date("2026-08-17T07:30:00.000Z");

const silentLog = { info: () => {}, warn: () => {} };

type Sent = { kind: string; to: string };

function makeMailer(sent: Sent[]): DigestMailer {
  const record = (kind: string) => async (to: string) => {
    sent.push({ kind, to });
    return true;
  };
  return {
    daily: record("daily") as DigestMailer["daily"],
    weekly: record("weekly") as DigestMailer["weekly"],
    unusual: record("unusual") as DigestMailer["unusual"],
    memberWeekly: record("memberWeekly") as DigestMailer["memberWeekly"],
  };
}

type Row = Record<string, unknown>;

function makeDb(opts: {
  org?: Partial<Row>;
  members?: Row[];
  sessions?: Row[];
  flags?: Row[];
  lookupThrows?: boolean;
  /** Digests already on record, as `[type, periodKey]` — the history that makes
   *  catch-up distinguishable from a first-ever run. */
  alreadySent?: [type: string, periodKey: string][];
}) {
  const notifications: Row[] = (opts.alreadySent ?? []).map(([type, periodKey]) => ({
    orgId: "org1",
    userId: null,
    type,
    payload: { periodKey },
    createdAt: new Date("2000-01-01T00:00:00.000Z"),
  }));
  const org: Row = {
    id: "org1",
    name: "Acme",
    timezone: TZ,
    dailyTargetMinutes: 480,
    weeklyTargetMinutes: 2400,
    emailsEnabled: true,
    notifyDailyShortfall: true,
    notifyWeeklyShortfall: true,
    notifyUnusualActivity: true,
    notifyMemberWeeklySummary: false,
    ...opts.org,
  };
  const members = opts.members ?? [
    {
      id: "admin1",
      email: "admin@acme.test",
      name: "Ada",
      role: "admin",
      dailyTargetMinutes: null,
      weeklyTargetMinutes: null,
    },
    {
      id: "u1",
      email: "jordan@acme.test",
      name: "Jordan",
      role: "member",
      dailyTargetMinutes: null,
      weeklyTargetMinutes: null,
    },
  ];

  /** Whatever instant the run under test is using, so created rows land in-period. */
  let clock = new Date();
  const db = {
    organization: { findMany: async () => [org] },
    user: { findMany: async () => members },
    trackingSession: { findMany: async () => opts.sessions ?? [] },
    unusualActivityFlag: { findMany: async () => opts.flags ?? [] },
    notification: {
      findMany: async (args: { where: Row }) => {
        if (opts.lookupThrows) throw new Error("relation does not exist");
        const w = args.where as { orgId: string; type: string };
        return notifications.filter((n) => n.orgId === w.orgId && n.type === w.type);
      },
      create: async (args: { data: Row }) => {
        notifications.push({ ...args.data, createdAt: clock });
        return args.data;
      },
    },
  } as unknown as PrismaClient;

  return {
    db,
    notifications,
    setClock: (d: Date) => {
      clock = d;
    },
  };
}

/**
 * The periods THIS run recorded, in order. Seeded history is stamped in the year
 * 2000 so it can be told apart from anything the run under test wrote.
 */
function recorded(harness: ReturnType<typeof makeDb>, type: string): unknown[] {
  return harness.notifications
    .filter((n) => n.type === type && (n.createdAt as Date).getUTCFullYear() > 2000)
    .map((n) => (n.payload as Row).periodKey);
}

async function run(harness: ReturnType<typeof makeDb>, now: Date, sent: Sent[]) {
  harness.setClock(now);
  await runDigests(harness.db, silentLog, now, makeMailer(sent));
}

test("nothing is sent before the org's local send hour", async () => {
  const sent: Sent[] = [];
  const h = makeDb({});
  await run(h, TUESDAY_EARLY, sent);
  assert.deepEqual(sent, []);
  assert.equal(h.notifications.length, 0);
});

test("the daily digest goes to admins once the local morning arrives", async () => {
  const sent: Sent[] = [];
  const h = makeDb({});
  await run(h, TUESDAY_MORNING, sent);

  const daily = sent.filter((s) => s.kind === "daily");
  assert.equal(daily.length, 1);
  assert.equal(daily[0].to, "admin@acme.test"); // admins only, never the member
  assert.equal(h.notifications.filter((n) => n.type === "daily_shortfall").length, 1);
});

test("a second tick on the same local day does not resend", async () => {
  const sent: Sent[] = [];
  const h = makeDb({});
  await run(h, TUESDAY_MORNING, sent);
  await run(h, new Date("2026-08-18T09:00:00.000Z"), sent); // 10:00 local, same day

  assert.equal(sent.filter((s) => s.kind === "daily").length, 1);
  assert.equal(h.notifications.filter((n) => n.type === "daily_shortfall").length, 1);
});

test("a toggled-off digest is neither sent nor recorded", async () => {
  const sent: Sent[] = [];
  const h = makeDb({ org: { notifyDailyShortfall: false } });
  await run(h, TUESDAY_MORNING, sent);

  assert.deepEqual(sent.filter((s) => s.kind === "daily"), []);
  assert.equal(h.notifications.filter((n) => n.type === "daily_shortfall").length, 0);
});

test("the master switch silences email but keeps the in-app record", async () => {
  // Turning email off should not blind the notification bell — an admin who
  // opted out of mail still needs the dashboard to tell them what happened.
  const sent: Sent[] = [];
  const h = makeDb({ org: { emailsEnabled: false } });
  await run(h, TUESDAY_MORNING, sent);

  assert.deepEqual(sent, []);
  assert.equal(h.notifications.filter((n) => n.type === "daily_shortfall").length, 1);
});

test("an org-wide digest is recorded with no userId, which is what makes it admin-only", async () => {
  const sent: Sent[] = [];
  const h = makeDb({});
  await run(h, TUESDAY_MORNING, sent);

  const row = h.notifications.find((n) => n.type === "daily_shortfall");
  assert.equal(row?.userId, null);
  assert.equal(row?.orgId, "org1");
});

test("the weekly digest waits for Monday", async () => {
  // No history, so no catch-up is owed: an org whose first pass lands on a
  // Tuesday is not handed last week's review out of nowhere.
  const sent: Sent[] = [];
  const h = makeDb({});
  await run(h, TUESDAY_MORNING, sent);
  assert.deepEqual(sent.filter((s) => s.kind === "weekly"), []);
});

test("a Monday spent hibernating is caught up on the Tuesday", async () => {
  // The reason this exists: the API runs on an instance that sleeps, so "it is
  // Monday" is no guarantee any process was alive to notice. With a previous
  // week on record, the missed week is still owed.
  const sent: Sent[] = [];
  const h = makeDb({ alreadySent: [["weekly_shortfall", "2026-08-03"]] });
  await run(h, TUESDAY_MORNING, sent);

  assert.equal(sent.filter((s) => s.kind === "weekly").length, 1);
  const row = h.notifications.find(
    (n) => n.type === "weekly_shortfall" && (n.payload as Row)?.periodKey === "2026-08-10"
  );
  assert.ok(row, "the missed week should be recorded once it is sent");
});

test("the weekly catch-up window closes rather than mailing all week", async () => {
  // Thursday is outside it. A weekly review that turns up on Friday is noise.
  const sent: Sent[] = [];
  const h = makeDb({ alreadySent: [["weekly_shortfall", "2026-08-03"]] });
  await run(h, new Date("2026-08-20T07:30:00.000Z"), sent); // Thursday
  assert.deepEqual(sent.filter((s) => s.kind === "weekly"), []);
});

test("a day the process slept through is caught up, oldest first", async () => {
  // The bug this pins: idempotency used to be "has anything of this type been
  // written since local midnight", so a day whose send hour passed while the
  // instance was asleep could never be recovered — the window had moved on.
  const sent: Sent[] = [];
  const h = makeDb({ alreadySent: [["daily_shortfall", "2026-08-15"]] });
  await run(h, TUESDAY_MORNING, sent); // Tuesday 18th: the 16th and 17th are owed

  assert.deepEqual(recorded(h, "daily_shortfall"), ["2026-08-16", "2026-08-17"]);
  assert.equal(sent.filter((s) => s.kind === "daily").length, 2);
});

test("catch-up never reaches back past what was already sent", async () => {
  // Otherwise a digest deliberately skipped — toggle off, no members yet —
  // reappears the moment it falls behind the high-water mark.
  const sent: Sent[] = [];
  const h = makeDb({ alreadySent: [["daily_shortfall", "2026-08-17"]] });
  await run(h, TUESDAY_MORNING, sent);
  assert.deepEqual(sent.filter((s) => s.kind === "daily"), []);
});

test("a first-ever pass sends yesterday only, never a backfill", async () => {
  const sent: Sent[] = [];
  const h = makeDb({});
  await run(h, TUESDAY_MORNING, sent);

  assert.deepEqual(recorded(h, "daily_shortfall"), ["2026-08-17"]);
});

test("the weekly digest goes out on Monday morning, for the week just ended", async () => {
  const sent: Sent[] = [];
  const h = makeDb({});
  await run(h, MONDAY_MORNING, sent);

  assert.equal(sent.filter((s) => s.kind === "weekly").length, 1);
  const row = h.notifications.find((n) => n.type === "weekly_shortfall");
  assert.equal((row?.payload as Row)?.periodKey, "2026-08-10"); // the PREVIOUS Monday
});

test("member weekly summaries are opt-in, and reach every member when opted into", async () => {
  const off: Sent[] = [];
  await run(makeDb({}), MONDAY_MORNING, off);
  assert.deepEqual(off.filter((s) => s.kind === "memberWeekly"), []);

  const on: Sent[] = [];
  await run(makeDb({ org: { notifyMemberWeeklySummary: true } }), MONDAY_MORNING, on);
  assert.deepEqual(
    on.filter((s) => s.kind === "memberWeekly").map((s) => s.to).sort(),
    ["admin@acme.test", "jordan@acme.test"]
  );
});

test("a quiet day sends no unusual-activity mail at all", async () => {
  // Mailing "no anomalies" every morning trains admins to ignore the channel.
  const sent: Sent[] = [];
  const h = makeDb({ flags: [] });
  await run(h, TUESDAY_MORNING, sent);

  assert.deepEqual(sent.filter((s) => s.kind === "unusual"), []);
  assert.equal(h.notifications.filter((n) => n.type === "unusual_activity_digest").length, 0);
});

test("flags raised yesterday are digested to admins", async () => {
  const sent: Sent[] = [];
  const h = makeDb({
    flags: [
      {
        type: "jiggler_process_detected",
        session: { user: { email: "jordan@acme.test", name: "Jordan" } },
      },
    ],
  });
  await run(h, TUESDAY_MORNING, sent);

  assert.equal(sent.filter((s) => s.kind === "unusual").length, 1);
  assert.equal(sent.find((s) => s.kind === "unusual")?.to, "admin@acme.test");
});

test("a failing already-sent check skips the send rather than mailing every tick", async () => {
  // Fail-closed. Guessing "not sent yet" turns one broken query into an email
  // every fifteen minutes, which is far worse than a missed digest.
  const sent: Sent[] = [];
  const h = makeDb({ lookupThrows: true });
  await run(h, TUESDAY_MORNING, sent);

  assert.deepEqual(sent, []);
});

test("every digest carries a dedupe key of org, period and recipient", async () => {
  // This, not the Notification row, is what makes the job safe to re-run: the
  // mail is queued BEFORE the row is written, so a crash between the two has to
  // be recoverable without anyone being mailed twice.
  const keys: (string | undefined)[] = [];
  const h = makeDb({});
  const capture: DigestMailer = {
    daily: (async (_to: string, input: { dedupeKey?: string }) => {
      keys.push(input.dedupeKey);
      return true;
    }) as DigestMailer["daily"],
    weekly: async () => true,
    unusual: async () => true,
    memberWeekly: async () => true,
  };
  await runDigests(h.db, silentLog, TUESDAY_MORNING, capture);

  assert.deepEqual(keys, ["daily_shortfall:org1:2026-08-17:admin@acme.test"]);
});

test("a blank or unknown zone falls back to the UTC+1 default, not to UTC", async () => {
  // 07:30 UTC is 08:30 in Lagos — due on the fallback, but an hour early if the
  // fallback were UTC. The pair pins which zone the fallback actually is.
  const due: Sent[] = [];
  await run(makeDb({ org: { timezone: "" } }), new Date("2026-08-18T07:30:00.000Z"), due);
  assert.equal(due.filter((s) => s.kind === "daily").length, 1);

  const tooEarly: Sent[] = [];
  await run(makeDb({ org: { timezone: "Not/AZone" } }), new Date("2026-08-18T06:30:00.000Z"), tooEarly);
  assert.deepEqual(tooEarly, []);
});

test("the send hour is the org's local morning, not the server's", async () => {
  const sent: Sent[] = [];
  // 07:30 UTC is 08:30 in Lagos (due) but only 07:30 in London during winter.
  const lagos = makeDb({ org: { timezone: TZ } });
  await run(lagos, new Date("2026-12-15T07:30:00.000Z"), sent);
  assert.equal(sent.filter((s) => s.kind === "daily").length, 1);

  const london = makeDb({ org: { timezone: "Europe/London" } });
  const sentLondon: Sent[] = [];
  await run(london, new Date("2026-12-15T07:30:00.000Z"), sentLondon);
  assert.equal(SEND_HOUR, 8);
  assert.deepEqual(sentLondon, []);
});
