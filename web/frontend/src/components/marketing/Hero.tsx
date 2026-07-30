"use client";

import { motion } from "motion/react";
import { useMotionPresets } from "@/lib/motion";
import { APP_URL } from "@/lib/site";

/**
 * A schematic illustration of the always-visible tracking indicator + a
 * running timer, built from the app's own category colors — not a screenshot
 * of the dashboard (none is embedded here), just a small visual anchor for
 * the "you can always see it's on" claim made in the copy beside it.
 */
function TrackingIllustration() {
  const categories = [
    { label: "Focus", color: "var(--color-cat-focus)", width: "58%" },
    { label: "Meeting", color: "var(--color-cat-meeting)", width: "22%" },
    { label: "Other", color: "var(--color-cat-other)", width: "12%" },
    { label: "Break", color: "var(--color-cat-break)", width: "8%" },
  ];

  return (
    <div className="relative w-full max-w-sm rounded-2xl border border-border bg-surface p-6 shadow-[var(--shadow-lift)]">
      <div className="flex items-center justify-between">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--color-positive)]/12 px-2.5 py-1 text-xs font-semibold text-[var(--color-positive)]">
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-positive)]" />
          Tracking &mdash; visible
        </span>
        <span className="text-xs text-faint">Session</span>
      </div>

      <div className="mt-5 font-heading text-4xl font-bold tabular-nums tracking-tight text-ink">
        02:41:18
      </div>
      <p className="mt-1 text-xs text-muted">Credited against the server clock, not the local one.</p>

      <div className="mt-5 flex h-2.5 w-full overflow-hidden rounded-full bg-canvas">
        {categories.map((c) => (
          <span key={c.label} style={{ width: c.width, background: c.color }} />
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
        {categories.map((c) => (
          <span key={c.label} className="flex items-center gap-1.5 text-[11px] text-muted">
            <span className="h-2 w-2 rounded-full" style={{ background: c.color }} />
            {c.label}
          </span>
        ))}
      </div>
    </div>
  );
}

export function Hero() {
  const { stagger, item } = useMotionPresets();

  return (
    <section id="top" className="relative overflow-hidden">
      <div
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background:
            "radial-gradient(70% 60% at 50% -10%, color-mix(in srgb, var(--color-brand) 14%, transparent) 0%, transparent 60%)",
        }}
      />
      <div className="mx-auto grid max-w-6xl gap-12 px-5 pb-16 pt-14 sm:px-8 sm:pt-20 lg:grid-cols-2 lg:items-center lg:pb-24 lg:pt-24">
        <motion.div {...stagger()}>
          <motion.span
            {...item}
            className="inline-flex items-center gap-1.5 rounded-full border border-border bg-canvas px-3 py-1 text-xs font-medium text-muted"
          >
            Windows &middot; Linux &middot; Android
          </motion.span>

          <motion.h1
            {...item}
            className="mt-5 max-w-xl font-heading text-[2.5rem] font-bold leading-[1.08] tracking-tight text-ink sm:text-5xl"
          >
            Time tracking your team can actually see.
          </motion.h1>

          <motion.p {...item} className="mt-5 max-w-lg text-base text-muted sm:text-lg">
            TraxStaff tracks work time on desktop and mobile with a visible, always-on
            indicator &mdash; never hidden, never running quietly in the
            background. Every session is hashed and capped against the
            server&rsquo;s clock, so the record is tamper-evident, not just
            self-reported.
          </motion.p>

          <motion.div {...item} className="mt-8 flex flex-wrap items-center gap-3">
            <a
              href={`${APP_URL}/app`}
              className="rounded-lg bg-brand px-6 py-3 text-sm font-semibold text-brand-fg transition hover:bg-brand-600"
            >
              Get Started
            </a>
            <a
              href="#download"
              className="rounded-lg border border-border px-6 py-3 text-sm font-semibold text-ink transition hover:bg-canvas"
            >
              Download the app
            </a>
          </motion.div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.1 }}
          className="flex justify-center lg:justify-end"
        >
          <TrackingIllustration />
        </motion.div>
      </div>
    </section>
  );
}
