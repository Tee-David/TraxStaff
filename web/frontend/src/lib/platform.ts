/**
 * Types and helpers for the platform console.
 *
 * Kept apart from lib/types.ts because nothing here is part of the product an
 * org uses — these shapes only ever come back from `/admin/*`, which no
 * ordinary account can reach. Mixing them into the shared types would invite an
 * org-facing page to start rendering one.
 */

export interface PlatformOrgRow {
  id: string;
  name: string;
  status?: string;
  memberCount: number;
  projectCount: number;
  createdAt: string;
}

export interface PlatformUserRow {
  id: string;
  email: string;
  name: string | null;
  role: "owner" | "admin" | "member";
  status: "invited" | "active" | "disabled" | "removed";
  isSuperAdmin: boolean;
  orgId: string;
  orgName: string;
  createdAt: string;
}

export interface PlatformLogRow {
  id: string;
  actorId: string | null;
  action: string;
  orgId: string | null;
  payload: Record<string, unknown> | null;
  createdAt: string;
}

export interface SnapshotRow {
  id: string;
  kind: string;
  userId: string | null;
  orgId: string | null;
  restoredAt: string | null;
  expiresAt: string;
  createdAt: string;
  counts: { sessions: number; activityBlocks: number; screenshots: number };
}

/** One day of a planned backfill, as `/admin/time` reports it. */
export interface PlannedDayRow {
  dayKey: string;
  sessionId: string;
  startedAt: string;
  endedAt: string;
  seconds: number;
  blocks: number;
}

export interface TimePlanResponse {
  written?: boolean;
  dryRun?: boolean;
  reason?: string;
  snapshotId?: string | null;
  timezone?: string;
  range?: { from: string; to: string; only?: string[] };
  hoursPerDay?: number;
  totalSeconds?: number;
  alreadyTrackedSeconds?: number;
  fill?: string;
  days?: PlannedDayRow[];
  skippedDays?: string[];
  pattern?: {
    startMinutes: number;
    hoursPerDay: number;
    activityPct: number;
    sampleDays: number;
  } | null;
  supersededSessions?: {
    id: string;
    startedAt: string;
    endedAt: string | null;
    seconds: number;
    isManual: boolean;
  }[];
  supersededSeconds?: number;
  supersededCaptured?: number;
  user?: { id: string; email: string; orgId: string };
  project?: { id: string; name: string };

  /**
   * The activity-only response (`PATCH /admin/users/:id/activity`) shares this
   * type rather than getting its own, because the preview panel renders both and
   * a union would mean narrowing on every field it touches. The two shapes
   * overlap on everything that matters and the extras below are simply absent on
   * a hours response.
   */
  updated?: number;
  /** Sessions whose existing blocks were rewritten in place, keeping screenshots. */
  rechained?: number;
  /** Sessions that had no blocks at all and were given a fresh chain. */
  generated?: number;
  /**
   * Blocks lying partly outside the chosen period.
   *
   * A block stores one percentage for its whole span, so one that straddles the
   * edge cannot be half-rewritten — it follows whichever side holds most of it,
   * which nudges the neighbouring day slightly. Surfaced so that movement is
   * explained rather than discovered.
   */
  straddling?: number;
  sessions?: {
    id: string;
    dayKey: string;
    startedAt: string;
    endedAt: string | null;
    isManual: boolean;
    existingBlocks: number;
    screenshots: number;
    strategy: "rechain-in-place" | "generate";
  }[];
}

/** `43200` → `12h 00m`. Distinct from formatDuration, which drops the zero minutes. */
export function hoursMinutes(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  return `${h}h ${String(m).padStart(2, "0")}m`;
}

/** Monday of the week containing `dayKey`. Mirrors weekStartKey() on the backend. */
export function weekStart(dayKey: string): string {
  const [y, m, d] = dayKey.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday
  return addDays(dayKey, -((dow + 6) % 7));
}

/** Calendar-safe day arithmetic on a `YYYY-MM-DD` key. */
export function addDays(dayKey: string, n: number): string {
  const [y, m, d] = dayKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** Today as `YYYY-MM-DD`, in the viewer's own zone. */
export function todayKey(): string {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

/** `2026-08-24` → `Mon 24 Aug`. */
export function shortDay(dayKey: string): string {
  const [y, m, d] = dayKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-GB", {
    timeZone: "UTC",
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

/** Every day from `from` to `to` inclusive, capped so a typo cannot hang the page. */
export function daysBetween(from: string, to: string, cap = 62): string[] {
  if (!from || !to || to < from) return [];
  const out: string[] = [];
  for (let k = from; k <= to && out.length < cap; k = addDays(k, 1)) out.push(k);
  return out;
}

/** Human label for a platform log action. Unknown actions fall back to the raw key. */
export const LOG_ACTION_LABELS: Record<string, string> = {
  "org.created": "Organization created",
  "org.settings_changed": "Settings changed",
  "org.suspended": "Organization suspended",
  "org.resumed": "Organization resumed",
  "org.deleted": "Organization deleted",
  "user.updated": "User updated",
  "user.deleted": "User deleted",
  "user.invited": "User invited",
  "user.impersonated": "Impersonation token issued",
  "superadmin.granted": "Super admin granted",
  "superadmin.revoked": "Super admin revoked",
  "time.written": "Time written",
  "time.replaced": "Time replaced",
  "time.bulk_written": "Bulk time written",
  "activity.rewritten": "Activity rewritten",
  "session.trimmed": "Session trimmed",
  "session.deleted": "Session deleted",
  "snapshot.restored": "Undo restored",
};

/** Actions that destroyed or overwrote data, so the log can mark them. */
export const DESTRUCTIVE_ACTIONS = new Set([
  "org.deleted",
  "user.deleted",
  "time.replaced",
  "session.trimmed",
  "session.deleted",
  "activity.rewritten",
  "superadmin.granted",
  "user.impersonated",
]);
