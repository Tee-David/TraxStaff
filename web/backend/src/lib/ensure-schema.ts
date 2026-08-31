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

/**
 * Adds the notification-settings columns to `Organization` if they are missing.
 *
 * Same reasoning and same shape as `ensureWebsiteUsageColumn` below — see its
 * docblock for why this runs from the app instead of as a migration, and for the
 * `schema_locked` escalation. Every column is additive, defaulted and
 * `IF NOT EXISTS`, and the probe short-circuits once they exist.
 *
 * Degradation on failure is deliberate: routes/orgs.ts and the digest scheduler
 * both serve the same defaults for a missing column, so a database that refuses
 * the change ends up with digests enabled and toggles that do not persist —
 * never a broken settings page.
 */
const NOTIFY_COLUMNS: [name: string, ddlType: string][] = [
  ["timezone", `STRING NOT NULL DEFAULT 'Africa/Lagos'`],
  ["emailsEnabled", "BOOL NOT NULL DEFAULT true"],
  ["notifyDailyShortfall", "BOOL NOT NULL DEFAULT true"],
  ["notifyWeeklyShortfall", "BOOL NOT NULL DEFAULT true"],
  ["notifyUnusualActivity", "BOOL NOT NULL DEFAULT true"],
  // Mirrors schema.prisma: the one that mails every member is opt-in.
  ["notifyMemberWeeklySummary", "BOOL NOT NULL DEFAULT false"],
];

export async function ensureShortfallNotifyColumns(log: Logger): Promise<void> {
  try {
    // Probing the last one added is enough — they are added together, in order.
    await prisma.$queryRaw`SELECT "timezone", "notifyMemberWeeklySummary" FROM "Organization" LIMIT 1`;
    return; // already there — nothing to do
  } catch {
    // fall through and add them
  }

  log.info("[schema] Organization notification columns are missing — adding them");

  // One statement per column: CockroachDB takes ADD COLUMN one at a time here,
  // and IF NOT EXISTS makes the already-has-some case harmless.
  const addColumns = async () => {
    for (const [column, ddlType] of NOTIFY_COLUMNS) {
      await prisma.$executeRawUnsafe(
        `ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "${column}" ${ddlType}`
      );
    }
  };

  try {
    // Plain path first — `schema_locked` is CockroachDB-only and is not set on
    // every table even there, so unlocking unconditionally would fail on any
    // database that has never heard of the parameter.
    await addColumns();
    log.info("[schema] Organization notification columns added");
    return;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!/schema_locked|is locked/i.test(msg)) {
      log.warn(`[schema] could not add Organization notification columns: ${msg}`);
      return;
    }
    log.info("[schema] table is schema_locked — unlocking to add the columns");
  }

  try {
    await prisma.$executeRawUnsafe(`ALTER TABLE "Organization" SET (schema_locked = false)`);
    try {
      await addColumns();
      log.info("[schema] Organization notification columns added");
    } finally {
      // Restore the lock even if the ADD failed.
      await prisma
        .$executeRawUnsafe(`ALTER TABLE "Organization" SET (schema_locked = true)`)
        .catch(() => {});
    }
  } catch (err) {
    log.warn(
      `[schema] could not add Organization notification columns (${
        err instanceof Error ? err.message : err
      }). The digest toggles will read as on and not persist until they exist.`
    );
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

/**
 * Adds a set of columns to one table, unlocking it first only if the plain
 * ALTER says the table is `schema_locked`.
 *
 * Factored out of `ensureWebsiteUsageColumn` (which predates it and is left
 * alone) because the approvals work adds seven columns across two tables and
 * the optimistic-then-escalate dance is the fiddly part — the lock has to be
 * restored even when the ALTER fails, or a failed boot leaves the table
 * writable to the next schema change that comes along.
 *
 * `probe` is a cheap SELECT of one of the new columns: when it succeeds the
 * work is already done and the steady state costs one query per boot.
 */
async function ensureColumns(
  log: Logger,
  table: string,
  probeColumn: string,
  columns: string[],
  degradedWarning: string
): Promise<void> {
  try {
    await prisma.$queryRawUnsafe(`SELECT "${probeColumn}" FROM "${table}" LIMIT 1`);
    return; // already there — nothing to do
  } catch {
    // fall through and add them
  }

  log.info(`[schema] ${table}.${probeColumn} is missing — adding the approval columns`);

  // Every statement is additive, nullable and `IF NOT EXISTS`, so a partially
  // applied set (a boot that died halfway) simply completes on the next run.
  const add = async () => {
    for (const col of columns) {
      await prisma.$executeRawUnsafe(`ALTER TABLE "${table}" ADD COLUMN IF NOT EXISTS ${col}`);
    }
  };

  try {
    await add();
    log.info(`[schema] ${table} approval columns added`);
    return;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!/schema_locked|is locked/i.test(msg)) {
      log.warn(`[schema] could not add columns to ${table}: ${msg}. ${degradedWarning}`);
      return;
    }
    log.info(`[schema] ${table} is schema_locked — unlocking to add the columns`);
  }

  try {
    await prisma.$executeRawUnsafe(`ALTER TABLE "${table}" SET (schema_locked = false)`);
    try {
      await add();
      log.info(`[schema] ${table} approval columns added`);
    } finally {
      await prisma
        .$executeRawUnsafe(`ALTER TABLE "${table}" SET (schema_locked = true)`)
        .catch(() => {});
    }
  } catch (err) {
    log.warn(
      `[schema] could not add columns to ${table} (${
        err instanceof Error ? err.message : err
      }). ${degradedWarning}`
    );
  }
}

/**
 * Columns behind manual-time approvals, and the per-user email preference blob.
 *
 * Both are additive and nullable, so the API keeps serving on a database where
 * this could not run: a missing `approvalStatus` degrades to "every manual entry
 * reads as approved" (which is exactly how rows predating the feature are
 * treated anyway), and a missing `emailPrefs` degrades to "everyone gets the
 * default set of emails" — the behaviour before preferences existed.
 */
export async function ensureApprovalColumns(log: Logger): Promise<void> {
  await ensureColumns(
    log,
    "TrackingSession",
    "approvalStatus",
    [
      `"approvalStatus" STRING`,
      `"decidedAt" TIMESTAMP(3)`,
      `"decidedById" UUID`,
      `"decidedByEmail" STRING`,
      `"decisionNote" STRING`,
      `"addedById" UUID`,
      `"addedByEmail" STRING`,
    ],
    "Manual entries will all read as approved and cannot be reviewed until these columns exist."
  );

  await ensureColumns(
    log,
    "User",
    "emailPrefs",
    [`"emailPrefs" JSONB`],
    "Email preferences will not persist, and every admin keeps receiving the default set."
  );
}

/**
 * Creates the `OutboundEmail` outbox table if it is missing.
 *
 * Same reasoning and same shape as `ensureAuditLogTable` above — `prisma migrate
 * deploy` is not safe against this database, so the targeted DDL runs over the
 * connection the API already holds. No `schema_locked` dance is needed: that
 * parameter guards ALTERs on existing tables, and this only ever CREATEs a new
 * one, with no foreign keys to reference.
 *
 * Failure is logged and swallowed, and that degradation is deliberate: lib/
 * email-queue.ts reports an unreachable outbox as `unavailable`, and lib/
 * mailer.ts then falls back to sending directly, exactly as it did before the
 * queue existed. A database that refuses this change costs retries, never mail.
 */
export async function ensureOutboundEmailTable(log: Logger): Promise<void> {
  try {
    await prisma.$queryRaw`SELECT "id" FROM "OutboundEmail" LIMIT 1`;
    return; // already there — nothing to do
  } catch {
    // fall through and create it
  }

  log.info("[schema] OutboundEmail table is missing — creating it");

  // Separate statements on purpose: CockroachDB will not take the table and its
  // indexes in one implicit transaction, and $executeRawUnsafe is one-per-call.
  const statements = [
    `CREATE TABLE IF NOT EXISTS "OutboundEmail" (
       "id" UUID NOT NULL DEFAULT gen_random_uuid(),
       "recipient" STRING NOT NULL,
       "subject" STRING NOT NULL,
       "html" STRING NOT NULL,
       "text" STRING NOT NULL,
       "kind" STRING NOT NULL,
       "dedupeKey" STRING,
       "status" STRING NOT NULL DEFAULT 'pending',
       "attempts" INT8 NOT NULL DEFAULT 0,
       "lastError" STRING,
       "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT current_timestamp(),
       "expiresAt" TIMESTAMP(3),
       "sentAt" TIMESTAMP(3),
       "createdAt" TIMESTAMP(3) NOT NULL DEFAULT current_timestamp(),
       "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT current_timestamp(),
       CONSTRAINT "OutboundEmail_pkey" PRIMARY KEY ("id")
     )`,
    // The unique index is the whole idempotency guarantee — without it a retry
    // could mail the same digest twice. NULLs are allowed to repeat, which is
    // what lets mail that legitimately re-sends (invites, resets) skip the key.
    `CREATE UNIQUE INDEX IF NOT EXISTS "OutboundEmail_dedupeKey_key" ON "OutboundEmail" ("dedupeKey")`,
    `CREATE INDEX IF NOT EXISTS "OutboundEmail_status_nextAttemptAt_idx" ON "OutboundEmail" ("status", "nextAttemptAt")`,
  ];

  try {
    for (const sql of statements) await prisma.$executeRawUnsafe(sql);
    log.info("[schema] OutboundEmail table created");
  } catch (err) {
    log.warn(
      `[schema] could not create OutboundEmail (${
        err instanceof Error ? err.message : err
      }). Mail will still send, but a failed send cannot be retried until this table exists.`
    );
  }
}

/**
 * Adds `User.isSuperAdmin` if it is missing.
 *
 * Same reasoning and same shape as `ensureWebsiteUsageColumn` above — see its
 * docblock for why this runs from the app rather than as a migration, and for
 * the `schema_locked` unlock/re-lock escalation. The column is additive,
 * defaulted `false` and `IF NOT EXISTS`, so it neither rewrites nor drops
 * anything.
 *
 * The degradation on failure is the important part here, and it is chosen to
 * fail CLOSED: `superAdminColumnExists()` in lib/superadmin.ts probes for this
 * column and treats its absence as "nobody is a super admin", so a database that
 * refuses the change ends up with the `/admin/*` routes returning 403 to
 * everyone — never with them open to anyone who asks.
 */
export async function ensureSuperAdminColumn(log: Logger): Promise<void> {
  try {
    await prisma.$queryRaw`SELECT "isSuperAdmin" FROM "User" LIMIT 1`;
    return; // already there — nothing to do
  } catch {
    // fall through and add it
  }

  log.info("[schema] User.isSuperAdmin is missing — adding it");

  const addColumn = () =>
    prisma.$executeRawUnsafe(
      `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "isSuperAdmin" BOOL NOT NULL DEFAULT false`
    );

  try {
    // Plain path first — `schema_locked` is CockroachDB-only and is not set on
    // every table even there, so unlocking unconditionally would fail on any
    // database that has never heard of the parameter.
    await addColumn();
    log.info("[schema] User.isSuperAdmin added");
    return;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!/schema_locked|is locked/i.test(msg)) {
      log.warn(`[schema] could not add User.isSuperAdmin: ${msg}`);
      return;
    }
    log.info("[schema] User is schema_locked — unlocking to add the column");
  }

  try {
    // Separate statements: CockroachDB will not accept the unlock and the DDL
    // that depends on it inside one implicit transaction.
    await prisma.$executeRawUnsafe(`ALTER TABLE "User" SET (schema_locked = false)`);
    try {
      await addColumn();
      log.info("[schema] User.isSuperAdmin added");
    } finally {
      // Restore the lock even if the ADD failed.
      await prisma
        .$executeRawUnsafe(`ALTER TABLE "User" SET (schema_locked = true)`)
        .catch(() => {});
    }
  } catch (err) {
    log.warn(
      `[schema] could not add User.isSuperAdmin (${
        err instanceof Error ? err.message : err
      }). The /admin routes will refuse everyone until this column exists.`
    );
  }
}

/**
 * Adds `Organization.status` if it is missing.
 *
 * Same shape and same reasoning as `ensureSuperAdminColumn` — and the same
 * blast radius, which is why it runs alongside it at the very front of the boot
 * sequence rather than with the tolerant columns. `status` is in schema.prisma,
 * so the generated client selects it on every unqualified `prisma.organization`
 * read, and there are several (`findUniqueOrThrow` in routes/auth.ts, the
 * org-delete path in routes/superadmin.ts). A database without this column does
 * not degrade to "suspension does not work" — it 500s the register and invite
 * paths. There is no serving a default around that, so the DDL has to land.
 */
export async function ensureOrgStatusColumn(log: Logger): Promise<void> {
  try {
    await prisma.$queryRaw`SELECT "status" FROM "Organization" LIMIT 1`;
    return; // already there — nothing to do
  } catch {
    // fall through and add it
  }

  log.info("[schema] Organization.status is missing — adding it");

  const addColumn = () =>
    prisma.$executeRawUnsafe(
      `ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "status" STRING NOT NULL DEFAULT 'active'`
    );

  try {
    await addColumn();
    log.info("[schema] Organization.status added");
    return;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!/schema_locked|is locked/i.test(msg)) {
      log.warn(`[schema] could not add Organization.status: ${msg}`);
      return;
    }
    log.info("[schema] Organization is schema_locked — unlocking to add the column");
  }

  try {
    await prisma.$executeRawUnsafe(`ALTER TABLE "Organization" SET (schema_locked = false)`);
    try {
      await addColumn();
      log.info("[schema] Organization.status added");
    } finally {
      await prisma
        .$executeRawUnsafe(`ALTER TABLE "Organization" SET (schema_locked = true)`)
        .catch(() => {});
    }
  } catch (err) {
    log.warn(
      `[schema] could not add Organization.status (${
        err instanceof Error ? err.message : err
      }). Registration and invites will fail until this column exists.`
    );
  }
}

/**
 * Creates `PlatformLog` and `PlatformSnapshot` if they are missing.
 *
 * Same reasoning as `ensureAuditLogTable` — no `schema_locked` dance is needed
 * because that parameter guards ALTERs on existing tables and these only CREATE
 * new ones. Failure is logged and swallowed, and the degradation is mild in one
 * case and worth stating in the other:
 *
 *   - no `PlatformLog` → platform actions go unrecorded, exactly as they did
 *     before this table existed;
 *   - no `PlatformSnapshot` → `/admin/time` refuses `replace` outright rather
 *     than destroying rows it cannot offer to put back. That refusal is
 *     deliberate: an undo buffer that silently is not there is worse than none,
 *     because the operator has been told they can undo.
 */
export async function ensurePlatformTables(log: Logger): Promise<void> {
  const statements: [label: string, sql: string][] = [];

  try {
    await prisma.$queryRaw`SELECT "id" FROM "PlatformLog" LIMIT 1`;
  } catch {
    statements.push([
      "PlatformLog",
      `CREATE TABLE IF NOT EXISTS "PlatformLog" (
         "id" UUID NOT NULL DEFAULT gen_random_uuid(),
         "actorId" UUID,
         "action" STRING NOT NULL,
         "orgId" UUID,
         "payload" JSONB,
         "createdAt" TIMESTAMP(3) NOT NULL DEFAULT current_timestamp(),
         CONSTRAINT "PlatformLog_pkey" PRIMARY KEY ("id"),
         CONSTRAINT "PlatformLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL
       )`,
    ]);
    statements.push([
      "PlatformLog indexes",
      `CREATE INDEX IF NOT EXISTS "PlatformLog_createdAt_idx" ON "PlatformLog" ("createdAt")`,
    ]);
    statements.push([
      "PlatformLog actor index",
      `CREATE INDEX IF NOT EXISTS "PlatformLog_actorId_idx" ON "PlatformLog" ("actorId")`,
    ]);
    statements.push([
      "PlatformLog org index",
      `CREATE INDEX IF NOT EXISTS "PlatformLog_orgId_idx" ON "PlatformLog" ("orgId")`,
    ]);
  }

  try {
    await prisma.$queryRaw`SELECT "id" FROM "PlatformSnapshot" LIMIT 1`;
  } catch {
    // No foreign keys at all, deliberately: a snapshot has to outlive the org
    // and the user it describes, and deleting an org is one of the actions most
    // worth being able to reverse.
    statements.push([
      "PlatformSnapshot",
      `CREATE TABLE IF NOT EXISTS "PlatformSnapshot" (
         "id" UUID NOT NULL DEFAULT gen_random_uuid(),
         "actorId" UUID,
         "kind" STRING NOT NULL,
         "userId" UUID,
         "orgId" UUID,
         "payload" JSONB NOT NULL,
         "restoredAt" TIMESTAMP(3),
         "expiresAt" TIMESTAMP(3) NOT NULL,
         "createdAt" TIMESTAMP(3) NOT NULL DEFAULT current_timestamp(),
         CONSTRAINT "PlatformSnapshot_pkey" PRIMARY KEY ("id")
       )`,
    ]);
    statements.push([
      "PlatformSnapshot user index",
      `CREATE INDEX IF NOT EXISTS "PlatformSnapshot_userId_createdAt_idx" ON "PlatformSnapshot" ("userId", "createdAt")`,
    ]);
    statements.push([
      "PlatformSnapshot expiry index",
      `CREATE INDEX IF NOT EXISTS "PlatformSnapshot_expiresAt_idx" ON "PlatformSnapshot" ("expiresAt")`,
    ]);
  }

  if (statements.length === 0) return; // both already there

  log.info("[schema] creating platform tables");
  for (const [label, sql] of statements) {
    try {
      await prisma.$executeRawUnsafe(sql);
    } catch (err) {
      log.warn(
        `[schema] could not create ${label} (${err instanceof Error ? err.message : err})`
      );
    }
  }
  log.info("[schema] platform tables ready");
}
