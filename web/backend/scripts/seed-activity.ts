/**
 * Generate a realistic week of tracked work, for exercising the reports,
 * timesheets, leaderboard and activity calibration against data that looks like
 * the real thing.
 *
 *   DATABASE_URL=<scratch> npx tsx scripts/seed-activity.ts \
 *     --email dev@example.com --total 43h22m --activity 65 --skip tue
 *
 * Flags (all optional):
 *   --email     who to attach the week to (created in the test org if absent)
 *   --total     total worked time for the week, e.g. `43h22m` (default 43h22m)
 *   --activity  target mean activity %, 0-100 (default 65)
 *   --skip      day(s) with no work at all, comma-separated (default `tue`)
 *   --week      ISO date inside the week to seed (default: last full week)
 *   --org       name of the test org (default `Seeded Fixtures [test]`)
 *
 * WHY THE GUARDS BELOW EXIST
 *
 * This writes tracking sessions, activity blocks and screenshots-shaped records
 * that are indistinguishable, once stored, from a person's real work record.
 * That is exactly what makes it useful as a fixture and exactly what makes it
 * dangerous: the same rows in a production database are a false record of what
 * somebody did, and this product's whole value is that its records are true.
 *
 * Two things therefore have to hold before it writes anything:
 *
 *  1. DATABASE_URL must be set explicitly AND differ from the one in .env. The
 *     backend's own `npm run dev` points at the live cluster, so a script that
 *     "just runs" would default to seeding production. There is no flag to
 *     override this.
 *  2. The target organisation must carry a `[test]` marker in its name. Seeded
 *     rows are additionally stamped so that if a dump is ever restored somewhere
 *     it should not be, they identify themselves rather than passing as work.
 *
 * The generated blocks are correctly hash-chained, so they verify cleanly rather
 * than tripping `tamperSuspected` and polluting every test of the anomaly path.
 */

import { PrismaClient } from "@prisma/client";
import { readFileSync } from "node:fs";
import path from "node:path";
import { canonical, computeHash, GENESIS } from "../src/lib/hashchain";

const SEED_MARKER = "seeded test data";
const TEST_ORG_MARKER = "[test]";
const BLOCK_SECONDS = 600;

const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
type Day = (typeof DAYS)[number];

// ── argument parsing ───────────────────────────────────────────────────────

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/** `43h22m`, `43h`, `22m` or a bare number of hours → seconds. */
function parseDuration(input: string): number {
  const m = /^(?:(\d+)h)?(?:(\d+)m)?$/.exec(input.trim());
  if (m && (m[1] || m[2])) return (+(m[1] ?? 0) * 60 + +(m[2] ?? 0)) * 60;
  const bare = Number(input);
  if (Number.isFinite(bare) && bare > 0) return Math.round(bare * 3600);
  throw new Error(`could not read --total "${input}" (try 43h22m)`);
}

// ── the guards ─────────────────────────────────────────────────────────────

/** The host in web/backend/.env or the repo root .env, if either exists. */
function configuredHost(): string | null {
  for (const p of [path.resolve(__dirname, "../.env"), path.resolve(__dirname, "../../../.env")]) {
    try {
      const m = /DATABASE_URL\s*=\s*"?([^"\n]+)"?/.exec(readFileSync(p, "utf8"));
      if (m) return new URL(m[1]).host;
    } catch {
      // No file, or an unparseable URL — try the next candidate.
    }
  }
  return null;
}

function assertScratchDatabase(): void {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set.\n" +
        "Point it at a scratch database explicitly — this script writes records that\n" +
        "are indistinguishable from a person's real work once stored."
    );
  }

  let host: string;
  try {
    host = new URL(url).host;
  } catch {
    throw new Error(`DATABASE_URL is not a valid URL: ${url}`);
  }

  const live = configuredHost();
  if (live && host === live) {
    throw new Error(
      `Refusing to run: DATABASE_URL points at ${host}, the same host configured in .env.\n` +
        "That is the live cluster. Seeded hours there would be a false record of somebody's\n" +
        "work. Start a scratch database and point DATABASE_URL at that instead."
    );
  }
}

// ── shaping the week ───────────────────────────────────────────────────────

/**
 * Split `totalSeconds` across the working days with a plausible, uneven shape —
 * a long start to the week, a short Friday, a little weekend work.
 *
 * Deliberately not `total / n`: an exactly equal split is the one distribution
 * that never occurs in real timesheets, and fixtures that cannot occur are
 * fixtures that hide bugs.
 */
function spreadHours(totalSeconds: number, days: Day[]): Map<Day, number> {
  const shape: Record<Day, number> = {
    mon: 1.18, tue: 1.05, wed: 1.12, thu: 0.96, fri: 0.82, sat: 0.44, sun: 0.30,
  };
  const weightTotal = days.reduce((sum, d) => sum + shape[d], 0);

  const out = new Map<Day, number>();
  let assigned = 0;
  days.forEach((d, i) => {
    if (i === days.length - 1) {
      out.set(d, totalSeconds - assigned); // last day absorbs the rounding
      return;
    }
    // Round to a whole block so the day is made of real 10-minute blocks.
    const secs = Math.round((totalSeconds * shape[d]) / weightTotal / BLOCK_SECONDS) * BLOCK_SECONDS;
    out.set(d, secs);
    assigned += secs;
  });
  return out;
}

/**
 * Per-block activity percentages averaging `target`, with enough spread to
 * exercise the reporting rather than sitting flat at one value — including a few
 * genuinely low blocks, since a week with no quiet stretches is not a real week.
 *
 * Seeded from the day index so a given invocation is reproducible.
 */
function activityCurve(count: number, target: number, dayIndex: number): number[] {
  let state = (dayIndex + 1) * 7919;
  const rand = () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };

  const raw = Array.from({ length: count }, (_, i) => {
    // One block in eight is a quiet one — reading, a call, a break not long
    // enough to trip the idle threshold.
    const quiet = i % 8 === 3;
    const jitter = (rand() - 0.5) * 24;
    return Math.max(0, Math.min(100, quiet ? target * 0.35 + jitter : target + jitter));
  });

  // Re-centre so the mean lands on the target despite the jitter and the quiet
  // blocks, then clamp again.
  const mean = raw.reduce((a, v) => a + v, 0) / raw.length;
  return raw.map((v) => +Math.max(0, Math.min(100, v + (target - mean))).toFixed(2));
}

/** Monday 00:00 UTC of the week containing `d`. */
function mondayOf(d: Date): Date {
  const out = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dow = (out.getUTCDay() + 6) % 7; // Mon = 0
  out.setUTCDate(out.getUTCDate() - dow);
  return out;
}

// ── main ───────────────────────────────────────────────────────────────────

async function main() {
  assertScratchDatabase();

  const email = arg("email") ?? "seed@example.com";
  const totalSeconds = parseDuration(arg("total") ?? "43h22m");
  const targetActivity = Number(arg("activity") ?? 65);
  const orgName = arg("org") ?? `Seeded Fixtures ${TEST_ORG_MARKER}`;
  const skip = new Set(
    (arg("skip") ?? "tue").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean) as Day[]
  );

  if (!Number.isFinite(targetActivity) || targetActivity < 0 || targetActivity > 100) {
    throw new Error(`--activity must be between 0 and 100, got "${arg("activity")}"`);
  }
  if (!orgName.includes(TEST_ORG_MARKER)) {
    throw new Error(
      `Refusing to run: --org "${orgName}" does not carry the ${TEST_ORG_MARKER} marker.\n` +
        "Seeded rows must live in an organisation that is obviously not a real one."
    );
  }
  for (const d of skip) {
    if (!DAYS.includes(d)) throw new Error(`--skip: "${d}" is not a day (use ${DAYS.join(",")})`);
  }

  const workDays = DAYS.filter((d) => !skip.has(d));
  if (workDays.length === 0) throw new Error("--skip leaves no days to seed");

  const prisma = new PrismaClient();
  try {
    const weekStart = mondayOf(
      arg("week") ? new Date(arg("week")!) : new Date(Date.now() - 7 * 86_400_000)
    );

    // Organization has no unique key on `name`, so this is find-then-create
    // rather than an upsert. Re-running the script reuses the same test org.
    const org =
      (await prisma.organization.findFirst({ where: { name: orgName } })) ??
      (await prisma.organization.create({ data: { name: orgName } }));

    const user = await prisma.user.upsert({
      where: { email },
      update: {},
      create: { email, orgId: org.id, role: "member", status: "active", name: "Seeded Member" },
    });
    if (user.orgId !== org.id) {
      throw new Error(
        `Refusing to run: ${email} already belongs to another organisation (${user.orgId}).\n` +
          "This script will not attach fabricated hours to an existing account."
      );
    }

    const project = await prisma.project.findFirst({ where: { orgId: org.id, name: "Seeded Project" } })
      ?? await prisma.project.create({ data: { orgId: org.id, name: "Seeded Project" } });

    const device = await prisma.device.findFirst({ where: { userId: user.id } })
      ?? await prisma.device.create({
        data: { userId: user.id, platform: "seed", appVersion: "0.0.0" },
      });

    const perDay = spreadHours(totalSeconds, workDays);

    console.log(`org      ${org.name} (${org.id})`);
    console.log(`member   ${email}`);
    console.log(`week of  ${weekStart.toISOString().slice(0, 10)}`);
    console.log(`total    ${(totalSeconds / 3600).toFixed(2)}h at ~${targetActivity}% activity`);
    console.log(`skipping ${[...skip].join(", ") || "nothing"}\n`);

    let grandTotal = 0;
    for (const day of workDays) {
      const seconds = perDay.get(day) ?? 0;
      if (seconds <= 0) continue;

      const dayIndex = DAYS.indexOf(day);
      const start = new Date(weekStart.getTime() + dayIndex * 86_400_000 + 9 * 3_600_000);
      const end = new Date(start.getTime() + seconds * 1000);

      const session = await prisma.trackingSession.create({
        data: {
          userId: user.id,
          projectId: project.id,
          deviceId: device.id,
          startedAt: start,
          endedAt: end,
          endReason: "stopped",
          lastSyncAt: end,
          // Stamped so these rows identify themselves rather than passing as
          // tracked work if this database is ever restored somewhere else.
          manualReason: SEED_MARKER,
        },
      });

      const blockCount = Math.max(1, Math.round(seconds / BLOCK_SECONDS));
      const curve = activityCurve(blockCount, targetActivity, dayIndex);

      let prevHash = GENESIS;
      const blocks = curve.map((pct, i) => {
        const blockStart = new Date(start.getTime() + i * BLOCK_SECONDS * 1000);
        const blockEnd = new Date(blockStart.getTime() + BLOCK_SECONDS * 1000);
        // Keyboard and mouse are the raw per-channel signal; keep them below the
        // union so the numbers are internally consistent and the channel-
        // imbalance detector sees something plausible.
        const keyboardPct = +(pct * 0.62).toFixed(2);
        const mousePct = +(pct * 0.55).toFixed(2);
        const idleSeconds = Math.max(0, Math.round(BLOCK_SECONDS * (1 - pct / 100)));

        const chainBlock = {
          sessionId: session.id,
          sequenceNo: i,
          blockStart: blockStart.toISOString(),
          blockEnd: blockEnd.toISOString(),
          keyboardPct,
          mousePct,
          activityPct: pct,
          idleSeconds,
        };
        const hash = computeHash(prevHash, chainBlock);
        const row = {
          sessionId: session.id,
          blockStart,
          blockEnd,
          keyboardPct,
          mousePct,
          activityPct: pct,
          idleSeconds,
          sequenceNo: i,
          prevHash,
          hash,
          creditedSeconds: BLOCK_SECONDS,
          suspendedSeconds: 0,
          clockSkewSeconds: 0,
          pauseDefinitionSecs: 3,
        };
        prevHash = hash;
        // Proof the fixture is internally consistent, not just plausible: if the
        // canonical string ever drifts from the backend's, this catches it here
        // instead of every seeded session showing up as tamper-suspected.
        if (computeHash(row.prevHash, chainBlock) !== hash) {
          throw new Error(`chain mismatch at seq ${i} — canonical() has drifted`);
        }
        void canonical(chainBlock);
        return row;
      });

      await prisma.activityBlock.createMany({ data: blocks, skipDuplicates: true });

      const mean = curve.reduce((a, v) => a + v, 0) / curve.length;
      grandTotal += seconds;
      console.log(
        `  ${day}  ${(seconds / 3600).toFixed(2).padStart(5)}h  ` +
          `${blocks.length.toString().padStart(3)} blocks  mean ${mean.toFixed(1)}%`
      );
    }

    console.log(`\nseeded ${(grandTotal / 3600).toFixed(2)}h across ${workDays.length} days`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(`\n${err instanceof Error ? err.message : err}\n`);
  process.exit(1);
});
