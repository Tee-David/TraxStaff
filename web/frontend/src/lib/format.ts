import { DELETED_USER_LABEL } from "./reports";

/** Format a duration in seconds as H:MM:SS. */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${h}:${m.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`;
}

/** Compact duration like "6h 54m" for summaries. */
export function formatDurationShort(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h === 0) return `${m}m`;
  return `${h}h ${m}m`;
}

/**
 * The minimum a session row needs for the two helpers below.
 *
 * `effectiveEndAt` and `workedSeconds` are computed and sent by the backend
 * (lib/duration.ts). They are optional so a response from an older deploy — or a
 * locally-constructed row — still renders, falling back to the old arithmetic
 * rather than showing nothing.
 */
export type TimedSession = {
  startedAt: string;
  endedAt: string | null;
  effectiveEndAt?: string | null;
  workedSeconds?: number | null;
  /**
   * Stretches deducted from this session, with their real spans, so a deduction can
   * be attributed to the day it actually happened in rather than spread across the
   * whole session. See overlapSeconds below.
   */
  idleSpans?: { from: string; to: string; seconds: number }[] | null;
};

/**
 * When a session effectively ended, as a Date.
 *
 * NOT `endedAt ?? now`. Nothing in the system used to close an abandoned session,
 * so treating a null `endedAt` as "still running" meant a row left open by a crash
 * or a shutdown grew by sixty seconds a minute, for as long as it existed — which
 * is how a member who had tracked seven minutes was shown 44h58m for the week. The
 * server now decides where an open session stops, based on the last evidence its
 * device was alive; this reads that decision instead of guessing.
 */
export function sessionEnd(s: TimedSession): Date {
  if (s.effectiveEndAt) return new Date(s.effectiveEndAt);
  if (s.endedAt) return new Date(s.endedAt);
  return new Date();
}

/**
 * How long a session lasted, in seconds.
 *
 * Prefers the server's `workedSeconds` — the only figure that also accounts for
 * idle the member discarded, which no client can see. Falls back to the bounded
 * wall clock.
 */
export function sessionSeconds(s: TimedSession): number {
  if (typeof s.workedSeconds === "number") return s.workedSeconds;
  const start = new Date(s.startedAt).getTime();
  return Math.max(0, (sessionEnd(s).getTime() - start) / 1000);
}

/**
 * The part of a session that falls inside [fromMs, toMs).
 *
 * Time belongs to the window it was worked in, not to the one the session started
 * in: a shift from 23:00 to 03:00 owns one hour of the first day and three of the
 * second. This matters more now than it used to — /sessions filters by overlap, so
 * a session that began before the requested window is deliberately returned, and
 * summing its whole duration would credit the week with time worked before it.
 *
 * Deducted stretches come off the exact window they happened in, using the spans in
 * `idleSpans`. Spreading them proportionally across the session instead — which is
 * what a single worked/gross ratio does — reports a day of real work as a fraction
 * of itself, and still shows hours on a day when nothing happened at all.
 */
export function overlapSeconds(s: TimedSession, fromMs: number, toMs: number): number {
  const start = new Date(s.startedAt).getTime();
  const end = sessionEnd(s).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  const winFrom = Math.max(start, fromMs);
  const winTo = Math.min(end, toMs);
  const inside = Math.max(0, winTo - winFrom) / 1000;
  if (inside <= 0) return 0;
  const idle = (s.idleSpans ?? []).reduce((a, span) => {
    const f = new Date(span.from).getTime();
    const t = new Date(span.to).getTime();
    return a + Math.max(0, Math.min(t, winTo) - Math.max(f, winFrom)) / 1000;
  }, 0);
  return Math.max(0, inside - idle);
}

/**
 * Display name for a row's owner, which may no longer exist.
 *
 * Hard-deleting a member sets TrackingSession.userId to NULL so their tracked
 * work survives them, which means every surface that shows an owner can be handed
 * a null relation. Centralised so a new call site gets the fallback for free
 * rather than reaching for `.email` and taking the page down — that is exactly
 * how the Insights panel started throwing a client exception.
 */
export function ownerName(user: { email: string } | null | undefined): string {
  return user ? user.email.split("@")[0] : DELETED_USER_LABEL;
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}
