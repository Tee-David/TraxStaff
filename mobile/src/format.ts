/** Duration formatting. Every input is clamped at zero: a negative duration is
 *  always a bug somewhere upstream and must never be rendered as "-0:05". */

export function clampSeconds(s: number | null | undefined): number {
  if (s == null || !Number.isFinite(s)) return 0;
  return s < 0 ? 0 : s;
}

/** 1:23:45 — the running timer. */
export function fmtClock(totalSeconds: number | null | undefined): string {
  const t = Math.floor(clampSeconds(totalSeconds));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** 3h 07m / 12m — totals and summaries. */
export function fmtShort(totalSeconds: number | null | undefined): string {
  const t = Math.floor(clampSeconds(totalSeconds));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  if (h === 0 && m === 0) return `${t}s`;
  if (h === 0) return `${m}m`;
  return `${h}h ${String(m).padStart(2, "0")}m`;
}

/** The minimum a session row needs for the two helpers below. */
export type TimedSession = {
  startedAt: string;
  endedAt: string | null;
  effectiveEndAt?: string;
  workedSeconds?: number;
};

/**
 * When a session effectively ended.
 *
 * NOT `endedAt ?? Date.now()`. Nothing in the system used to close a session
 * abandoned by a crash, a shutdown or a rejected token, so an open row read as
 * "still running" indefinitely — one forgotten session displayed as tens of hours
 * of work. The server now decides where an open session stops and sends it as
 * `effectiveEndAt`; falling back to `now` is only right for a session that really
 * is live and has no server opinion yet.
 */
export function sessionEndMs(s: TimedSession): number {
  if (s.effectiveEndAt) return new Date(s.effectiveEndAt).getTime();
  if (s.endedAt) return new Date(s.endedAt).getTime();
  return Date.now();
}

/**
 * How long a session lasted, in seconds. Prefers the server's `workedSeconds`,
 * which is the only figure that also nets off idle the member discarded — the
 * phone cannot see IdleDiscard rows at all.
 */
export function sessionSeconds(s: TimedSession): number {
  if (typeof s.workedSeconds === "number") return clampSeconds(s.workedSeconds);
  return clampSeconds((sessionEndMs(s) - new Date(s.startedAt).getTime()) / 1000);
}

export function fmtTime(iso: string | number): string {
  const d = typeof iso === "number" ? new Date(iso) : new Date(iso);
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

/** Local YYYY-MM-DD. Deliberately not `toISOString().slice(0,10)`, which is UTC
 *  and puts a 9pm session on the wrong day for anyone east of Greenwich. */
export function localDayKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function dayLabel(key: string): string {
  const today = localDayKey(new Date());
  const yesterday = localDayKey(new Date(Date.now() - 86_400_000));
  if (key === today) return "Today";
  if (key === yesterday) return "Yesterday";
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

export function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Monday-based week start, matching the web dashboards. */
export function startOfWeek(): Date {
  const d = startOfToday();
  const shift = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - shift);
  return d;
}
