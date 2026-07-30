"use client";

import { motion } from "motion/react";
import { useMotionPresets } from "@/lib/motion";
import { IconKanban, IconUsers, IconTrend } from "@/components/icons";
import { APP_URL } from "@/lib/site";

/**
 * Every card here maps to a real, shipped part of the product — the same
 * items in the dashboard's own sidebar (`Sidebar.tsx`) and the same data
 * disclosed to staff before tracking starts (`desktop/src/Consent.tsx`).
 * Nothing here describes a feature that doesn't exist yet.
 *
 * The three mockups below are schematic illustrations drawn from the app's
 * own category colors and layout — not screenshots of anyone's real work, and
 * not charts of invented company metrics.
 */

const CATEGORIES = [
  { label: "Focus", color: "var(--color-cat-focus)" },
  { label: "Meeting", color: "var(--color-cat-meeting)" },
  { label: "Other", color: "var(--color-cat-other)" },
  { label: "Break", color: "var(--color-cat-break)" },
];

/** A week of categorized time — the shape a timesheet actually takes. */
const WEEK = [
  { day: "Mon", total: "6h 12m", segments: [52, 22, 16, 10] },
  { day: "Tue", total: "7h 04m", segments: [61, 15, 14, 10] },
  { day: "Wed", total: "5h 39m", segments: [44, 33, 12, 11] },
  { day: "Thu", total: "6h 48m", segments: [57, 19, 15, 9] },
  { day: "Fri", total: "4h 55m", segments: [49, 26, 13, 12] },
];

function WeekMock() {
  return (
    <div className="rounded-2xl border border-border bg-surface p-5 shadow-[var(--shadow-soft)]">
      <div className="flex items-baseline justify-between">
        <span className="text-xs font-semibold text-ink">This week</span>
        <span className="font-heading text-sm font-bold tracking-tight text-ink tabular-nums">30h 38m</span>
      </div>

      <div className="mt-4 space-y-2.5">
        {WEEK.map(({ day, total, segments }) => (
          <div key={day} className="flex items-center gap-3">
            <span className="w-8 shrink-0 text-[11px] font-medium text-faint">{day}</span>
            <span className="flex h-2.5 flex-1 overflow-hidden rounded-full bg-canvas">
              {segments.map((pct, i) => (
                <span key={CATEGORIES[i].label} style={{ width: `${pct}%`, background: CATEGORIES[i].color }} />
              ))}
            </span>
            <span className="w-14 shrink-0 text-right text-[11px] text-muted tabular-nums">{total}</span>
          </div>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1.5 border-t border-border pt-3.5">
        {CATEGORIES.map((c) => (
          <span key={c.label} className="flex items-center gap-1.5 text-[11px] text-muted">
            <span className="h-2 w-2 rounded-full" style={{ background: c.color }} />
            {c.label}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Three captures, one blurred — including the "you can see your own" line. */
function ScreenshotMock() {
  const shots = [
    { time: "09:20", blurred: false },
    { time: "09:30", blurred: true },
    { time: "09:40", blurred: false },
  ];

  return (
    <div className="rounded-2xl rounded-b-none border border-border border-b-0 bg-surface p-5 shadow-[var(--shadow-soft)]">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-ink">Today&rsquo;s captures</span>
        <span className="rounded-full bg-canvas px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-muted">
          Every 10 min
        </span>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2.5">
        {shots.map(({ time, blurred }) => (
          <div key={time}>
            <div className="relative aspect-[4/3] overflow-hidden rounded-lg border border-border bg-canvas">
              {/* Abstract stand-in for a captured screen — deliberately not a
                  real screenshot of a real desktop. */}
              <div className={`h-full w-full p-1.5 ${blurred ? "blur-[3px]" : ""}`} aria-hidden>
                <div className="h-1 w-2/3 rounded-full bg-border-strong" />
                <div className="mt-1 h-1 w-1/2 rounded-full bg-border" />
                <div className="mt-2 h-4 w-full rounded bg-brand/10" />
                <div className="mt-1 h-1 w-3/4 rounded-full bg-border" />
              </div>
              {blurred && (
                <span className="absolute bottom-1 left-1 rounded bg-ink/75 px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-wide text-white">
                  Blurred
                </span>
              )}
            </div>
            <div className="mt-1.5 text-center text-[10px] text-faint tabular-nums">{time}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** A trend chart with the current period marked — the Reports view's shape. */
function ReportMock() {
  const bars = [42, 68, 51, 33, 88, 60, 74, 46, 29, 57];

  return (
    <div className="rounded-2xl rounded-b-none border border-border border-b-0 bg-surface p-5 shadow-[var(--shadow-soft)]">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-ink">Tracked hours</span>
        <span className="rounded-full bg-canvas px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-muted">
          Last 10 days
        </span>
      </div>

      <div className="mt-5 flex h-28 items-end gap-1.5" aria-hidden>
        {bars.map((h, i) => (
          <span
            key={i}
            className={`flex-1 rounded-t ${i === 4 ? "bg-brand" : "bg-border"}`}
            style={{ height: `${h}%` }}
          />
        ))}
      </div>
      <div className="mt-2 flex justify-between text-[10px] text-faint">
        <span>Mar 1</span>
        <span>Mar 10</span>
      </div>
    </div>
  );
}

/** The remaining shipped surfaces, stated plainly. */
const compact = [
  {
    icon: IconKanban,
    title: "Projects",
    body: "A kanban board per project, so tracked time ties back to the work it was spent on.",
  },
  {
    icon: IconUsers,
    title: "Roles",
    body: "Owner, admin and member tiers. Staff see their own data; org-wide views are opt-in and admin-only.",
  },
  {
    icon: IconTrend,
    title: "Insights",
    body: "Trends across people, projects and categories over any range — not a single day's snapshot.",
  },
];

export function Features() {
  const { stagger, item } = useMotionPresets();

  return (
    <section id="features" className="bg-surface">
      <div className="mx-auto max-w-6xl px-5 py-24 sm:px-8 lg:py-28">
        <div className="mx-auto max-w-2xl text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-border bg-canvas px-3.5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted">
            Features
          </span>
          <h2 className="mt-6 font-heading text-[clamp(2rem,3.8vw,3rem)] font-bold leading-[1.06] tracking-[-0.035em] text-ink">
            Everything you need,
            <br className="hidden sm:block" /> nothing you can&rsquo;t see
          </h2>
          <p className="mx-auto mt-5 max-w-lg text-base leading-relaxed text-muted">
            TraxStaff collects what it takes to account for time honestly &mdash;
            never what you type, never full URLs, always visibly.
          </p>
        </div>

        <motion.div {...stagger(0.05)} className="mt-14 grid gap-5 lg:grid-cols-2">
          {/* Wide card — text left, mockup right. */}
          <motion.div
            {...item}
            className="grid gap-8 rounded-3xl border border-border bg-canvas/70 p-7 sm:p-9 lg:col-span-2 lg:grid-cols-2 lg:items-center"
          >
            <div>
              <h3 className="font-heading text-2xl font-bold tracking-[-0.03em] text-ink sm:text-[1.75rem]">
                Every hour, accounted for
              </h3>
              <p className="mt-3.5 max-w-md text-sm leading-relaxed text-muted sm:text-base">
                Time is tracked against a project and a task and sorted into
                Focus, Meeting, Other or Break as it runs. Timesheets come out
                organized by day, week and project, ready to review or export.
              </p>
              <a
                href={`${APP_URL}/app`}
                className="mt-7 inline-flex rounded-full bg-brand px-5 py-2.5 text-sm font-semibold text-brand-fg transition hover:bg-brand-600"
              >
                Explore the dashboard
              </a>
            </div>
            <WeekMock />
          </motion.div>

          {/* Two half cards — text top, mockup anchored to the bottom edge. */}
          <motion.div
            {...item}
            className="flex flex-col overflow-hidden rounded-3xl border border-border bg-canvas/70 pt-9"
          >
            <div className="px-7 text-center sm:px-9">
              <h3 className="font-heading text-2xl font-bold tracking-[-0.03em] text-ink">
                Screenshots, not secrets
              </h3>
              <p className="mx-auto mt-3.5 max-w-sm text-sm leading-relaxed text-muted">
                Periodic captures at a frequency your org sets, optionally
                blurred. The person tracked sees their own captures too &mdash;
                nothing is hidden from them.
              </p>
            </div>
            <div className="mt-8 px-7 sm:px-9">
              <ScreenshotMock />
            </div>
          </motion.div>

          <motion.div
            {...item}
            className="flex flex-col overflow-hidden rounded-3xl border border-border bg-canvas/70 pt-9"
          >
            <div className="px-7 text-center sm:px-9">
              <h3 className="font-heading text-2xl font-bold tracking-[-0.03em] text-ink">
                Reports that hold up
              </h3>
              <p className="mx-auto mt-3.5 max-w-sm text-sm leading-relaxed text-muted">
                Trends across people, projects and categories over any date
                range, built on records that can be checked rather than taken
                on trust.
              </p>
            </div>
            <div className="mt-8 px-7 sm:px-9">
              <ReportMock />
            </div>
          </motion.div>
        </motion.div>

        <motion.div {...stagger(0.05)} className="mt-5 grid gap-5 sm:grid-cols-3">
          {compact.map(({ icon: Icon, title, body }) => (
            <motion.div
              key={title}
              {...item}
              className="rounded-3xl border border-border bg-canvas/70 p-7"
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
