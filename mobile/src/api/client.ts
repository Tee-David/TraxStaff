import Constants from "expo-constants";
import type {
  AuthResponse,
  Me,
  Project,
  ReportSummary,
  Session,
  StartedSession,
  Task,
  TaskPriority,
  TimesheetDay,
} from "./types";

export const API_URL: string =
  (Constants.expoConfig?.extra?.apiUrl as string | undefined) ??
  process.env.EXPO_PUBLIC_API_URL ??
  "https://trax-backend-ocaq.onrender.com";

// The backend is on Render's free Web Service tier and sleeps after ~15min
// idle. A cold start regularly takes 30-50s, so the request timeout has to sit
// well above it — a 10s timeout would turn every first-request-of-the-day into
// a spurious "network error".
const REQUEST_TIMEOUT_MS = 75_000;
// How long a request may run before the UI is told to explain the wait.
export const COLD_START_HINT_MS = 4_000;

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body?: unknown
  ) {
    super(message);
    this.name = "ApiError";
  }
  /** The caller's token is gone or the account was disabled — sign out. */
  get isAuth() {
    return this.status === 401;
  }
  /** No HTTP response at all: offline, DNS failure or timeout. */
  get isOffline() {
    return this.status === 0;
  }
}

type TokenSource = () => string | null;

let getToken: TokenSource = () => null;

/** Wired once by the auth provider so every call carries the current JWT
 *  without threading it through each call site. */
export function setTokenSource(fn: TokenSource) {
  getToken = fn;
}

async function request<T>(
  path: string,
  init: { method?: string; body?: unknown; auth?: boolean; signal?: AbortSignal } = {}
): Promise<T> {
  const { method = "GET", body, auth = true } = init;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  // Let a caller-supplied signal (screen unmount) also cancel the request.
  const onAbort = () => controller.abort();
  init.signal?.addEventListener("abort", onAbort);

  const headers: Record<string, string> = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (auth) {
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    const aborted = controller.signal.aborted;
    throw new ApiError(
      0,
      aborted
        ? "The server did not respond in time. It may still be starting up — try again."
        : "Can't reach Trax. Check your connection.",
      err
    );
  } finally {
    clearTimeout(timer);
    init.signal?.removeEventListener("abort", onAbort);
  }

  if (res.status === 204) return undefined as T;

  const text = await res.text();
  let parsed: unknown = undefined;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }

  if (!res.ok) {
    const message =
      (parsed && typeof parsed === "object" && "error" in parsed && typeof parsed.error === "string"
        ? parsed.error
        : undefined) ??
      (parsed && typeof parsed === "object" && "message" in parsed && typeof parsed.message === "string"
        ? parsed.message
        : undefined) ??
      `Request failed (${res.status})`;
    throw new ApiError(res.status, message, parsed);
  }

  return parsed as T;
}

const qs = (params: Record<string, string | undefined>) => {
  const pairs = Object.entries(params).filter(([, v]) => v !== undefined) as [string, string][];
  return pairs.length ? `?${pairs.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&")}` : "";
};

export const api = {
  /** Cheap unauthenticated ping used to wake a cold-started Render dyno. */
  health: () => request<{ status: string }>("/health", { auth: false }),

  login: (email: string, password: string) =>
    request<AuthResponse>("/auth/login", { method: "POST", auth: false, body: { email, password } }),

  me: () => request<Me>("/auth/me"),

  acceptConsent: (version: number) =>
    request<{ ok: true }>("/auth/consent", { method: "POST", body: { version } }),

  projects: () => request<Project[]>("/projects"),

  tasks: (projectId: string) => request<Task[]>(`/projects/${projectId}/tasks`),

  createTask: (projectId: string, title: string, priority?: TaskPriority) =>
    request<Task>(`/projects/${projectId}/tasks`, { method: "POST", body: { title, priority } }),

  updateTask: (id: string, patch: { title?: string; status?: Task["status"]; priority?: TaskPriority }) =>
    request<Task>(`/tasks/${id}`, { method: "PATCH", body: patch }),

  sessions: (range?: { from?: string; to?: string }) =>
    request<Session[]>(`/sessions${qs({ from: range?.from, to: range?.to })}`),

  /** Idempotent on `id`: a retry after a failed response returns the existing
   *  row rather than creating a second session. That is what makes the
   *  offline-first queue safe to replay. */
  startSession: (input: {
    id: string;
    startedAt: string;
    projectId: string;
    taskId?: string;
    deviceId: string;
    platform: string;
    appVersion: string;
  }) => request<StartedSession>("/sessions/start", { method: "POST", body: input }),

  stopSession: (id: string, endReason: "stopped" | "abrupt_exit" = "stopped") =>
    request<Session>(`/sessions/${id}/stop`, { method: "POST", body: { endReason } }),

  heartbeat: (id: string) => request<{ ok: true }>(`/sessions/${id}/heartbeat`, { method: "POST" }),

  addNote: (id: string, body: string) =>
    request<{ id: string; body: string; createdAt: string }>(`/sessions/${id}/notes`, {
      method: "POST",
      body: { body },
    }),

  summary: (range?: { from?: string; to?: string }) =>
    request<ReportSummary>(`/reports/summary${qs({ from: range?.from, to: range?.to })}`),

  timesheet: (range?: { from?: string; to?: string }) =>
    request<TimesheetDay[]>(`/reports/timesheet${qs({ from: range?.from, to: range?.to })}`),
};
