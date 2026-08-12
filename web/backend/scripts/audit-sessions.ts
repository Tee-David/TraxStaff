/**
 * Find tracking sessions whose recorded duration credits an outage as work.
 *
 * READ-ONLY by default. Pass `--fix` to correct them, and only after reading the
 * report: this rewrites hours people may already have been paid for.
 *
 *   npx tsx scripts/audit-sessions.ts              # report only
 *   npx tsx scripts/audit-sessions.ts --fix        # apply corrections
 *   npx tsx scripts/audit-sessions.ts --hours 6    # widen the suspicion threshold
 *   npx tsx scripts/audit-sessions.ts --user a@b.c # one member only
 *
 * WHY THIS EXISTS
 *
 * Two defects wrote wrong end times, both now fixed in the code:
 *
 *  1. `POST /sessions/start` finalized a same-device takeover at `new Date()`. A
 *     session left open on Monday evening and resumed on Wednesday morning was
 *     closed with `endedAt = now` and stamped `endReason: "stopped"` — crediting
 *     every hour the machine was off, and recording it as a clean stop so nothing
 *     downstream could tell it apart from a real shift.
 *  2. `POST /sessions/:id/stop` did the same for a session abandoned before the
 *     stop was posted.
 *
 * Rows still open are handled automatically by lib/stale-sessions.ts. Rows already
 * closed at the wrong instant are NOT — nothing revisits a session with an
 * `endedAt`, so without this script the inflated hours stay on record forever.
 *
 * The correction moves `endedAt` to the last instant we have evidence the session
 * was alive, exactly as the live code now does, and writes an AuditLog entry so an
 * adjustment to somebody's hours is never silent.
 *
 * COVERAGE GAPS — the third and worst case
 *
 * A session can look perfectly alive and still be mostly fiction. The reported
 * incident was one: opened Monday 17:09, the app closed an hour later without
 * stopping, and reopened on Wednesday morning — at which point the desktop app
 * silently adopted the still-open row and seeded its timer with wall-clock since
 * `startedAt`, resurrecting 39.9 hours the app had not been running for. Its
 * heartbeat, `lastSyncAt` and newest block are all current, because it genuinely IS
 * tracking now, so nothing above can tell there is a two-day hole in the middle.
 *
 * The activity blocks can. Capture writes one every ten minutes while it runs, so a
 * long stretch with no block at all is a stretch where nothing was being tracked.
 * That gap is recorded as an IdleDiscard: the mechanism this product already has for
 * "time that shouldn't count", reversible, and subtracted by `workedSeconds`
 * everywhere without mutating the hash-chained blocks.
 */

// FIRST: loads the repo-root .env, which lib/prisma.ts reads at import time.
// Without this the client is constructed with an undefined datasource URL.
import "../src/env";
import { STALE_GRACE_MS, lastEvidenceAt } from "../src/lib/duration";
import { auditLog } from "../src/lib/audit";
// Reuses the app's client so the CockroachDB TLS root cert is wired up the same
// way it is in production — a second, hand-rolled PrismaClient here would fail
// the `sslmode=verify-full` handshake.
import { prisma } from "../src/lib/prisma";

/**
 * Sessions longer than this are worth a look. Not a verdict — a night shift is
 * legitimately long — so every candidate is judged on its evidence, not its length.
 */
const DEFAULT_SUSPICIOUS_HOURS = 12;

/**
 * A stretch with no activity block at all, longer than this, is treated as time the
 * tracker was not running.
 *
 * Generous on purpose. Blocks are ten minutes, so ordinary boundary jitter is
 * seconds; 30 minutes is far outside that but far inside the multi-hour holes this
 * is for. It also protects the one case where the timer legitimately runs without
 * blocks — `begin_capture` failing, which the app warns about loudly — from being
 * quietly written off over a few minutes.
 */
const GAP_MINUTES = Number(argValue("gap") ?? 30);

function argValue(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const FIX = process.argv.includes("--fix");
const SUSPICIOUS_HOURS = Number(argValue("hours") ?? DEFAULT_SUSPICIOUS_HOURS);
const ONLY_USER = argValue("user");

function hhmm(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}h ${String(m).padStart(2, "0")}m`;
}

async function main() {
  const cutoffMs = SUSPICIOUS_HOURS * 3_600_000;

  const rows = await prisma.trackingSession.findMany({
    where: {
      // Manual entries are somebody's deliberate claim about their own time, not
      // something the tracker measured. Correcting those would be overruling a
      // person, which is not this script's business.
      isManual: false,
      ...(ONLY_USER ? { user: { email: ONLY_USER } } : {}),
    },
    select: {
      id: true,
      startedAt: true,
      endedAt: true,
      endReason: true,
      lastSyncAt: true,
      user: { select: { email: true } },
      // orgId comes via the project: an orphaned session (owner hard-deleted) has
      // no user to ask, and its hours still belong to the org.
      project: { select: { name: true, orgId: true } },
      device: { select: { lastSeenAt: true } },
    },
    orderBy: { startedAt: "desc" },
  });

  // Blocks and discards are fetched separately, in chunks, rather than as nested
  // includes on the query above.
  //
  // Gap detection needs EVERY block of every session (the staleness check only
  // needed the newest), and asking for that as one nested include pulls the whole
  // hash chain of every session in the org in a single statement — which this
  // serverless cluster intermittently drops, surfacing as Prisma's misleading
  // "Can't reach database server". Chunking keeps each statement small and makes
  // the script safe to re-run.
  const CHUNK = 25;
  const blocksBySession = new Map<string, { blockStart: Date; blockEnd: Date }[]>();
  const discardsBySession = new Map<string, { from: Date; to: Date }[]>();
  for (let i = 0; i < rows.length; i += CHUNK) {
    const ids = rows.slice(i, i + CHUNK).map((r) => r.id);
    const [blocks, discards] = await Promise.all([
      prisma.activityBlock.findMany({
        where: { sessionId: { in: ids } },
        select: { sessionId: true, blockStart: true, blockEnd: true },
        orderBy: { blockStart: "asc" },
      }),
      prisma.idleDiscard.findMany({
        where: { sessionId: { in: ids } },
        select: { sessionId: true, from: true, to: true },
      }),
    ]);
    for (const b of blocks) {
      const list = blocksBySession.get(b.sessionId) ?? [];
      list.push({ blockStart: b.blockStart, blockEnd: b.blockEnd });
      blocksBySession.set(b.sessionId, list);
    }
    for (const d of discards) {
      const list = discardsBySession.get(d.sessionId) ?? [];
      list.push({ from: d.from, to: d.to });
      discardsBySession.set(d.sessionId, list);
    }
  }
  const blocksOf = (id: string) => blocksBySession.get(id) ?? [];
  const discardsOf = (id: string) => discardsBySession.get(id) ?? [];

  // ── Coverage gaps ─────────────────────────────────────────────────────────
  //
  // Stretches inside a session with no activity block at all. Only the span
  // between blocks counts: a session may legitimately start slightly before its
  // first block, and the tail is the staleness check's job, not this one.
  const gapFindings = rows
    .map((r) => {
      const blocks = blocksOf(r.id);
      const gaps: { from: Date; to: Date; secs: number }[] = [];
      for (let i = 1; i < blocks.length; i++) {
        const from = blocks[i - 1].blockEnd;
        const to = blocks[i].blockStart;
        const secs = (to.getTime() - from.getTime()) / 1000;
        if (secs <= GAP_MINUTES * 60) continue;
        // Skip anything already accounted for — this script must be re-runnable
        // without stacking a second deduction for the same minutes.
        const covered = discardsOf(r.id).some(
          (d) => d.from.getTime() <= from.getTime() + 1000 && d.to.getTime() >= to.getTime() - 1000
        );
        if (!covered) gaps.push({ from, to, secs });
      }
      return { r, gaps, totalSecs: gaps.reduce((a, g) => a + g.secs, 0) };
    })
    .filter((f) => f.gaps.length > 0)
    .sort((a, b) => b.totalSecs - a.totalSecs);

  const findings = rows
    .map((r) => {
      const evidence = lastEvidenceAt({ ...r, latestBlockEnd: blocksOf(r.id).at(-1)?.blockEnd ?? null });
      // What the row currently claims. An open row claims "until now".
      const claimedEnd = r.endedAt ?? new Date();
      const claimedSecs = (claimedEnd.getTime() - r.startedAt.getTime()) / 1000;
      // What the evidence supports, with the same grace window the live code uses.
      const supportedEnd = new Date(
        Math.min(claimedEnd.getTime(), evidence.getTime() + STALE_GRACE_MS)
      );
      const supportedSecs = Math.max(0, (supportedEnd.getTime() - r.startedAt.getTime()) / 1000);
      return { r, claimedEnd, claimedSecs, supportedEnd, supportedSecs, overSecs: claimedSecs - supportedSecs };
    })
    // Only rows where the evidence contradicts the record by more than the grace
    // window AND the total is long enough to matter. A minute of clock jitter on a
    // normal session is not a finding.
    .filter((f) => f.overSecs > STALE_GRACE_MS / 1000 && f.claimedSecs > cutoffMs / 1000)
    .sort((a, b) => b.overSecs - a.overSecs);

  console.log(`\nScanned ${rows.length} tracked sessions.\n`);

  console.log(
    `── A. Ends later than the evidence supports (${findings.length}) ` +
      `— sessions over ${SUSPICIOUS_HOURS}h whose device had already gone quiet\n`
  );
  if (findings.length === 0) {
    console.log("  none\n");
  } else {
    console.log(
      ["  member", "project", "started", "recorded end", "claims", "supported", "over by", "reason"].join(" | ")
    );
    for (const f of findings) {
      console.log(
        [
          "  " + (f.r.user?.email ?? "(deleted user)"),
          f.r.project.name,
          f.r.startedAt.toISOString(),
          f.r.endedAt ? f.r.endedAt.toISOString() : "(still open)",
          hhmm(f.claimedSecs),
          hhmm(f.supportedSecs),
          hhmm(f.overSecs),
          f.r.endReason ?? "(none)",
        ].join(" | ")
      );
    }
    console.log("");
  }

  console.log(
    `── B. Holes with no activity blocks (${gapFindings.length}) ` +
      `— stretches over ${GAP_MINUTES}m where nothing was being tracked\n`
  );
  if (gapFindings.length === 0) {
    console.log("  none\n");
  } else {
    for (const f of gapFindings) {
      console.log(
        `  ${f.r.user?.email ?? "(deleted user)"} · ${f.r.project.name} · started ${f.r.startedAt.toISOString()}` +
          ` · ${f.r.endedAt ? "closed" : "STILL OPEN"} · ${hhmm(f.totalSecs)} untracked in ${f.gaps.length} hole(s)`
      );
      for (const g of f.gaps) {
        console.log(`      ${g.from.toISOString()} → ${g.to.toISOString()}  (${hhmm(g.secs)})`);
      }
    }
    console.log("");
  }

  const totalOver = findings.reduce((a, f) => a + f.overSecs, 0);
  const totalGap = gapFindings.reduce((a, f) => a + f.totalSecs, 0);
  console.log(`Credited without evidence: ${hhmm(totalOver)} (A) + ${hhmm(totalGap)} (B)\n`);

  if (!FIX) {
    console.log("Read-only. Re-run with --fix to apply these corrections.\n");
    return;
  }

  console.log("Applying corrections…\n");

  // B first: a coverage gap is recorded as an IdleDiscard, which is additive and
  // independent of where the session ends. Doing it before A means a row that has
  // both problems gets both, in either order, without one masking the other.
  let gapsFixed = 0;
  for (const f of gapFindings) {
    for (const g of f.gaps) {
      const existing = await prisma.idleDiscard.findFirst({
        where: { sessionId: f.r.id, from: g.from, to: g.to },
      });
      if (existing) continue;
      await prisma.idleDiscard.create({
        data: { sessionId: f.r.id, from: g.from, to: g.to, seconds: Math.round(g.secs) },
      });
      await auditLog({
        orgId: f.r.project.orgId,
        actorId: null,
        actorEmail: "stale-session backfill",
        action: "idle.discarded",
        targetId: f.r.id,
        targetLabel: `${f.r.user?.email ?? "(deleted user)"} · ${hhmm(g.secs)} untracked`,
        details: {
          reason: "no activity blocks recorded for this stretch",
          from: g.from.toISOString(),
          to: g.to.toISOString(),
          seconds: Math.round(g.secs),
        },
      });
      gapsFixed++;
    }
  }
  if (gapFindings.length > 0) console.log(`  B: recorded ${gapsFixed} untracked stretch(es)`);

  let fixed = 0;
  for (const f of findings) {
    // Guard on the value we measured: if anything changed since the scan, skip the
    // row rather than overwrite a newer, possibly correct, end time.
    const { count } = await prisma.trackingSession.updateMany({
      where: { id: f.r.id, endedAt: f.r.endedAt },
      data: { endedAt: f.supportedEnd, endReason: "abrupt_exit" },
    });
    if (count === 0) {
      console.log(`  skipped ${f.r.id} (changed since the scan)`);
      continue;
    }
    await auditLog({
      orgId: f.r.project.orgId,
      actorId: null,
      actorEmail: "stale-session backfill",
      action: "session.end_corrected",
      targetId: f.r.id,
      targetLabel: `${f.r.user?.email ?? "(deleted user)"} · ${hhmm(f.overSecs)} removed`,
      details: {
        startedAt: f.r.startedAt.toISOString(),
        wasEndedAt: f.r.endedAt?.toISOString() ?? null,
        wasEndReason: f.r.endReason,
        nowEndedAt: f.supportedEnd.toISOString(),
        removedSeconds: Math.round(f.overSecs),
      },
    });
    fixed++;
  }
  console.log(`  A: corrected ${fixed} of ${findings.length} session end(s)\n`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
