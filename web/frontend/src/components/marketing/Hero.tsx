"use client";

import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { useMotionPresets } from "@/lib/motion";
import { Mark } from "./Mark";
import { TrackerDemo } from "./TrackerDemo";
import { PlatformRail } from "./PlatformStrip";
import { HeroGridMotion } from "./HeroGridMotion";
import { APP_URL } from "@/lib/site";
import {
  IconClock,
  IconAndroid,
  IconWindows,
  IconLinux,
  IconArrowRight,
  IconDownload,
} from "@/components/icons";

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
      <div className="mt-1 font-heading text-xl font-bold leading-none tracking-[-0.02em] text-ink tabular-nums">
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
      <span className="font-heading text-sm font-bold leading-none tracking-[-0.02em] text-ink tabular-nums">
        {formatElapsed(offset + elapsed)}
      </span>
    </div>
  );
}

export function Hero() {
  const { revealStagger, revealItem, reduce, press } = useMotionPresets();
  const elapsed = useElapsed();

  /* Floating objects live in the margins beside the headline column, the way
     the reference scatters its illustrations. That needs roughly 1280px before
     they stop colliding with the type, so below `xl` they're dropped and the
     single centred card below the buttons carries the live timer instead —
     every width still shows one running clock. */
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
      className: "left-2 top-[16%]",
      float: -16,
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
      className: "right-2 top-[24%]",
      float: 15,
    },
    {
      key: "focus",
      node: <TimerPill label="Focus" elapsed={elapsed} offset={72 * 60 + 9} className="-rotate-2" />,
      className: "left-[6%] top-[64%]",
      float: 13,
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
      className: "right-[4%] top-[62%]",
      float: -14,
    },
  ];

  /* The hero is one full screen (`min-height: 100svh`, set on `.mk-hero`) and
     is pulled up by the height of the sticky header so its background runs
     behind the bar — that's what lets the header sit on the hero with no fill
     of its own and no seam. The padding below puts the content back under it.

     Everything from here down is sized so the whole composition lands inside
     that screen at any height: the column centres itself in whatever is left
     after the platform rail, and each vertical gap is a `clamp()` on `vh` so
     the rhythm compresses on a short viewport instead of pushing the rail off
     the bottom. */
  return (
    <section
      id="top"
      className="mk-hero relative mt-[calc(var(--mk-nav-h)*-1)] overflow-hidden"
    >
      {/* Background only — masked out of the middle of the stage so it never
          sits behind the headline, and behind the ruled lines and the vignette
          in the paint order. */}
      <HeroGridMotion />

      <div className="relative mx-auto flex w-full max-w-7xl flex-1 flex-col justify-center px-5 pb-[clamp(0.75rem,2.5vh,2rem)] pt-[calc(var(--mk-nav-h)+clamp(0.5rem,2vh,1.75rem))] text-center sm:px-8">
        {floaters.map((f) => (
          <motion.div
            key={f.key}
            aria-hidden
            className={`pointer-events-none absolute hidden xl:block ${f.className}`}
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
                      duration: 5.5 + Math.abs(f.float) * 0.12,
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

        <motion.div {...revealStagger()} className="relative z-10">
          {/* Phones only, and a working panel rather than a picture of one —
              tapping it starts the clock. Everything from `sm` up is the
              layout as it was: tablets keep the live card below the buttons,
              and wide screens have the floating platform cards for this. */}
          <motion.div
            {...revealItem}
            className="mb-[clamp(0.625rem,2.2vh,1.5rem)] flex justify-center sm:hidden"
          >
            <TrackerDemo />
          </motion.div>

          {/* The eyebrow is the first thing that can go: it's ~60px of the
              screen for a line the headline underneath already implies, and
              seeing the whole hero at a glance matters more than it does.
              Height, not width — the hero has to fit on a 1024×600 laptop for
              the same reason it has to fit on a 375×667 phone, so this is a
              plain height query rather than the phone-only one it used to be.
              A 375×812 phone and anything on a normal desktop keep it.

              Glass rather than the solid navy `bg-field` it used to be: the
              stage is dark in both themes now (see `.mk-hero` in globals.css),
              and a navy pill on that wash reads as a smudge rather than a
              chip. */}
          <motion.span
            {...revealItem}
            className="inline-flex items-center gap-2 rounded-full bg-white/10 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-white shadow-[var(--shadow-lift)] ring-1 ring-white/15 [@media(max-height:700px)]:hidden"
          >
            <IconClock width={13} height={13} className="text-accent" />
            Never covert, by design
          </motion.span>

          <motion.h1
            {...revealItem}
            className="mx-auto mt-[clamp(1rem,2.6vh,2.25rem)] max-w-[52rem] font-heading text-[clamp(1.8rem,5.2vw,4rem)] font-bold leading-[1.06] tracking-[-0.04em] text-white"
          >
            {/* Broken here rather than at "team" so the two lines come out
                near-equal; the sizing above keeps each on one line right down
                to the point the break is dropped on small screens.

                The clamp's floor is what holds a phone to two lines rather
                than three: "actually see" can't be split (`.mk-mark` is
                nowrap), so the type has to be small enough for "team can
                actually see" to sit on one line at 360px. Nothing at or above
                `sm` is affected — 5.2vw passes the floor well before then. */}
            Time tracking your
            <br className="hidden sm:block" /> team can{" "}
            <Mark>actually see</Mark>
          </motion.h1>

          <motion.p
            {...revealItem}
            className="mx-auto mt-[clamp(0.75rem,2.2vh,1.75rem)] max-w-xl text-base leading-relaxed text-white/85 sm:text-lg"
          >
            {/* Two lengths, one at a time — `hidden` keeps the other out of the
                accessibility tree as well as off the screen. The phone gets the
                claim without the mechanism; the mechanism is spelled out in
                full three sections down, under Transparency. */}
            <span className="sm:hidden">
              A visible, always-on indicator the whole time it runs &mdash;
              tamper-evident, never self-reported.
            </span>
            <span className="hidden sm:inline">
              A visible, always-on indicator the whole time it runs. Every session
              hash-chained and capped against the server&rsquo;s clock &mdash;
              tamper-evident, never self-reported.
            </span>
          </motion.p>

          {/* Two columns on a phone rather than two stacked full-width pills.
              Stacking cost ~60px of a screen the hero now has to fit inside,
              and a grid keeps the one thing the stack was protecting: both
              buttons are still exactly the same width, so neither reads as the
              lesser of the two. The short label on the second one is the same
              trick the paragraph above uses. */}
          <motion.div
            {...revealItem}
            className="mt-[clamp(1.25rem,3.2vh,2.5rem)] grid grid-cols-2 gap-3 sm:flex sm:flex-row sm:items-center sm:justify-center"
          >
            <motion.a
              {...press}
              href={`${APP_URL}/app`}
              className="mk-cta cursor-target flex items-center justify-center gap-2 rounded-full bg-accent px-5 py-3.5 text-sm font-bold transition-colors hover:brightness-105 sm:px-8"
            >
              Start free
              <IconArrowRight width={16} height={16} />
            </motion.a>
            <motion.a
              {...press}
              href="#download"
              className="cursor-target flex items-center justify-center gap-2 rounded-full border border-border-strong bg-surface px-5 py-3.5 text-sm font-semibold text-ink transition-colors hover:border-muted sm:px-8"
            >
              <IconDownload width={16} height={16} />
              <span className="sm:hidden">Download</span>
              <span className="hidden sm:inline">Download the app</span>
            </motion.a>
          </motion.div>

          {/* Stand-in for the floating cards below xl, and the only timer on
              the page showing genuinely real elapsed time. The `mk-hero-live-*`
              classes are what compress it on a short viewport and drop it on a
              very short one — see globals.css. */}
          <motion.div
            {...revealItem}
            className="mk-hero-live-wrap mt-[clamp(1rem,3vh,3.5rem)] hidden justify-center sm:flex xl:hidden"
          >
            <div className="mk-hero-live w-full max-w-sm rounded-2xl border border-border bg-surface p-5 text-left shadow-[var(--shadow-lift)]">
              <div className="flex items-center gap-2">
                <span className="mk-live-dot" />
                <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-positive">
                  Tracking &middot; visible
                </span>
              </div>
              {/* Sized to sit inside the card rather than run at its edges. This
                  card only ever shows below `xl`, so the size is a phone and
                  tablet concern — the desktop hero's own clocks are untouched. */}
              <div className="mk-hero-live-clock mk-clock mt-3 font-heading text-[1.875rem] font-bold leading-none tracking-[-0.03em] tabular-nums sm:text-[2.125rem]">
                {formatElapsed(elapsed)}
              </div>
              <p className="mk-hero-live-note mt-3 text-sm leading-relaxed text-muted">
                How long this page has been open. You could see it counting the
                whole time &mdash; that&rsquo;s the entire product.
              </p>
            </div>
          </motion.div>
        </motion.div>
      </div>

      {/* Part of the hero, on the bottom edge of the screen it fills. */}
      <PlatformRail />
    </section>
  );
}
