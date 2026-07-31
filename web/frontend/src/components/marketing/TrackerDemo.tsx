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
  /* Thinner than it was (13). The ring has to hold a label, a clock and a button
     inside it without any of them touching the stroke, and every unit taken off
     the stroke is a unit of usable inner radius. */
  const stroke = 10.5;
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const dash = circ * Math.min(1, today / DAY_TARGET_SECONDS);

  return (
    <div className="w-full max-w-[21.5rem] overflow-hidden rounded-2xl border border-border bg-surface shadow-[var(--shadow-lift)]">
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

      {/* The crop used to sit on this whole box, which meant a short screen cut
          into the ring and swallowed the "Tap to start the timer" pill — the one
          thing on the panel telling you it does anything. Now the control (ring
          + pill) is never cropped at any height, and only the totals-and-projects
          tail below it gives way. See the tail's own wrapper. */}
      <div className="px-4 pb-2 pt-3">
        {/* One control, sized to the whole ring: on a phone the tap target is
            the panel's centre, not a 44px circle inside it. */}
        <button
          type="button"
          onClick={toggle}
          aria-label={running ? "Stop the demo timer" : "Start the demo timer"}
          className="group flex w-full cursor-pointer flex-col items-center rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-brand/60"
        >
          {/* Scales with the viewport instead of sitting at a fixed 8.5rem, so a
              320px phone gets a ring that fits its width and a 430px one gets the
              full size. */}
          <span className="relative grid h-[clamp(6.25rem,30vw,8.75rem)] w-[clamp(6.25rem,30vw,8.75rem)] place-items-center">
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

            {/* Inset rather than `inset-0`. Filling the whole ring box put the
                label and the clock hard against the stroke, so they read as
                overlapping it. 14% clears the stroke and leaves a margin inside
                the arc at every size the clamp above produces. */}
            <span className="absolute inset-[14%] flex flex-col items-center justify-center">
              <span
                className={`inline-flex items-center gap-1.5 text-[clamp(8px,2.4vw,10px)] font-semibold uppercase tracking-wide ${
                  running ? "text-positive" : "text-muted"
                }`}
              >
                <span className={`h-[5px] w-[5px] shrink-0 rounded-full ${running ? "bg-positive" : "bg-faint"}`} />
                {running ? "Tracking" : "Not tracking"}
              </span>

              {/* Scales with the ring — a fixed 1.55rem clock overflowed the arc
                  once the ring shrank on a narrow phone. */}
              <span className="mk-clock-brand mt-1 font-heading text-[clamp(1.1rem,5.1vw,1.5rem)] font-bold leading-none tabular-nums tracking-tight">
                {clock(today)}
              </span>

              <span className="relative mt-2 grid place-items-center">
                {/* The nudge: while it's idle the button breathes, so the
                    thing to tap is the thing that's moving. */}
                {!running && !reduce && (
                  <motion.span
                    aria-hidden
                    className="absolute h-9 w-9 rounded-full bg-brand"
                    animate={{ scale: [1, 1.55], opacity: [0.35, 0] }}
                    transition={{ duration: 1.8, repeat: Infinity, ease: "easeOut" }}
                  />
                )}
                <span
                  className={`grid h-9 w-9 place-items-center rounded-full text-white transition group-active:scale-95 ${
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

          {/* Bumps while idle, still once running. The pulse behind the play
              button says "something here is live"; this says "and it's you that
              has to do it" — two different jobs, so both stay. Movement stops
              under prefers-reduced-motion, where the border and tint carry it. */}
          <motion.span
            className={`mt-3 inline-flex max-w-full items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-[clamp(11px,3vw,12px)] font-semibold transition ${
              running
                ? "border-transparent bg-positive/12 text-positive"
                : "border-brand/35 bg-brand/[0.07] text-brand"
            }`}
            animate={running || reduce ? { y: 0 } : { y: [0, -4, 0] }}
            transition={
              running || reduce
                ? { duration: 0.2 }
                : { duration: 1.5, repeat: Infinity, ease: "easeInOut", repeatDelay: 0.35 }
            }
          >
            {running ? "Tracking — tap to stop" : "Tap to start the timer"}
          </motion.span>
        </button>

        {/* The tail: totals and the project list. This is the only part that
            gives way, and it's the right part to — it's context, where the ring
            above it is the thing you interact with.

            Cropped by viewport height, and dropped entirely below 720px, which is
            what keeps the whole hero on one screen on a short phone. A 375x667
            screen shows chrome + ring + pill and nothing else; a 375x812 gets the
            totals and a project row under it. */}
        <div className="relative mt-3.5 max-h-[clamp(2.75rem,9vh,6.5rem)] overflow-hidden [@media(max-height:720px)]:hidden">
        <div className="grid grid-cols-2 gap-3 border-b border-border pb-3">
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

        <ul className="mt-2">
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

          {/* The crop: the panel keeps going past the bottom of the frame. Sits
              on the tail's box, so it's always exactly at the cut. */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-surface via-surface/90 to-transparent"
          />
        </div>
      </div>
    </div>
  );
}
