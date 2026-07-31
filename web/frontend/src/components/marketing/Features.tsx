"use client";

import { motion } from "motion/react";
import { useMotionPresets } from "@/lib/motion";
import { IconUsers, IconTrend } from "@/components/icons";
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
  const { revealStagger, revealItem, item, reduce } = useMotionPresets();

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

        <motion.div {...revealStagger()} className="mt-14 grid gap-5 lg:grid-cols-2">
          {/* Wide card — text left, screen right. */}
          <motion.div
            {...item}
            className="cursor-target grid gap-8 rounded-3xl border border-border bg-canvas/70 p-7 sm:p-9 lg:col-span-2 lg:grid-cols-2 lg:items-center"
          >
            <div>
              <h3 className="font-heading text-2xl font-bold tracking-[-0.03em] text-ink sm:text-[1.75rem]">
                Every hour, accounted for
              </h3>
              <p className="mt-3.5 max-w-md text-sm leading-relaxed text-muted sm:text-base">
                Time is tracked against a project and a task as it runs.
                Timesheets come out organised by day, week and project, with
                manual entries marked as manual &mdash; ready to review, approve
                or export.
              </p>
              <motion.a
                href={`${APP_URL}/app`}
                whileHover={reduce ? undefined : { y: -2 }}
                whileTap={reduce ? undefined : { scale: 0.97 }}
                className="cursor-target mt-7 inline-flex rounded-full bg-brand px-5 py-3 text-sm font-semibold text-brand-fg transition-colors hover:bg-brand-600"
              >
                Explore the dashboard
              </motion.a>
            </div>
            <Shot
              shot="timesheets"
              alt="The Timesheets tab: a week total, then each day broken into project and task rows with durations."
              badge="By day, week or project"
            />
          </motion.div>

          {/* Two half cards. */}
          <motion.div
            {...item}
            className="cursor-target flex flex-col rounded-3xl border border-border bg-canvas/70 p-7 sm:p-9"
          >
            <h3 className="font-heading text-2xl font-bold tracking-[-0.03em] text-ink">
              Screenshots, not secrets
            </h3>
            <p className="mt-3.5 flex-1 text-sm leading-relaxed text-muted">
              Periodic captures at a frequency your org sets, optionally blurred.
              The person tracked sees their own captures in the same gallery
              their admin does &mdash; nothing is hidden from them.
            </p>
            <div className="mt-8">
              <Shot
                shot="activity"
                alt="The Activity tab: worked time and average activity, above a grid of captured screenshots."
                badge="Blur is an org setting"
              />
            </div>
          </motion.div>

          <motion.div
            {...item}
            className="cursor-target flex flex-col rounded-3xl border border-border bg-canvas/70 p-7 sm:p-9"
          >
            <h3 className="font-heading text-2xl font-bold tracking-[-0.03em] text-ink">
              Reports that hold up
            </h3>
            <p className="mt-3.5 flex-1 text-sm leading-relaxed text-muted">
              Totals, tracked-versus-manual by day, and a breakdown by project or
              task over any date range &mdash; built on records that can be
              checked rather than taken on trust.
            </p>
            <div className="mt-8">
              <Shot
                shot="reports"
                alt="The Reports tab: total time and activity, a tracked-versus-manual bar chart by day, and time grouped by project."
                badge="Any date range"
                badgeClass="-bottom-3 right-5"
              />
            </div>
          </motion.div>

          {/* Wide card, mirrored — screen left, text right. */}
          <motion.div
            {...item}
            className="cursor-target grid gap-8 rounded-3xl border border-border bg-canvas/70 p-7 sm:p-9 lg:col-span-2 lg:grid-cols-2 lg:items-center"
          >
            <div className="lg:order-2">
              <h3 className="font-heading text-2xl font-bold tracking-[-0.03em] text-ink sm:text-[1.75rem]">
                Work organised into projects
              </h3>
              <p className="mt-3.5 max-w-md text-sm leading-relaxed text-muted sm:text-base">
                Every project gets a board. Tracked time attaches to a task, so
                the hours tie back to the thing they were spent on rather than
                sitting in an undifferentiated pile.
              </p>
            </div>
            <div className="lg:order-1">
              <Shot
                shot="projects"
                alt="The Projects tab: a board per project with To do, In progress and Done columns."
                badge="To do → In progress → Done"
              />
            </div>
          </motion.div>
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
