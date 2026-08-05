import { prisma } from "./prisma";

/**
 * Adds `Organization.showWebsiteUsage` if it is missing.
 *
 * Why this runs from the app rather than as a plain migration: `prisma migrate
 * deploy` is not safe to run against this database — the schema has known drift
 * from `schema.prisma` (see "CockroachDB migrations" in web/README.md), so a
 * blanket migrate would try to reconcile far more than this one column. The
 * documented safe path there is to execute the targeted DDL over a direct SQL
 * connection, wrapped in CockroachDB's `schema_locked` unlock/re-lock. That is
 * exactly what this does, using the connection the API already holds — and it
 * works where the CockroachDB Cloud console's query API does not, which refuses
 * the change outright:
 *
 *   ERROR: this schema change is disallowed because table "Organization" is
 *   locked and this operation cannot automatically unlock the table
 *   SQLSTATE: 57000
 *
 * Deliberately narrow and safe to run on every boot:
 *   - it returns immediately once the column exists, so the steady state is one
 *     cheap SELECT per process;
 *   - the column is additive, defaulted and `IF NOT EXISTS`, so it neither
 *     rewrites nor drops anything;
 *   - failure is logged and swallowed. The API serves a default when the column
 *     is absent (see routes/orgs.ts), so a database that refuses the change
 *     degrades to "the toggle does not persist" rather than failing to boot.
 *
 * Delete this once migrations run as part of the deploy.
 */
type Logger = { info: (msg: string) => void; warn: (msg: string) => void };

/**
 * Creates the `AuditLog` table if it is missing.
 *
 * Same reasoning as `ensureWebsiteUsageColumn` below — `prisma migrate deploy`
 * is not safe against this database, so the targeted DDL is applied over the
 * connection the API already holds. No `schema_locked` dance is needed here:
 * that parameter guards ALTERs on existing tables, and this only ever CREATEs a
 * new one.
 *
 * Safe on every boot: the probe returns early once the table exists, and every
 * statement is `IF NOT EXISTS`. Failure is logged and swallowed — an API that
 * cannot write audit rows should still serve traffic, and `auditLog()` is
 * itself best-effort for the same reason.
 */
export async function ensureAuditLogTable(log: Logger): Promise<void> {
  try {
    await prisma.$queryRaw`SELECT "id" FROM "AuditLog" LIMIT 1`;
    return; // already there — nothing to do
  } catch {
    // fall through and create it
  }

  log.info("[schema] AuditLog table is missing — creating it");

  // Separate statements on purpose: CockroachDB will not take the table and its
  // indexes in one implicit transaction, and $executeRawUnsafe is one-per-call.
  const statements = [
    `CREATE TABLE IF NOT EXISTS "AuditLog" (
       "id" UUID NOT NULL DEFAULT gen_random_uuid(),
       "orgId" UUID NOT NULL,
       "actorId" UUID,
       "action" STRING NOT NULL,
       "payload" JSONB,
       "createdAt" TIMESTAMP(3) NOT NULL DEFAULT current_timestamp(),
       CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id"),
       CONSTRAINT "AuditLog_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id"),
       CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL
     )`,
    `CREATE INDEX IF NOT EXISTS "AuditLog_orgId_createdAt_idx" ON "AuditLog" ("orgId", "createdAt")`,
    `CREATE INDEX IF NOT EXISTS "AuditLog_orgId_action_idx" ON "AuditLog" ("orgId", "action")`,
  ];

  try {
    for (const sql of statements) await prisma.$executeRawUnsafe(sql);
    log.info("[schema] AuditLog table created");
  } catch (err) {
    log.warn(
      `[schema] could not create AuditLog (${
        err instanceof Error ? err.message : err
      }). Actions will not be recorded until this table exists.`
    );
  }
}

/**
 * Makes the three `userId` foreign keys nullable and `ON DELETE SET NULL`, so a
 * member can be hard-deleted without destroying the work they tracked.
 *
 * Verified against the dev cluster before shipping: `TrackingSession.userId`,
 * `Device.userId` and `TimeNote.userId` are all NOT NULL / RESTRICT, which is
 * why `prisma.user.delete()` throws today. (`Notification.userId` and
 * `Screenshot.deletedById` were already SET NULL in the database despite
 * schema.prisma not saying so — one of this database's known drifts, and here a
 * harmless one, so they need no DDL.)
 *
 * CockroachDB cannot alter an existing FK's action in place, hence the
 * drop-and-recreate. `TrackingSession` is one of the schema_locked tables, so
 * the unlock/re-lock escalation is mandatory there; the other two are handled
 * by the same optimistic-then-escalate path in case they are locked too.
 */
export async function ensureNullableUserFks(log: Logger): Promise<void> {
  try {
    const rows = await prisma.$queryRaw<{ is_nullable: string }[]>`
      SELECT is_nullable FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'TrackingSession' AND column_name = 'userId'
    `;
    if (rows[0]?.is_nullable === "YES") return; // already applied
  } catch {
    // Could not read the catalogue — fall through and let the DDL decide.
  }

  log.info("[schema] making userId foreign keys nullable + SET NULL");

  for (const table of ["TrackingSession", "Device", "TimeNote"]) {
    const fk = `${table}_userId_fkey`;
    // Order matters: the column must accept NULL before a constraint is allowed
    // to write one into it.
    const steps = [
      `ALTER TABLE "${table}" ALTER COLUMN "userId" DROP NOT NULL`,
      `ALTER TABLE "${table}" DROP CONSTRAINT IF EXISTS "${fk}"`,
      `ALTER TABLE "${table}" ADD CONSTRAINT "${fk}" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL`,
    ];
    const run = async () => {
      for (const sql of steps) await prisma.$executeRawUnsafe(sql);
    };

    try {
      await run();
      log.info(`[schema] ${table}.userId is now nullable + SET NULL`);
      continue;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!/schema_locked|is locked/i.test(msg)) {
        log.warn(`[schema] could not alter ${table}.userId: ${msg}`);
        continue;
      }
      log.info(`[schema] ${table} is schema_locked — unlocking to alter it`);
    }

    try {
      await prisma.$executeRawUnsafe(`ALTER TABLE "${table}" SET (schema_locked = false)`);
      try {
        await run();
        log.info(`[schema] ${table}.userId is now nullable + SET NULL`);
      } finally {
        await prisma
          .$executeRawUnsafe(`ALTER TABLE "${table}" SET (schema_locked = true)`)
          .catch(() => {});
      }
    } catch (err) {
      log.warn(
        `[schema] could not alter ${table}.userId (${
          err instanceof Error ? err.message : err
        }). Deleting a member with tracked work will fail until this is applied.`
      );
    }
  }
}

export async function ensureWebsiteUsageColumn(log: Logger): Promise<void> {
  try {
    await prisma.$queryRaw`SELECT "showWebsiteUsage" FROM "Organization" LIMIT 1`;
    return; // already there — nothing to do
  } catch {
    // fall through and add it
  }

  log.info("[schema] Organization.showWebsiteUsage is missing — adding it");

  const addColumn = () =>
    prisma.$executeRawUnsafe(
      `ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "showWebsiteUsage" BOOL NOT NULL DEFAULT true`
    );

  try {
    // Plain path first. `schema_locked` is CockroachDB-only and is not set on
    // every table even there, so unlocking unconditionally would fail on any
    // database that has never heard of the parameter — and take the ADD COLUMN
    // down with it.
    await addColumn();
    log.info("[schema] Organization.showWebsiteUsage added");
    return;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!/schema_locked|is locked/i.test(msg)) {
      log.warn(`[schema] could not add Organization.showWebsiteUsage: ${msg}`);
      return;
    }
    log.info("[schema] table is schema_locked — unlocking to add the column");
  }

  try {
    // Separate statements: CockroachDB will not accept the unlock and the DDL
    // that depends on it inside one implicit transaction.
    await prisma.$executeRawUnsafe(`ALTER TABLE "Organization" SET (schema_locked = false)`);
    try {
      await addColumn();
      log.info("[schema] Organization.showWebsiteUsage added");
    } finally {
      // Restore the lock even if the ADD failed, so the table is never left
      // unlocked because of this.
      await prisma
        .$executeRawUnsafe(`ALTER TABLE "Organization" SET (schema_locked = true)`)
        .catch(() => {});
    }
  } catch (err) {
    log.warn(
      `[schema] could not add Organization.showWebsiteUsage (${
        err instanceof Error ? err.message : err
      }). The website-usage toggle will read as on and not persist until this column exists.`
    );
  }
}
