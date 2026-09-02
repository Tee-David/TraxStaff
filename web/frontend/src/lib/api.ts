export const API_BASE =
  process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:3099";

export interface AuthUser {
  id: string;
  email: string;
  name?: string | null;
  role: "owner" | "admin" | "member";
  /**
   * Platform-level access, orthogonal to `role` — Trax staff, above all orgs.
   * Served by /auth/me from the database row, so it goes stale the moment it is
   * revoked rather than at the end of the token's life. Nothing is authorised
   * by it client-side; the backend re-checks on every /admin call.
   */
  isSuperAdmin?: boolean;
  orgId?: string;
  /** Present only when /auth/me rolled the token forward (sliding renewal). */
  token?: string;
}

const TOKEN_KEY = "trax_token";
const ACTING_ORG_KEY = "trax_acting_org";

/**
 * The organization a super admin is currently operating on.
 *
 * Held in a module variable rather than in React state because `api()` is a
 * plain function called from everywhere, including outside a component tree.
 * The provider in lib/acting-org.tsx owns the value; this is just where `api()`
 * can reach it.
 *
 * Sending it is harmless for everyone else: the backend ignores the header
 * unless the caller is a super admin (see lib/acting-org.ts there), so a stale
 * value in localStorage can never widen anybody's access.
 */
let actingOrgId: string | null = null;

export function getActingOrg(): string | null {
  if (actingOrgId !== null) return actingOrgId;
  if (typeof window === "undefined") return null;
  try {
    actingOrgId = window.localStorage.getItem(ACTING_ORG_KEY);
  } catch {
    // Private mode, or site data blocked. Acting on one org for the session is
    // a perfectly good fallback; losing it on reload is not worth a crash.
    actingOrgId = null;
  }
  return actingOrgId;
}

export function setActingOrg(orgId: string | null) {
  actingOrgId = orgId;
  try {
    if (orgId) window.localStorage.setItem(ACTING_ORG_KEY, orgId);
    else window.localStorage.removeItem(ACTING_ORG_KEY);
  } catch {
    /* see getActingOrg */
  }
}

export function getToken(): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(/(?:^|;\s*)trax_token=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

export function setToken(token: string) {
  // 7-day cookie; SameSite=Lax so it rides along on same-site navigations.
  document.cookie = `${TOKEN_KEY}=${encodeURIComponent(token)}; path=/; max-age=${7 * 24 * 60 * 60}; SameSite=Lax`;
}

export function clearToken() {
  document.cookie = `${TOKEN_KEY}=; path=/; max-age=0; SameSite=Lax`;
  // Signing out must drop the acting org too, or the next person to sign in on
  // this browser starts out pointed at somebody else's organization.
  setActingOrg(null);
  // And the impersonation stash. This path is reached by an expiring token as
  // well as by signing out, so without it a session that lapsed mid-
  // impersonation would leave the banner offering a "Return to platform" button
  // holding a token that expired at the same moment.
  try {
    window.sessionStorage.removeItem("trax_impersonation");
  } catch {
    /* private mode — nothing was stored to begin with */
  }
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function api<T = unknown>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const token = getToken();
  const headers = new Headers(options.headers);
  headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);

  // The org switcher. Attached to every request so the existing pages — Reports,
  // Members, Screenshots, Projects — answer for the selected org without any of
  // them knowing this exists. The backend rewrites the request's org only for a
  // super admin and never on /auth/*, /admin/* or the tracker's own endpoints.
  const acting = getActingOrg();
  if (acting) headers.set("x-trax-org", acting);

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });

  if (!res.ok) {
    let message = res.statusText;
    try {
      const body = await res.json();
      message = body.error ?? message;
    } catch {
      /* ignore */
    }
    // The token we sent was rejected — it's expired or no longer valid. Drop it
    // and send the user to sign in, rather than leaving a signed-in-looking page
    // whose every request fails. Guarded on `token`: a failed /auth/login is a
    // 401 too, and that one has to stay put and say "invalid credentials".
    if (res.status === 401 && token) {
      clearToken();
      if (typeof window !== "undefined" && !window.location.pathname.startsWith("/login")) {
        // Carry `next` the same way middleware.ts does, so signing back in
        // returns to the page they were on rather than the dashboard root.
        const next = encodeURIComponent(window.location.pathname);
        window.location.href = `/login?next=${next}`;
      }
    }
    throw new ApiError(res.status, message);
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

/**
 * Coerce a list response into an array before it reaches `.map`/`.filter`.
 *
 * `api<T[]>()` is a cast, not a check — a 200 whose body isn't an array (an error
 * envelope, a shape change, a proxy's HTML) sails through the type system and
 * then throws inside render. Because the dashboard is one client tree with no
 * error boundary between pages, that throw took every page down at once. An empty
 * list renders the page's own "nothing here" state instead.
 */
export function asArray<T>(value: unknown): T[] {
  if (!Array.isArray(value)) return [];
  // A list endpoint that ever serialises a `null` entry (a tombstone, a
  // shape change, a proxy's JSON) otherwise throws "reading 'x' of null"
  // inside the first `.map` that touches it — no error boundary above the
  // dashboard tree means that takes every page down at once.
  return value.filter((entry): entry is T => entry != null) as T[];
}
