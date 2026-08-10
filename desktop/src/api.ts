// Backend base URL. Overridable at build time via VITE_BACKEND_URL; otherwise
// dev builds hit the local backend and release builds hit production. Never
// let a release build silently fall back to localhost (that shipped a broken
// exe once — every API call failed on end-user machines).
export const API_BASE =
  (import.meta.env.VITE_BACKEND_URL as string | undefined) ??
  (import.meta.env.DEV ? "http://localhost:3099" : "https://trax-backend-ocaq.onrender.com");

const TOKEN_KEY = "trax_desktop_token";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}
export function setToken(t: string) {
  localStorage.setItem(TOKEN_KEY, t);
}
export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

/** Carries the HTTP status through, so callers can tell "your token is dead"
 *  apart from "the network is down". Mirrors the web app's ApiError. */
export class ApiError extends Error {
  status: number;
  code?: string;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

/**
 * Fired once when the server rejects the token we sent.
 *
 * A rejected token is NOT a transient failure, but every layer here used to
 * treat it as one: the app counted itself signed in as long as localStorage
 * held a string, the consent gate read a 401 as "offline", and the sync engine
 * retries 401s forever. The result was a tracker that looked signed in, showed
 * "Unauthorized" and an empty project list, and could never recover. This event
 * is what turns that dead end into "please sign in again".
 *
 * A window event rather than a single callback because both the app shell (to
 * show the login screen) and the tracker (to save the running session and stop
 * capture) have to react to it.
 */
export const UNAUTHORIZED_EVENT = "trax:unauthorized";

export async function api<T = unknown>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set("Content-Type", "application/json");
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);

  // Retry only on NETWORK failures (fetch rejects — DNS blip, dropped
  // connection, Render cold start). HTTP error responses are returned as-is and
  // never retried, since they're real (bad credentials, 404, etc.).
  let res: Response | undefined;
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      res = await fetch(`${API_BASE}${path}`, { ...options, headers });
      break;
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
    }
  }
  if (!res) throw new Error(lastErr instanceof Error ? lastErr.message : "Network error");

  if (!res.ok) {
    let msg = res.statusText;
    let code: string | undefined;
    try {
      const body = await res.json();
      msg = body.error ?? msg;
      code = body.code;
    } catch {
      /* ignore */
    }
    // A token we sent came back rejected: drop it and tell the app to re-auth.
    // Guarded on `token` because a failed /auth/login is also a 401 — that one
    // means "wrong password" and must stay on the login screen saying so.
    if (res.status === 401 && token) {
      clearToken();
      // Carry the reason, because not every 401 is an expired token: /auth/me
      // answers "Account disabled" for a member who has been switched off, and
      // telling that person their session expired would send them round a
      // login loop that can never succeed.
      const reason =
        code === "token_expired"
          ? "Your session expired — please sign in again."
          : msg && msg !== "Unauthorized"
            ? msg
            : "Please sign in again.";
      window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT, { detail: { message: reason } }));
      throw new ApiError(401, reason, code ?? "unauthorized");
    }
    throw new ApiError(res.status, msg, code);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export interface Project {
  id: string;
  name: string;
  clientTag: string | null;
  archivedAt?: string | null;
  tasks?: { id: string; title: string; status: string; priority: "lowest" | "normal" | "urgent"; dueDate: string | null }[];
}

export interface Session {
  id: string;
  projectId: string;
  taskId: string | null;
  startedAt: string;
  endedAt: string | null;
  deviceId?: string;
  isManual?: boolean;
  tamperSuspected?: boolean;
  discardedSeconds?: number;
  project: { id: string; name: string; clientTag: string | null };
  task?: { id: string; title: string } | null;
  notes?: { id: string; body: string; createdAt: string }[];
}

export interface Me {
  /** Present only when the server rolled our token forward (sliding renewal).
   *  Store it when it appears — that's what keeps a tray app in daily use from
   *  ever hitting the 7-day expiry. */
  token?: string;
  id: string;
  email: string;
  role: string;
  orgId: string;
  consentAcceptedAt: string | null;
  consentVersion: number | null;
  /** Already resolved server-side: the member's own override, else the org
   *  default. The client renders one number and does not re-derive it. */
  dailyTargetMinutes?: number;
  weeklyTargetMinutes?: number;
}

// The client's current disclosure version. Bump when what's collected changes,
// which re-triggers the consent screen for everyone on next launch.
export const CONSENT_VERSION = 1;
