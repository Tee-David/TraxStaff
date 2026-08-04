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
export async function ensureWebsiteUsageColumn(
  log: { info: (msg: string) => void; warn: (msg: string) => void }
): Promise<void> {
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
