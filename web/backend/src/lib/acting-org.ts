/**
 * Letting a super admin drive the ordinary dashboard against somebody else's
 * organization.
 *
 * The problem this solves: every page in this product — Reports, Screenshots,
 * Members, Projects, Insights, the audit log — is already written against
 * `req.user.orgId`, in about fifty places across ten route modules. A platform
 * console that reproduced those views would be a second implementation of all
 * of them, permanently drifting from the first.
 *
 * So nothing is reproduced. A super admin sends `x-trax-org: <orgId>` and
 * `fastify.authenticate` rewrites `req.user.orgId` (and `role`) before any
 * handler runs. All fifty call sites inherit it without being touched, and the
 * existing pages simply render the other org's data.
 *
 * `authenticate` is the right place because it is the one universal choke
 * point: every route module except `health` runs it, each of the non-auth ones
 * as a module-level preHandler hook. There is no authenticated request that
 * bypasses it, so there is no authenticated request that could bypass this.
 *
 * ─── The security property ───────────────────────────────────────────────
 *
 * This header is a cross-tenant read primitive in the hands of anyone who is
 * not a super admin. That makes `isSuperAdmin()` — which reads the DATABASE,
 * not the token's claim — the single load-bearing check in the module, and it
 * is why the logic below lives in pure functions with tests rather than inline
 * in the plugin.
 *
 * A caller who is not a super admin is IGNORED, not refused. A 403 would
 * confirm to any authenticated user that the mechanism exists and that some
 * accounts can use it; silently serving them their own org tells them nothing.
 */

/** What a client sends to act on another org. */
export const ACTING_ORG_HEADER = "x-trax-org";

/** Echoed back so a client can confirm which org actually answered. */
export const ACTING_ORG_ECHO_HEADER = "x-trax-acting-org";

/**
 * Paths the rewrite must never apply to.
 *
 * Two different reasons, and both matter:
 *
 * `/auth/*` — these routes are about WHO YOU ARE, not which org you are looking
 * at. `/auth/me` has to report the real identity or the client cannot tell it is
 * impersonating an org at all (and the sliding token renewal would mint a token
 * for the wrong org). `/auth/change-password` has to act on the real account.
 *
 * `/admin/*` — the platform routes take an explicit `orgId` in the path or body.
 * Letting a header quietly redirect them as well would give every one of them
 * two sources of truth for which org it is operating on.
 *
 * The tracker endpoints — these CREATE rows attributed to `req.user.userId`. A
 * super admin whose desktop app is running must never start a session, sync
 * blocks, or file a manual entry into a customer's organization because a
 * dropdown was left switched. Nothing else in the API writes rows keyed to the
 * caller's own identity in this way.
 */
const EXCLUDED_PREFIXES = ["/auth/", "/admin/"] as const;

const EXCLUDED_EXACT = [
  "/sessions/start",
  "/sessions/manual",
  "/sync",
] as const;

/** `/sessions/<uuid>/stop`, `/heartbeat`, and anything else the tracker posts. */
const EXCLUDED_PATTERNS = [/^\/sessions\/[^/]+\/(stop|heartbeat)$/, /^\/sync(\/|$)/] as const;

/**
 * May the acting-org rewrite apply to this path?
 *
 * Takes the raw url so it can be called with `req.url` directly; the query
 * string is stripped here rather than at every call site.
 */
export function actingOrgAllowed(url: string): boolean {
  const path = url.split("?")[0];
  if (EXCLUDED_PREFIXES.some((p) => path.startsWith(p))) return false;
  if ((EXCLUDED_EXACT as readonly string[]).includes(path)) return false;
  if (EXCLUDED_PATTERNS.some((re) => re.test(path))) return false;
  return true;
}

/** Loosely-typed header bag, so this can be tested without a Fastify request. */
export type HeaderBag = Record<string, string | string[] | undefined>;

/**
 * The requested org id, or null when there isn't a usable one.
 *
 * Node lower-cases incoming header names, but a duplicated header arrives as an
 * array — take the first rather than stringifying the whole array into a value
 * that can never match a uuid.
 */
export function requestedOrgId(headers: HeaderBag): string | null {
  const raw = headers[ACTING_ORG_HEADER];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ActingOrgDeps {
  /** Reads the flag from the database — never the token's claim. */
  isSuperAdmin: (userId: string) => Promise<boolean>;
  /** Confirms the target exists, so a typo cannot scope queries to nothing. */
  orgExists: (orgId: string) => Promise<boolean>;
}

export interface ActingOrgRequest {
  url: string;
  headers: HeaderBag;
  userId: string;
  /** The org the token itself names. */
  orgId: string;
}

/**
 * Decide which org this request should be scoped to.
 *
 * Returns the org to act on, or null to leave `req.user` exactly as the token
 * described it. Null is the answer for every failure — not a super admin, an
 * excluded path, a malformed id, an org that does not exist — because none of
 * those should be distinguishable from the outside.
 *
 * The order of the checks is deliberate: the cheap, local ones run before the
 * two database round trips, so an ordinary member's request (which is every
 * request, almost always) costs nothing but a header lookup.
 */
export async function resolveActingOrg(
  req: ActingOrgRequest,
  deps: ActingOrgDeps
): Promise<string | null> {
  const requested = requestedOrgId(req.headers);
  if (!requested) return null;

  // Already scoped there — no rewrite needed, and no reason to spend two
  // queries confirming what the token already says.
  if (requested === req.orgId) return null;

  if (!actingOrgAllowed(req.url)) return null;

  // Validated before it reaches the database. `orgExists` interpolates the id
  // into a uuid cast, and a value that cannot be a uuid should never get there.
  if (!UUID_RE.test(requested)) return null;

  if (!(await deps.isSuperAdmin(req.userId))) return null;
  if (!(await deps.orgExists(requested))) return null;

  return requested;
}

/**
 * The role a super admin holds while acting on another org.
 *
 * `owner` rather than their own role, because every privileged branch in the
 * API is spelled `role === "owner" || role === "admin"` and a platform operator
 * needs to clear all of them. Their real role — whatever they are in their own
 * organization — is irrelevant to an org they are only visiting.
 *
 * Note this is NOT a privilege escalation: reaching this line already required
 * `isSuperAdmin()` to return true, and a super admin outranks an owner
 * everywhere by definition.
 */
export const ACTING_ORG_ROLE = "owner" as const;
