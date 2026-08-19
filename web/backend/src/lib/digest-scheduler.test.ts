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
  findFirstThrows?: boolean;
}) {
  const notifications: Row[] = [];
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
      findFirst: async (args: { where: Row }) => {
        if (opts.findFirstThrows) throw new Error("relation does not exist");
        const w = args.where as { orgId: string; type: string; createdAt: { gte: Date } };
        return (
          notifications.find(
            (n) =>
              n.orgId === w.orgId &&
              n.type === w.type &&
              (n.createdAt as Date).getTime() >= w.createdAt.gte.getTime()
          ) ?? null
        );
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
  const sent: Sent[] = [];
  const h = makeDb({});
  await run(h, TUESDAY_MORNING, sent);
  assert.deepEqual(sent.filter((s) => s.kind === "weekly"), []);
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
  const h = makeDb({ findFirstThrows: true });
  await run(h, TUESDAY_MORNING, sent);

  assert.deepEqual(sent, []);
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
