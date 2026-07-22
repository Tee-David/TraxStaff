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

export async function api<T = unknown>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set("Content-Type", "application/json");
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  if (!res.ok) {
    let msg = res.statusText;
    try {
      msg = (await res.json()).error ?? msg;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
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
  id: string;
  email: string;
  role: string;
  orgId: string;
  consentAcceptedAt: string | null;
  consentVersion: number | null;
}

// The client's current disclosure version. Bump when what's collected changes,
// which re-triggers the consent screen for everyone on next launch.
export const CONSENT_VERSION = 1;
