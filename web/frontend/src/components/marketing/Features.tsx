"use client";

import { useCallback, useRef, useState } from "react";
import { motion } from "motion/react";
import { useMotionPresets } from "@/lib/motion";
import { IconUsers, IconTrend, IconChevron } from "@/components/icons";
import { APP_URL } from "@/lib/site";
import { Mark } from "./Mark";

/**
 * Every card maps to a real, shipped surface, and every image is a capture of
 * that surface running — the desktop app's own Timesheets, Activity, Reports
 * and Projects tabs, shot from source with the native layer stubbed and the
 * backend served fixtures. These replaced hand-drawn approximations of the
 * same screens; if the app's UI moves, re-shoot rather than redraw.
 *
 * The one thing inside them that isn't a capture is the screenshot gallery's
 * own thumbnails, which are deliberately abstract placeholders — a marketing
 * page should not carry an image of somebody's actual monitor.
 *
 * The floating badge on each shot states a fact about that screen, not a
 * slogan: each one is checkable in the product.
 */

/** Natural size of each capture, so the frame reserves the right box. */
const SHOTS = {
  timesheets: { src: "/screens/feature-timesheets.webp", h: 1497, seconds: "34s" },
  activity: { src: "/screens/feature-activity.webp", h: 960, seconds: "24s" },
  reports: { src: "/screens/feature-reports.webp", h: 668, seconds: "18s" },
  projects: { src: "/screens/feature-projects.webp", h: 768, seconds: "20s" },
} as const;

/**
 * A whole screen inside a desktop window, scrolling itself.
 *
 * These captures are full pages, not crops — the Timesheets one is 1497px
 * tall — so the window shows a slice and travels the rest. Durations differ
 * per card so four of them on one screen don't move in lockstep.
 */
function Shot({
  shot,
  alt,
  badge,
  badgeClass = "-bottom-3 left-5",
}: {
  shot: keyof typeof SHOTS;
  alt: string;
  badge: string;
  badgeClass?: string;
}) {
  const { src, h, seconds } = SHOTS[shot];

  return (
    <div className="relative">
      <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-[var(--shadow-lift)]">
        <div className="flex items-center gap-2 border-b border-border bg-canvas px-3.5 py-2.5">
          <span className="flex gap-1.5" aria-hidden>
            <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
          </span>
        </div>
        <div
          className="mk-scrollshot"
          style={{ "--mk-shot-duration": seconds } as React.CSSProperties}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt={alt} width={760} height={h} loading="lazy" />
        </div>
      </div>
      <span
        className={`absolute ${badgeClass} rounded-full bg-surface px-3.5 py-1.5 text-[11px] font-semibold tracking-tight text-ink shadow-[var(--shadow-lift)] ring-1 ring-border`}
      >
        {badge}
      </span>
    </div>
  );
}

/**
 * The four screens, one per slide. Same cards as before — the copy, the
 * captures, the badges and the one CTA are unchanged; they are shown one at a
 * time now rather than stacked down the page. `mirrored` puts the capture on
 * the left and the words on the right, alternating slide by slide the way the
 * grid alternated row by row.
 */
type Slide = {
  key: string;
  title: string;
  body: string;
  cta?: { label: string; href: string };
  shot: keyof typeof SHOTS;
  alt: string;
  badge: string;
  badgeClass?: string;
  /** Capture on the left, words on the right. */
  mirrored?: boolean;
};

const slides: Slide[] = [
  {
    key: "timesheets",
    title: "Every hour, accounted for",
    body:
      "Time is tracked against a project and a task as it runs. Timesheets come out organised by day, week and project, with manual entries marked as manual — ready to review, approve or export.",
    cta: { label: "Explore the dashboard", href: `${APP_URL}/app` },
    shot: "timesheets",
    alt: "The Timesheets tab: a week total, then each day broken into project and task rows with durations.",
    badge: "By day, week or project",
  },
  {
    key: "activity",
    title: "Screenshots, not secrets",
    body:
      "Periodic captures at a frequency your org sets, optionally blurred. The person tracked sees their own captures in the same gallery their admin does — nothing is hidden from them.",
    shot: "activity",
    alt: "The Activity tab: worked time and average activity, above a grid of captured screenshots.",
    badge: "Blur is an org setting",
    mirrored: true,
  },
  {
    key: "reports",
    title: "Reports that hold up",
    body:
      "Totals, tracked-versus-manual by day, and a breakdown by project or task over any date range — built on records that can be checked rather than taken on trust.",
    shot: "reports",
    alt: "The Reports tab: total time and activity, a tracked-versus-manual bar chart by day, and time grouped by project.",
    badge: "Any date range",
    badgeClass: "-bottom-3 right-5",
  },
  {
    key: "projects",
    title: "Work organised into projects",
    body:
      "Every project gets a board. Tracked time attaches to a task, so the hours tie back to the thing they were spent on rather than sitting in an undifferentiated pile.",
    shot: "projects",
    alt: "The Projects tab: a board per project with To do, In progress and Done columns.",
    badge: "To do → In progress → Done",
    mirrored: true,
  },
];

/**
 * One card per view, on a scroll-snapping track.
 *
 * A native scroll container rather than a transformed one, so a phone swipes
 * it with the platform's own physics, the arrows and dots are just programmatic
 * scrolls, and it stays keyboard-scrollable and readable with JS off. Nothing
 * auto-advances: there is no timed movement here to have to pause.
 */
function FeatureCarousel() {
  const { reduce, press } = useMotionPresets();
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [index, setIndex] = useState(0);

  const goTo = useCallback(
    (next: number) => {
      const el = trackRef.current;
      if (!el) return;
      const clamped = Math.max(0, Math.min(slides.length - 1, next));
      el.scrollTo({ left: clamped * el.clientWidth, behavior: reduce ? "auto" : "smooth" });
      setIndex(clamped);
    },
    [reduce]
  );

  // Swiping moves the track without going through `goTo`, so the dots follow
  // the scroll position rather than the other way round.
  const onScroll = useCallback(() => {
    const el = trackRef.current;
    if (!el) return;
    setIndex(Math.round(el.scrollLeft / el.clientWidth));
  }, []);

  return (
    <div className="mt-14">
      <div
        ref={trackRef}
        onScroll={onScroll}
        tabIndex={0}
        role="group"
        aria-roledescription="carousel"
        aria-label="Product screens"
        className="mk-carousel flex snap-x snap-mandatory overflow-x-auto overscroll-x-contain"
      >
        {slides.map((s, i) => (
          <div
            key={s.key}
            role="group"
            aria-roledescription="slide"
            aria-label={`${i + 1} of ${slides.length}: ${s.title}`}
            className="w-full shrink-0 snap-center"
          >
            <div className="cursor-target grid h-full gap-8 rounded-3xl border border-border bg-canvas/70 p-7 sm:p-9 lg:grid-cols-2 lg:items-center">
              <div className={s.mirrored ? "lg:order-2" : undefined}>
                <h3 className="font-heading text-2xl font-bold tracking-[-0.03em] text-ink sm:text-[1.75rem]">
                  {s.title}
                </h3>
                <p className="mt-3.5 max-w-md text-sm leading-relaxed text-muted sm:text-base">
                  {s.body}
                </p>
                {s.cta && (
                  <motion.a
                    {...press}
                    href={s.cta.href}
                    className="cursor-target mt-7 block w-full rounded-full bg-brand px-5 py-4 text-center text-sm font-semibold text-brand-fg transition-colors hover:bg-brand-600 sm:inline-block sm:w-auto sm:py-3"
                  >
                    {s.cta.label}
                  </motion.a>
                )}
              </div>
              <div className={s.mirrored ? "lg:order-1" : undefined}>
                <Shot shot={s.shot} alt={s.alt} badge={s.badge} badgeClass={s.badgeClass} />
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-7 flex items-center justify-center gap-5">
        <motion.button
          {...press}
          type="button"
          onClick={() => goTo(index - 1)}
          disabled={index === 0}
          aria-label="Previous screen"
          className="cursor-target flex h-11 w-11 items-center justify-center rounded-full border border-border bg-canvas/70 text-ink transition-colors hover:border-muted disabled:pointer-events-none disabled:opacity-35"
        >
          <IconChevron width={18} height={18} className="rotate-180" />
        </motion.button>

        <div className="flex items-center gap-2">
          {slides.map((s, i) => (
            <button
              key={s.key}
              type="button"
              onClick={() => goTo(i)}
              aria-label={s.title}
              aria-current={i === index}
              className={`h-1.5 rounded-full transition-all ${
                i === index ? "w-7 bg-brand" : "w-1.5 bg-border-strong hover:bg-muted"
              }`}
            />
          ))}
        </div>

        <motion.button
          {...press}
          type="button"
          onClick={() => goTo(index + 1)}
          disabled={index === slides.length - 1}
          aria-label="Next screen"
          className="cursor-target flex h-11 w-11 items-center justify-center rounded-full border border-border bg-canvas/70 text-ink transition-colors hover:border-muted disabled:pointer-events-none disabled:opacity-35"
        >
          <IconChevron width={18} height={18} />
        </motion.button>
      </div>
    </div>
  );
}

/** The two surfaces that live in the web dashboard rather than the tray app. */
const compact = [
  {
    icon: IconUsers,
    title: "Roles",
    body:
      "Owner, admin and member tiers. Staff see their own data; org-wide views are an explicit opt-in, and admin-only.",
  },
  {
    icon: IconTrend,
    title: "Insights",
    body:
      "Trends across people, projects and categories over any range — not a single day's snapshot.",
  },
];

export function Features() {
  const { revealStagger, revealItem, reveal, item, reduce } = useMotionPresets();

  return (
    <section id="features" className="bg-surface">
      <div className="mx-auto max-w-6xl px-5 py-24 sm:px-8 lg:py-28">
        <motion.div {...revealStagger()} className="mx-auto max-w-2xl text-center">
          <motion.span
            {...revealItem}
            className="inline-flex items-center gap-2 rounded-full border border-border bg-canvas px-3.5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted"
          >
            Features
          </motion.span>
          <motion.h2
            {...revealItem}
            className="mt-6 font-heading text-[clamp(2rem,3.8vw,3rem)] font-bold leading-[1.06] tracking-[-0.035em] text-ink"
          >
            Everything you need,
            <br className="hidden sm:block" /> nothing you <Mark>can&rsquo;t see</Mark>
          </motion.h2>
          <motion.p {...revealItem} className="mx-auto mt-5 max-w-lg text-base leading-relaxed text-muted">
            Every screen below is the real app &mdash; TraxStaff collects what it
            takes to account for time honestly, never what you type, never full
            URLs, always visibly.
          </motion.p>
        </motion.div>

        <motion.div {...reveal}>
          <FeatureCarousel />
        </motion.div>

        <motion.div {...revealStagger()} className="mt-5 grid gap-5 sm:grid-cols-2">
          {compact.map(({ icon: Icon, title, body }) => (
            <motion.div
              key={title}
              {...item}
              whileHover={reduce ? undefined : { y: -4 }}
              transition={{ duration: 0.2, ease: [0.22, 0.61, 0.36, 1] }}
              className="cursor-target rounded-3xl border border-border bg-canvas/70 p-7"
            >
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand/10 text-brand">
                <Icon width={18} height={18} />
              </span>
              <h3 className="mt-4 font-heading text-base font-bold tracking-[-0.02em] text-ink">{title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">{body}</p>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
