"use client";

import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { useMotionPresets } from "@/lib/motion";
import { APP_URL } from "@/lib/site";
import { IconClock, IconAndroid, IconWindows } from "@/components/icons";

/**
 * Seconds since this component mounted. Real elapsed time, not a scripted
 * animation — the hero's whole point is that the number you're looking at is
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
 * The signature. Instead of describing the always-visible indicator, the page
 * runs one on itself: the same timer, the same live dot, counting the time
 * you've actually spent here. Every claim it makes about itself is true.
 */
function LiveRibbon({ elapsed }: { elapsed: number }) {
  return (
    <div className="mx-auto w-full max-w-xl rounded-2xl border border-border bg-surface p-5 text-left shadow-[var(--shadow-lift)] sm:p-6">
      <div className="flex items-center gap-2">
        <span className="mk-live-dot" />
        <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-accent">
          Tracking &middot; visible
        </span>
      </div>

      <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-baseline sm:gap-5">
        {/* Plain text, deliberately: no aria-live, so a screen reader reads the
            value once with the caption rather than re-announcing it every
            second. The caption below says what the number is. */}
        <span className="font-heading text-[2.75rem] font-bold leading-none tracking-[-0.03em] text-ink tabular-nums">
          {formatElapsed(elapsed)}
        </span>
        <p className="text-sm leading-relaxed text-muted">
          How long this page has been open. You could see it counting the whole
          time &mdash; that&rsquo;s the entire product.
        </p>
      </div>
    </div>
  );
}

/**
 * The tracking indicator as it appears on each platform that ships today.
 * Same timer, three surfaces — the visual argument for "you can always see
 * it's on", made without a screenshot of anyone's real work.
 */
function PlatformChip({
  icon,
  surface,
  title,
  elapsed,
  className,
}: {
  icon: React.ReactNode;
  surface: string;
  title: string;
  elapsed: number;
  className: string;
}) {
  return (
    <div
      aria-hidden
      className={`pointer-events-none absolute hidden w-52 rounded-2xl border border-border bg-surface p-3.5 shadow-[var(--shadow-lift)] lg:block ${className}`}
    >
      <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-faint">
        <span className="text-muted">{icon}</span>
        {surface}
      </div>
      <div className="mt-2.5 flex items-center gap-2">
        <span className="mk-live-dot" />
        <span className="text-xs font-semibold text-ink">{title}</span>
      </div>
      <div className="mt-1 font-heading text-lg font-bold leading-none tracking-[-0.02em] text-ink tabular-nums">
        {formatElapsed(elapsed)}
      </div>
    </div>
  );
}

export function Hero() {
  const { stagger, item } = useMotionPresets();
  const elapsed = useElapsed();

  return (
    <section id="top" className="mk-grid relative overflow-hidden">
      <div
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background:
            "radial-gradient(65% 55% at 50% -8%, color-mix(in srgb, var(--color-brand) 13%, transparent) 0%, transparent 62%)",
        }}
      />

      <div className="relative mx-auto max-w-6xl px-5 pb-20 pt-12 text-center sm:px-8 sm:pt-16 lg:pb-28">
        {/* Positioned to flank the subhead and buttons, where the centered
            column is at its narrowest — never the headline. */}
        <PlatformChip
          icon={<IconWindows width={13} height={13} />}
          surface="Desktop tray"
          title="Tracking"
          elapsed={elapsed}
          className="left-0 top-[43%] -rotate-3 xl:-left-6"
        />
        <PlatformChip
          icon={<IconAndroid width={13} height={13} />}
          surface="Android notification"
          title="Tracking"
          elapsed={elapsed}
          className="right-0 top-[55%] rotate-3 xl:-right-6"
        />

        <motion.div {...stagger()}>
          <motion.span
            {...item}
            className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3.5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted shadow-[var(--shadow-soft)]"
          >
            <IconClock width={13} height={13} className="text-accent" />
            Never covert, by design
          </motion.span>

          <motion.h1
            {...item}
            className="mx-auto mt-7 max-w-3xl font-heading text-[clamp(2.5rem,5.6vw,4.25rem)] font-bold leading-[1.04] tracking-[-0.04em] text-ink"
          >
            Time tracking your team can{" "}
            <span className="mk-mark">actually see</span>
          </motion.h1>

          <motion.p
            {...item}
            className="mx-auto mt-6 max-w-xl text-base leading-relaxed text-muted sm:text-lg"
          >
            TraxStaff runs a visible, always-on indicator while it tracks &mdash;
            never hidden, never quiet in the background. Every session is
            hash-chained and capped against the server&rsquo;s clock, so the
            record is tamper-evident, not just self-reported.
          </motion.p>

          <motion.div {...item} className="mt-9 flex flex-wrap items-center justify-center gap-3">
            <a
              href={`${APP_URL}/app`}
              className="rounded-full bg-brand px-7 py-3.5 text-sm font-semibold text-brand-fg transition hover:bg-brand-600"
            >
              Start free
            </a>
            <a
              href="#download"
              className="rounded-full border border-border bg-surface px-7 py-3.5 text-sm font-semibold text-ink transition hover:border-border-strong"
            >
              Download the app
            </a>
          </motion.div>

          <motion.div {...item} className="mt-14">
            <LiveRibbon elapsed={elapsed} />
          </motion.div>
        </motion.div>
      </div>
    </section>
  );
}
