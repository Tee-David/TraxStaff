/**
 * The platform-level trail, and the undo buffer that sits beside it.
 *
 * Two things a cross-tenant, destructive surface needs and the org-facing
 * `lib/audit.ts` cannot provide:
 *
 * 1. **A record only platform staff can read.** Org admins must not learn that
 *    an account above theirs exists (see `auditActorVisibility` in
 *    lib/superadmin.ts), but "nobody can see what platform staff did" stops
 *    being acceptable the moment more than one person holds the role. A
 *    separate table keeps both true at once.
 *
 * 2. **A way back.** `/admin/time`'s `replace` deletes tracked work. It can do
 *    that safely because the images survive: `prisma.screenshot.deleteMany`
 *    removes rows only, and `deleteObject` (lib/r2.ts) is called exclusively by
 *    `DELETE /screenshots/:id`. So the rows can be serialised before they go and
 *    written back afterwards, with every image still in the bucket where the
 *    restored row expects to find it.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";

/**
 * Every action the platform trail records. A closed union for the same reason
 * `AuditAction` is one: a typo should be a compile error, not an entry nobody
 * can filter for.
 */
export type PlatformAction =
  | "org.created"
  | "org.settings_changed"
  | "org.suspended"
  | "org.resumed"
  | "org.deleted"
  | "user.updated"
  | "user.deleted"
  | "user.invited"
  | "user.impersonated"
  | "superadmin.granted"
  | "superadmin.revoked"
  | "time.written"
  | "time.replaced"
  | "time.bulk_written"
  | "activity.rewritten"
  | "session.trimmed"
  | "session.deleted"
  | "snapshot.restored";

interface PlatformEntry {
  actorId?: string | null;
  action: PlatformAction;
  orgId?: string | null;
  /** Anything worth showing on the row — counts, before/after, the target. */
  details?: Record<string, unknown>;
}

/**
 * Record one platform action. Best-effort, exactly like `auditLog()`: the thing
 * being recorded has already happened, and throwing here would leave the caller
 * unable to tell the operator the truth about it.
 *
 * The actor's email is resolved and denormalised into the payload rather than
 * read back through the relation at display time, so a row stays readable after
 * the account it names is gone.
 */
export async function platformLog(entry: PlatformEntry): Promise<void> {
  let actorEmail: string | null = null;
  if (entry.actorId) {
    actorEmail = await prisma.user
      .findUnique({ where: { id: entry.actorId }, select: { email: true } })
      .then((u) => u?.email ?? null)
      .catch(() => null);
  }

  try {
    await prisma.platformLog.create({
      data: {
        actorId: entry.actorId ?? null,
        action: entry.action,
        orgId: entry.orgId ?? null,
        payload: { actorEmail, ...(entry.details ?? {}) } as Prisma.InputJsonValue,
      },
    });
  } catch (err) {
    // Swallowed on purpose — the table may not exist yet on a database where
    // ensurePlatformTables() could not run. That should degrade to "no trail",
    // never to a failed platform action.
    console.warn(
      `[platform] could not record ${entry.action}:`,
      err instanceof Error ? err.message : err
    );
  }
}

/** How long an undo stays available. */
export const SNAPSHOT_TTL_MS = 14 * 86_400_000;

/**
 * What a snapshot holds. Rows are stored whole rather than by id, because the
 * ids of deleted rows point at nothing.
 */
export interface SnapshotPayload {
  sessions: Record<string, unknown>[];
  activityBlocks: Record<string, unknown>[];
  screenshots: Record<string, unknown>[];
  /**
   * Prior figures for blocks that are being OVERWRITTEN rather than deleted.
   *
   * A separate field because it needs the opposite restore. Everything else in
   * a snapshot describes rows that will not exist afterwards, so putting them
   * back is `createMany`. An activity rewrite leaves every row exactly where it
   * was and changes four columns, so `createMany` would skip all of it as
   * duplicates and restore nothing at all.
   */
  blockActivity?: BlockActivitySnapshot[];
}

/** The four columns an activity rewrite touches, plus the chain it belongs to. */
export interface BlockActivitySnapshot {
  id: string;
  keyboardPct: number;
  mousePct: number;
  activityPct: number;
  idleSeconds: number;
  prevHash: string;
  hash: string;
}

/**
 * How many blocks one activity snapshot may hold.
 *
 * A whole-team month is tens of thousands of blocks, and the payload is a
 * single JSONB column. The cap exists so the failure is an explicit refusal
 * ("narrow the range") rather than a write that succeeds until one day it is
 * too big and the undo silently is not there.
 */
export const MAX_SNAPSHOT_BLOCKS = 20_000;

/**
 * Capture everything belonging to these sessions, before they are deleted.
 *
 * `JSON.stringify` turns Dates into ISO strings on the way into JSONB, so they
 * have to be revived on the way out — `restoreSnapshot` does that. Storing them
 * as strings is the honest shape for a JSON column and keeps the snapshot
 * readable by anything, rather than only by this module.
 */
export async function captureSessions(sessionIds: string[]): Promise<SnapshotPayload> {
  if (sessionIds.length === 0) return { sessions: [], activityBlocks: [], screenshots: [] };

  const [sessions, activityBlocks, screenshots] = await Promise.all([
    prisma.trackingSession.findMany({ where: { id: { in: sessionIds } } }),
    prisma.activityBlock.findMany({ where: { sessionId: { in: sessionIds } } }),
    prisma.screenshot.findMany({ where: { sessionId: { in: sessionIds } } }),
  ]);

  return {
    sessions: sessions as unknown as Record<string, unknown>[],
    activityBlocks: activityBlocks as unknown as Record<string, unknown>[],
    screenshots: screenshots as unknown as Record<string, unknown>[],
  };
}

/**
 * Capture what an activity rewrite is about to overwrite.
 *
 * Returns null when there are more blocks than one snapshot should carry — see
 * MAX_SNAPSHOT_BLOCKS. The caller must treat that the same way it treats a
 * failed save: refuse, rather than proceed without a way back.
 */
export async function captureBlockActivity(
  sessionIds: string[]
): Promise<SnapshotPayload | null> {
  if (sessionIds.length === 0) {
    return { sessions: [], activityBlocks: [], screenshots: [], blockActivity: [] };
  }

  const blocks = await prisma.activityBlock.findMany({
    where: { sessionId: { in: sessionIds } },
    select: {
      id: true,
      keyboardPct: true,
      mousePct: true,
      activityPct: true,
      idleSeconds: true,
      prevHash: true,
      hash: true,
    },
  });

  if (blocks.length > MAX_SNAPSHOT_BLOCKS) return null;

  return { sessions: [], activityBlocks: [], screenshots: [], blockActivity: blocks };
}

export interface SnapshotRef {
  id: string;
  counts: { sessions: number; activityBlocks: number; screenshots: number };
}

/**
 * Persist a snapshot and return its id, or null if it could not be stored.
 *
 * Null is a meaningful answer rather than a swallowed error: the caller is
 * expected to REFUSE the destructive action rather than proceed without a way
 * back. An undo buffer that silently is not there is worse than no undo buffer,
 * because the operator has been told they can undo.
 */
export async function saveSnapshot(args: {
  actorId: string;
  kind: string;
  userId?: string | null;
  orgId?: string | null;
  payload: SnapshotPayload;
}): Promise<SnapshotRef | null> {
  try {
    const row = await prisma.platformSnapshot.create({
      data: {
        actorId: args.actorId,
        kind: args.kind,
        userId: args.userId ?? null,
        orgId: args.orgId ?? null,
        payload: args.payload as unknown as Prisma.InputJsonValue,
        expiresAt: new Date(Date.now() + SNAPSHOT_TTL_MS),
      },
      select: { id: true },
    });
    return {
      id: row.id,
      counts: {
        sessions: args.payload.sessions.length,
        activityBlocks: args.payload.activityBlocks.length,
        screenshots: args.payload.screenshots.length,
      },
    };
  } catch (err) {
    console.warn("[platform] could not save snapshot:", err instanceof Error ? err.message : err);
    return null;
  }
}

/** JSONB hands dates back as ISO strings; Prisma wants Dates. */
export function reviveDates<T extends Record<string, unknown>>(row: T, fields: string[]): T {
  const out: Record<string, unknown> = { ...row };
  for (const f of fields) {
    const v = out[f];
    if (typeof v === "string") out[f] = new Date(v);
  }
  return out as T;
}

const SESSION_DATES = ["startedAt", "endedAt", "lastSyncAt", "createdAt"];
const BLOCK_DATES = ["blockStart", "blockEnd", "createdAt"];
const SHOT_DATES = ["takenAt", "deletedAt", "createdAt"];

export interface RestoreResult {
  sessions: number;
  activityBlocks: number;
  screenshots: number;
  skipped: number;
}

/**
 * Write a snapshot's rows back.
 *
 * `skipDuplicates` throughout, which makes a second restore a no-op rather than
 * a unique-constraint error. That matters most for `Screenshot.r2Key`: it is
 * unique precisely so a retried upload cannot create the same image twice, and a
 * restore has to respect that rule rather than fight it.
 *
 * Order is forced by the foreign keys — sessions, then blocks, then the
 * screenshots that reference both.
 */
export async function restoreSnapshot(payload: SnapshotPayload): Promise<RestoreResult> {
  // An in-place snapshot restores by UPDATE, not by insert — the rows never
  // went away. Handled first and returned early, because the two shapes are
  // mutually exclusive and mixing them would mean guessing which one a payload
  // meant.
  if (payload.blockActivity && payload.blockActivity.length > 0) {
    let restored = 0;
    // Chunked: a single transaction of twenty thousand updates is refused by
    // CockroachDB, and one update per round trip would take minutes.
    const CHUNK = 200;
    for (let i = 0; i < payload.blockActivity.length; i += CHUNK) {
      const slice = payload.blockActivity.slice(i, i + CHUNK);
      const done = await prisma.$transaction(
        slice.map((b) =>
          prisma.activityBlock.updateMany({
            where: { id: b.id },
            data: {
              keyboardPct: b.keyboardPct,
              mousePct: b.mousePct,
              activityPct: b.activityPct,
              idleSeconds: b.idleSeconds,
              prevHash: b.prevHash,
              hash: b.hash,
            },
          })
        )
      );
      restored += done.reduce((sum, r) => sum + r.count, 0);
    }
    return {
      sessions: 0,
      activityBlocks: restored,
      screenshots: 0,
      // A block deleted since the snapshot was taken cannot be put back by an
      // update; it is reported as skipped rather than silently missing.
      skipped: payload.blockActivity.length - restored,
    };
  }

  const sessions = payload.sessions.map((r) => reviveDates(r, SESSION_DATES));
  const blocks = payload.activityBlocks.map((r) => reviveDates(r, BLOCK_DATES));
  const shots = payload.screenshots.map((r) => reviveDates(r, SHOT_DATES));

  const s = await prisma.trackingSession.createMany({
    data: sessions as never,
    skipDuplicates: true,
  });
  const b = await prisma.activityBlock.createMany({
    data: blocks as never,
    skipDuplicates: true,
  });
  const c = await prisma.screenshot.createMany({
    data: shots as never,
    skipDuplicates: true,
  });

  const attempted = sessions.length + blocks.length + shots.length;
  const written = s.count + b.count + c.count;

  return {
    sessions: s.count,
    activityBlocks: b.count,
    screenshots: c.count,
    skipped: attempted - written,
  };
}

/** Drop expired snapshots. An undo buffer that grows forever is a second database. */
export async function sweepSnapshots(): Promise<number> {
  try {
    const { count } = await prisma.platformSnapshot.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
    return count;
  } catch {
    return 0;
  }
}
