"use client";

import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { useMotionPresets } from "@/lib/motion";
import { Mark } from "./Mark";
import { APP_URL } from "@/lib/site";
import { IconClock, IconAndroid, IconWindows, IconLinux } from "@/components/icons";

/**
 * Seconds since this component mounted. Real elapsed time, not a scripted
 * animation — the point of the hero is that the number you're looking at is
 * the honest one.
 *
 * Starts at 0 on both server and client so the first paint matches, then
 * ticks once mounted. It keeps ticking under `prefers-reduced-motion`: a
 * running clock is the content here, not decoration. Only the pulsing dot
 * beside it (`.mk-live-dot`, see globals.css) stops.
 */
function useElapsed() {
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    const start = Date.now();
    const id = setInterval(() => setSeconds(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(id);
  }, []);

  return seconds;
}

function formatElapsed(total: number) {
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return [h, m, s].map((n) => String(n).padStart(2, "0")).join(":");
}

/**
 * The tracking indicator as it appears on each platform that ships today.
 *
 * Each card counts from its own offset while advancing off the single
 * page-level tick, so they read as separate machines all running live rather
 * than as copies of one number — but their seconds stay in step. Offsets are
 * part of the illustration; the centred card below the buttons is the one
 * showing real time, and it says so.
 */
function TimerCard({
  icon,
  surface,
  elapsed,
  offset,
  className,
}: {
  icon: React.ReactNode;
  surface: string;
  elapsed: number;
  offset: number;
  className?: string;
}) {
  return (
    <div
      className={`w-52 rounded-2xl border border-border bg-surface p-4 shadow-[var(--shadow-lift)] ${className ?? ""}`}
    >
      <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-faint">
        <span className="text-muted">{icon}</span>
        {surface}
      </div>
      <div className="mt-2.5 flex items-center gap-2">
        <span className="mk-live-dot" />
        <span className="text-xs font-semibold text-ink">Tracking</span>
      </div>
      <div className="mk-clock mt-1 font-heading text-xl font-bold leading-none tracking-[-0.02em] tabular-nums">
        {formatElapsed(offset + elapsed)}
      </div>
    </div>
  );
}

/** The same indicator at its smallest — how it sits in a menu bar. */
function TimerPill({
  label,
  elapsed,
  offset,
  className,
}: {
  label: string;
  elapsed: number;
  offset: number;
  className?: string;
}) {
  return (
    <div
      className={`flex items-center gap-2.5 rounded-full border border-border bg-surface py-2.5 pl-3.5 pr-4 shadow-[var(--shadow-lift)] ${className ?? ""}`}
    >
      <span className="mk-live-dot" />
      <span className="text-[11px] font-semibold text-muted">{label}</span>
      <span className="mk-clock font-heading text-sm font-bold leading-none tracking-[-0.02em] tabular-nums">
        {formatElapsed(offset + elapsed)}
      </span>
    </div>
  );
}

export function Hero() {
  const { revealStagger, revealItem, reduce, press } = useMotionPresets();
  const elapsed = useElapsed();

  /* The platform cards cluster around the tracking panel rather than out in
     the page margins, now that the panel has a column of its own — the same
     scattered-objects idea, gathered around the thing they're about. They are
     placed clear of the panel rather than over it: a card with its own clock
     half-covered reads as a mistake, not as depth. The two beside the panel
     need the width `xl` gives; below that only the pair above and below it
     show, and under `lg` none do — the panel drops back under the copy and
     carries the live clock alone, exactly as designed. */
  const floaters = [
    {
      key: "windows",
      node: (
        <TimerCard
          icon={<IconWindows width={13} height={13} />}
          surface="Windows tray"
          elapsed={elapsed}
          offset={2 * 3600 + 41 * 60 + 18}
          className="-rotate-3"
        />
      ),
      className: "-top-[6.75rem] left-0 hidden lg:block",
      float: -8,
    },
    {
      key: "android",
      node: (
        <TimerCard
          icon={<IconAndroid width={13} height={13} />}
          surface="Android"
          elapsed={elapsed}
          offset={47 * 60 + 6}
          className="rotate-3"
        />
      ),
      className: "bottom-2 right-0 hidden xl:block",
      float: 8,
    },
    {
      key: "focus",
      node: <TimerPill label="Focus" elapsed={elapsed} offset={72 * 60 + 9} className="-rotate-2" />,
      className: "-bottom-[3.25rem] left-10 hidden lg:block",
      float: 7,
    },
    {
      key: "linux",
      node: (
        <TimerCard
          icon={<IconLinux width={13} height={13} />}
          surface="Linux tray"
          elapsed={elapsed}
          offset={5 * 3600 + 3 * 60 + 51}
          className="rotate-2"
        />
      ),
      className: "right-0 top-0 hidden xl:block",
      float: -7,
    },
  ];

  /* The live panel. One markup, two positions: under the copy on a phone,
     beside it in its own column from `lg`. */
  const panel = (
    <div className="w-full max-w-sm rounded-2xl border border-border bg-surface p-5 text-left shadow-[var(--shadow-lift)] lg:max-w-[19rem] lg:p-6 xl:max-w-[20rem]">
      <div className="flex items-center gap-2">
        <span className="mk-live-dot" />
        <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-positive">
          Tracking &middot; visible
        </span>
      </div>
      {/* Sized to sit inside the card rather than run at its edges — the
          clock is the loudest thing here without also being the widest. */}
      <div className="mk-clock mt-3 font-heading text-[2rem] font-bold leading-none tracking-[-0.03em] tabular-nums sm:text-[2.25rem]">
        {formatElapsed(elapsed)}
      </div>
      <p className="mt-3 text-sm leading-relaxed text-muted">
        How long this page has been open. You could see it counting the whole
        time &mdash; that&rsquo;s the entire product.
      </p>
    </div>
  );

  return (
    <section id="top" className="mk-hero relative overflow-hidden">
      <div className="relative mx-auto max-w-7xl px-5 pb-24 pt-16 sm:px-8 sm:pt-24 lg:pb-32">
        {/* Stacked on a phone — copy, then the panel, exactly as before. Split
            into panel-left / copy-right once there's room for two columns. */}
        <div className="grid items-center gap-14 lg:grid-cols-2 lg:gap-12 xl:gap-20">
          <motion.div
            {...revealStagger()}
            className="relative order-2 flex w-full justify-center lg:order-1 lg:justify-start lg:pl-8 xl:pl-10"
          >
            {/* Holds the panel and everything floating around it, so the cards
                are placed against this box rather than the page. */}
            <div className="relative w-full max-w-sm lg:max-w-none">
            {floaters.map((f) => (
              <motion.div
                key={f.key}
                aria-hidden
                className={`pointer-events-none absolute z-0 ${f.className}`}
                initial={{ opacity: 0, y: 16, scale: 0.96 }}
                animate={
                  reduce
                    ? { opacity: 1, y: 0, scale: 1 }
                    : { opacity: 1, y: [0, f.float, 0], scale: 1 }
                }
                transition={
                  reduce
                    ? { duration: 0 }
                    : {
                        opacity: { duration: 0.5, delay: 0.35 },
                        scale: { duration: 0.5, delay: 0.35 },
                        y: {
                          duration: 7 + Math.abs(f.float) * 0.2,
                          repeat: Infinity,
                          ease: "easeInOut",
                          delay: 0.35,
                        },
                      }
                }
              >
                {f.node}
              </motion.div>
            ))}

              <motion.div {...revealItem} className="relative z-10 flex w-full justify-center lg:justify-start">
                {panel}
              </motion.div>
            </div>
          </motion.div>

          <motion.div {...revealStagger()} className="relative z-10 order-1 text-center lg:order-2 lg:text-left">
            <motion.span
              {...revealItem}
              className="inline-flex items-center gap-2 rounded-full bg-field px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-white shadow-[var(--shadow-lift)] ring-1 ring-white/15"
            >
              <IconClock width={13} height={13} className="text-accent" />
              Never covert, by design
            </motion.span>

            <motion.h1
              {...revealItem}
              className="mx-auto mt-8 max-w-[52rem] font-heading text-[clamp(2.25rem,5.2vw,4rem)] font-bold leading-[1.06] tracking-[-0.04em] text-ink lg:mx-0 lg:text-[clamp(2.5rem,3.6vw,3.5rem)]"
            >
              {/* Broken here rather than at "team" so the two lines come out
                  near-equal; the sizing above keeps each on one line right down
                  to the point the break is dropped on small screens. */}
              Time tracking your
              <br className="hidden sm:block" /> team can{" "}
              <Mark>actually see</Mark>
            </motion.h1>

            <motion.p
              {...revealItem}
              className="mx-auto mt-7 max-w-xl text-base leading-relaxed text-muted sm:text-lg lg:mx-0"
            >
              A visible, always-on indicator the whole time it runs. Every session
              hash-chained and capped against the server&rsquo;s clock &mdash;
              tamper-evident, never self-reported.
            </motion.p>

            <motion.div
              {...revealItem}
              className="mt-10 flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center lg:justify-start"
            >
              <motion.a
                {...press}
                href={`${APP_URL}/app`}
                className="cursor-target rounded-full bg-accent px-8 py-4 text-sm font-bold text-field transition-colors hover:brightness-105 sm:py-3.5"
              >
                Start free
              </motion.a>
              <motion.a
                {...press}
                href="#download"
                className="cursor-target rounded-full border border-border-strong bg-surface px-8 py-4 text-sm font-semibold text-ink transition-colors hover:border-muted sm:py-3.5"
              >
                Download the app
              </motion.a>
            </motion.div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
