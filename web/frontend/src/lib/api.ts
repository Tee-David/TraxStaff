export const API_BASE =
  process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:3099";

export interface AuthUser {
  id: string;
  email: string;
  name?: string | null;
  role: "owner" | "admin" | "member";
  orgId?: string;
  /** Present only when /auth/me rolled the token forward (sliding renewal). */
  token?: string;
}

const TOKEN_KEY = "trax_token";

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
