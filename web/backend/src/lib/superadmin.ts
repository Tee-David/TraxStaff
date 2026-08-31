/**
 * The platform-level super admin: who is one, and how that is checked.
 *
 * Every other role in this product is an ORG role. `owner`, `admin` and `member`
 * live in `Role` on the user's membership of one organization, and every query
 * in the API is scoped to `req.user.orgId`. A super admin is a different axis
 * entirely — Trax staff, above all orgs — so it is a flag on the user rather
 * than a fourth value in `Role`. Three reasons that is the right shape:
 *
 *   - `Role` describes a person's standing INSIDE an org. A cross-org identity
 *     has no standing inside any one of them, so putting it there would mean
 *     inventing an org for staff to belong to.
 *   - Every existing check is `role === "owner" || role === "admin"`. A new enum
 *     value is invisible to all of them, so a super admin would silently have
 *     LESS access than an admin until each one was found and updated.
 *   - Adding a value to a Postgres/CockroachDB enum is `ALTER TYPE`, on a
 *     database this project already documents as drifted from schema.prisma
 *     (see the docblocks in lib/ensure-schema.ts). An additive, defaulted BOOL
 *     column is the one DDL shape this codebase has repeatedly landed safely.
 *
 * The flag is orthogonal: a super admin still has an ordinary org role and still
 * tracks their own time. What it adds is the `/admin/*` surface; what it takes
 * away is visibility — platform staff are hidden from an org's member list and
 * from its audit trail, so an org admin has no way to see that an account above
 * theirs exists. See `hideSuperAdminsFrom` in routes/members.ts and
 * `auditActorVisibility` below.
 */

import { prisma } from "./prisma";
import { env } from "../env";

type Logger = { info: (msg: string) => void; warn: (msg: string) => void };

/**
 * Whether the database actually has `User.isSuperAdmin` yet.
 *
 * Same treatment routes/orgs.ts gives its optional columns, and for the same
 * reason: code and DDL do not land at the same instant, and selecting a column
 * that does not exist throws. Here the degradation is chosen to fail CLOSED —
 * a missing column means nobody is a super admin, never that everybody is.
 *
 * A present column is cached permanently (a column cannot go away); an absent
 * one is re-probed, so the first request after the DDL lands starts working
 * without needing a restart.
 */
let columnPresent = false;

export async function superAdminColumnExists(): Promise<boolean> {
  if (columnPresent) return true;
  try {
    await prisma.$queryRaw`SELECT "isSuperAdmin" FROM "User" LIMIT 1`;
    columnPresent = true;
  } catch {
    columnPresent = false;
  }
  return columnPresent;
}

/** Test seam — resets the cached probe. */
export function resetSuperAdminColumnCache(): void {
  columnPresent = false;
}

/**
 * Emails that are super admins by configuration, from `SUPERADMIN_EMAILS`.
 *
 * The bootstrap problem: only a super admin can grant the flag, so the first one
 * cannot come from the API. It comes from the environment instead, which also
 * means the capability can be revoked by redeploying without the variable — no
 * database surgery on a live cluster to take it away again.
 */
export function configuredSuperAdmins(): string[] {
  return (env.SUPERADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.length > 0);
}

/**
 * Grant the flag to every address in `SUPERADMIN_EMAILS`, at boot.
 *
 * Deliberately does NOT revoke anyone: the variable names the accounts that must
 * always be able to get in, not the complete list. Super admins granted through
 * the API are not in it and must not be wiped by a deploy.
 *
 * Best-effort, like every other boot-time schema task here — a failure logs and
 * the API still serves.
 */
export async function ensureConfiguredSuperAdmins(log: Logger): Promise<void> {
  const emails = configuredSuperAdmins();
  if (emails.length === 0) return;

  if (!(await superAdminColumnExists())) {
    log.warn(
      "[superadmin] User.isSuperAdmin is missing — SUPERADMIN_EMAILS cannot be applied yet"
    );
    return;
  }

  for (const email of emails) {
    try {
      const updated = await prisma.user.updateMany({
        where: { email, isSuperAdmin: false },
        data: { isSuperAdmin: true },
      });
      if (updated.count > 0) log.info(`[superadmin] granted platform access to ${email}`);
    } catch (err) {
      log.warn(
        `[superadmin] could not grant ${email}: ${err instanceof Error ? err.message : err}`
      );
    }
  }
}

/**
 * Is this user a super admin RIGHT NOW, according to the database?
 *
 * Read from the row rather than trusted from the JWT, which is the one place
 * this feature departs from how the rest of the API checks permissions. Org
 * roles are read straight off the token; this is not, because:
 *
 *   - tokens live 7 days and renew (see TOKEN_RENEW_AFTER_MS in routes/auth.ts),
 *     so a token minted while someone was a super admin keeps saying so for up
 *     to a week after the flag is taken away, and
 *   - what it authorises is cross-org and destructive. "Revoked but still valid
 *     until Thursday" is acceptable for reading your own org's projects and is
 *     not acceptable for deleting somebody else's organization.
 *
 * One indexed SELECT, only on the `/admin/*` routes.
 */
export async function isSuperAdmin(userId: string): Promise<boolean> {
  if (!(await superAdminColumnExists())) return false;
  try {
    const rows = await prisma.$queryRaw<{ isSuperAdmin: boolean; status: string }[]>`
      SELECT "isSuperAdmin", "status"::text AS status FROM "User" WHERE "id" = ${userId}::uuid LIMIT 1
    `;
    const row = rows[0];
    // A disabled account loses platform access immediately, exactly as it loses
    // ordinary access in GET /auth/me.
    return Boolean(row?.isSuperAdmin) && row?.status === "active";
  } catch {
    // Fail closed. An unreadable flag is not a granted one.
    return false;
  }
}

/**
 * A Prisma `where` fragment that hides audit rows a super admin was the actor
 * on, unless the reader is themselves a super admin.
 *
 * Platform staff are invisible in this product: they do not appear in an org's
 * member list (see `hideSuperAdminsFrom` in routes/members.ts), and nothing they
 * do appears in the org's trail either. An org admin reading the audit log
 * should have no way to infer that an account above theirs exists — a row
 * naming an actor they cannot find in /members would say exactly that.
 *
 * `actorId: null` is admitted explicitly. Prisma compiles a relation filter as
 * an inner join, so `{ actor: { isSuperAdmin: false } }` alone would also drop
 * every system-originated row (`auditLog()` allows a null actor by design) and
 * every row whose actor has since been hard-deleted — which is precisely the
 * history the table exists to preserve.
 *
 * Wrapped in `AND` rather than returned as a bare `OR`, and that is load-bearing
 * rather than stylistic. Callers spread this into a `where` object that already
 * builds an `OR` of its own for the free-text search, and a second `OR` key
 * would not combine with the first — it would replace it. Whichever spread came
 * last would win, so a filtered search would have quietly shown exactly the rows
 * this is here to hide.
 */
export async function auditActorVisibility(readerId: string): Promise<object> {
  if (await isSuperAdmin(readerId)) return {};
  if (!(await superAdminColumnExists())) return {};
  return { AND: [{ OR: [{ actorId: null }, { actor: { isSuperAdmin: false } }] }] };
}
