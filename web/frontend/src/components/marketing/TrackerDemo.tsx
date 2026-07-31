"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { motion, useReducedMotion } from "motion/react";

/**
 * The tracker, working, at the top of the phone hero.
 *
 * A rebuild of the desktop tray panel — the ring, the running clock, the day
 * and week totals, the project rows — from this site's own tokens rather than
 * a screenshot of it, because the point is that you can *use* it: tap the
 * button and the clock runs, the ring fills, the project row ticks with it.
 * That is the product in one gesture, and it's the reason this replaced the
 * still capture that was here.
 *
 * Phones only (the hero renders it under `sm`). Wide screens have the floating
 * platform cards for the same job.
 *
 * Nothing here talks to the API. The starting numbers are illustrative, which
 * is what the "Live demo" chip in the window chrome says on the page itself.
 */

/** What the ring fills against — the same 8h day the mobile app frames. */
const DAY_TARGET_SECONDS = 8 * 3600;
/** Time "already tracked" before the visitor starts, so the ring isn't empty. */
const SEED_TODAY_SECONDS = 5 * 3600 + 12 * 60 + 40;
const WEEK_SECONDS = 27 * 3600 + 5 * 60;

const PROJECTS = [
  { name: "Client onboarding", seconds: 2 * 3600 + 15 * 60 },
  { name: "Support queue", seconds: 3600 + 40 * 60 },
  { name: "Weekly report", seconds: 47 * 60 },
];

function clock(total: number) {
  const s = Math.max(0, Math.floor(total));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

function short(total: number) {
  const s = Math.max(0, Math.floor(total));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export function TrackerDemo() {
  const reduce = useReducedMotion() ?? false;
  const gradientId = useId();

  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  /** Sessions the visitor already stopped — they stay on today's total, the
   *  way ending a real session rolls its time into the day. */
  const [banked, setBanked] = useState(0);

  const running = startedAt !== null;

  useEffect(() => {
    if (startedAt === null) return;
    // Count off the wall clock rather than incrementing a counter: a
    // backgrounded tab throttles timers, and a counter would quietly drift
    // behind while the ring kept animating.
    const tick = () => setElapsed(Math.max(0, Math.round((Date.now() - startedAt) / 1000)));
    tick();
    const id = window.setInterval(tick, 250);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [startedAt]);

  const toggle = useCallback(() => {
    if (startedAt === null) {
      setStartedAt(Date.now());
      return;
    }
    setBanked((b) => b + Math.max(0, Math.round((Date.now() - startedAt) / 1000)));
    setElapsed(0);
    setStartedAt(null);
  }, [startedAt]);

  const today = SEED_TODAY_SECONDS + banked + elapsed;

  const size = 184;
  const stroke = 13;
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const dash = circ * Math.min(1, today / DAY_TARGET_SECONDS);

  return (
    <div className="w-full max-w-[19.5rem] overflow-hidden rounded-2xl border border-border bg-surface shadow-[var(--shadow-lift)]">
      {/* Window chrome — this is a crop of the desktop app, and reads as one. */}
      <div className="flex items-center gap-2 border-b border-border bg-canvas px-3.5 py-2.5">
        <span className="flex gap-1.5" aria-hidden>
          <span className="h-2 w-2 rounded-full bg-border-strong" />
          <span className="h-2 w-2 rounded-full bg-border-strong" />
          <span className="h-2 w-2 rounded-full bg-border-strong" />
        </span>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/icon-badge.svg" alt="" width={15} height={15} className="ml-1 h-[15px] w-[15px]" />
        <span className="text-[10px] font-medium text-muted">TraxStaff &mdash; Tracker</span>
        <span className="ml-auto rounded-full border border-border bg-surface px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-faint">
          Live demo
        </span>
      </div>

      {/* The panel is cropped against the viewport, not a fixed height: the
          whole hero has to land on one screen, and how much of the tracker
          fits before the headline is what gives. A tall phone gets the ring,
          the totals and a project row; a short one crops into the totals. The
          fade sits on this box, so it's always at the cut. */}
      <div className="relative max-h-[34vh] overflow-hidden px-4 pb-2 pt-3">
        {/* One control, sized to the whole ring: on a phone the tap target is
            the panel's centre, not a 44px circle inside it. */}
        <button
          type="button"
          onClick={toggle}
          aria-label={running ? "Stop the demo timer" : "Start the demo timer"}
          className="group flex w-full cursor-pointer flex-col items-center rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-brand/60"
        >
          <span className="relative grid h-[8.5rem] w-[8.5rem] place-items-center">
            <svg viewBox={`0 0 ${size} ${size}`} className="h-full w-full" aria-hidden>
              <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0" stopColor="var(--color-brand-600)" />
                  <stop offset="1" stopColor="var(--color-brand)" />
                </linearGradient>
              </defs>
              <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-border)" strokeWidth={stroke} />
              <circle
                cx={size / 2}
                cy={size / 2}
                r={r}
                fill="none"
                stroke={`url(#${gradientId})`}
                strokeWidth={stroke}
                strokeLinecap="round"
                strokeDasharray={`${dash} ${circ}`}
                transform={`rotate(-90 ${size / 2} ${size / 2})`}
                style={reduce ? undefined : { transition: "stroke-dasharray 0.9s cubic-bezier(0.22,1,0.36,1)" }}
              />
            </svg>

            <span className="absolute inset-0 flex flex-col items-center justify-center">
              <span
                className={`inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide ${
                  running ? "text-positive" : "text-muted"
                }`}
              >
                <span className={`h-[6px] w-[6px] rounded-full ${running ? "bg-positive" : "bg-faint"}`} />
                {running ? "Tracking" : "Not tracking"}
              </span>

              <span className="mk-clock-brand mt-1 font-heading text-[1.55rem] font-bold leading-none tabular-nums tracking-tight">
                {clock(today)}
              </span>

              <span className="relative mt-2.5 grid place-items-center">
                {/* The nudge: while it's idle the button breathes, so the
                    thing to tap is the thing that's moving. */}
                {!running && !reduce && (
                  <motion.span
                    aria-hidden
                    className="absolute h-10 w-10 rounded-full bg-brand"
                    animate={{ scale: [1, 1.55], opacity: [0.35, 0] }}
                    transition={{ duration: 1.8, repeat: Infinity, ease: "easeOut" }}
                  />
                )}
                <span
                  className={`grid h-10 w-10 place-items-center rounded-full text-white transition group-active:scale-95 ${
                    running ? "bg-accent" : "bg-brand"
                  }`}
                  style={{
                    boxShadow: `0 6px 16px -6px color-mix(in srgb, var(--color-${running ? "accent" : "brand"}) 55%, transparent)`,
                  }}
                >
                  {running ? (
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
                      <rect x="3.5" y="3.5" width="9" height="9" rx="1.6" />
                    </svg>
                  ) : (
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
                      <path d="M5 3.5v9l7.5-4.5z" />
                    </svg>
                  )}
                </span>
              </span>
            </span>
          </span>

          <span
            className={`mt-3 inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-xs font-semibold transition ${
              running
                ? "border-transparent bg-positive/12 text-positive"
                : "border-brand/35 bg-brand/[0.07] text-brand"
            }`}
          >
            {running ? "Tracking — tap to stop" : "Tap to start the timer"}
          </span>
        </button>

        <div className="mt-4 grid grid-cols-2 gap-3 border-b border-border pb-3">
          <span className="flex flex-col">
            <span className="text-[11px] text-muted">This week</span>
            <span className="mk-clock font-heading text-base font-bold tabular-nums">
              {clock(WEEK_SECONDS + banked + elapsed)}
            </span>
          </span>
          <span className="flex flex-col">
            <span className="text-[11px] text-muted">Tracked today</span>
            <span className="mk-clock font-heading text-base font-bold tabular-nums">{clock(today)}</span>
          </span>
        </div>

        {/* The list is where the panel gets cut. One row is enough to say
            "time lands on a project"; past that it's height the rest of the
            hero needs on a phone, so the crop starts on the first row and the
            frame ends a row and a half in. */}
        <ul className="mt-2 max-h-[3.5rem] overflow-hidden">
          {PROJECTS.map((p, i) => {
            const live = running && i === 0;
            return (
              <li
                key={p.name}
                className={`flex items-center gap-2.5 rounded-lg px-2 py-1.5 ${live ? "bg-brand/10" : ""}`}
              >
                <span
                  className={`grid h-[22px] w-[22px] shrink-0 place-items-center rounded-full border ${
                    live ? "border-accent bg-accent text-white" : "border-border bg-surface text-brand"
                  }`}
                >
                  {live ? (
                    <svg width="8" height="8" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
                      <rect x="3.5" y="3.5" width="9" height="9" rx="1.6" />
                    </svg>
                  ) : (
                    <svg width="9" height="9" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
                      <path d="M5 3.5v9l7.5-4.5z" />
                    </svg>
                  )}
                </span>
                <span className={`flex-1 truncate text-[13px] ${live ? "font-semibold text-brand" : "font-medium text-ink"}`}>
                  {p.name}
                </span>
                <span className={`text-[11px] tabular-nums ${live ? "font-semibold text-brand" : "text-muted"}`}>
                  {live ? clock(p.seconds + elapsed) : short(p.seconds)}
                </span>
              </li>
            );
          })}
        </ul>

        {/* The crop: the panel keeps going past the bottom of the frame. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-surface via-surface/90 to-transparent"
        />
      </div>
    </div>
  );
}
