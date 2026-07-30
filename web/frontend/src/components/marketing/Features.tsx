"use client";

import { motion } from "motion/react";
import { useMotionPresets } from "@/lib/motion";
import { IconClock, IconChart, IconImage, IconKanban, IconUsers, IconCalendar } from "@/components/icons";

/**
 * Every card here maps to a real, shipped part of the product — the same
 * items in the dashboard's own sidebar (`Sidebar.tsx`) and the same data
 * collected disclosed to staff before tracking starts (`desktop/src/Consent.tsx`).
 * Nothing here describes a feature that doesn't exist yet.
 */
const features = [
  {
    icon: IconClock,
    title: "Visible time tracking",
    body:
      "A timer that's always on-screen while it runs — categorized as Focus, Meeting, Other or Break, on desktop and mobile.",
  },
  {
    icon: IconImage,
    title: "Screenshots, not secrets",
    body:
      "Periodic screenshots at a frequency your org sets, optionally blurred. The person tracked can see their own captures too — nothing is hidden from them.",
  },
  {
    icon: IconCalendar,
    title: "Timesheets",
    body: "Clocked time organized by day, week and project, ready to review or export.",
  },
  {
    icon: IconChart,
    title: "Reports & Insights",
    body: "Trends across people, projects and categories over any date range — not just a single day's snapshot.",
  },
  {
    icon: IconKanban,
    title: "Projects",
    body: "Organize work into projects with a kanban board, so tracked time ties back to what it was spent on.",
  },
  {
    icon: IconUsers,
    title: "Roles that matter",
    body: "Owner, admin and member permission tiers — staff see their own data; admins see the team's.",
  },
];

export function Features() {
  const { stagger, item } = useMotionPresets();

  return (
    <section id="features" className="mx-auto max-w-6xl px-5 py-20 sm:px-8">
      <div className="mx-auto max-w-2xl text-center">
        <h2 className="font-heading text-3xl font-bold tracking-tight text-ink sm:text-4xl">
          Everything you need, nothing you can&rsquo;t see
        </h2>
        <p className="mt-3 text-base text-muted">
          TraxStaff collects what it takes to account for time honestly &mdash;
          never what you type, never full URLs, always visibly.
        </p>
      </div>

      <motion.div {...stagger(0.05)} className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {features.map(({ icon: Icon, title, body }) => (
          <motion.div
            key={title}
            {...item}
            className="rounded-2xl border border-border bg-surface p-6 shadow-[var(--shadow-soft)]"
          >
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand/10 text-brand">
              <Icon />
            </span>
            <h3 className="mt-4 font-heading text-base font-semibold text-ink">{title}</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-muted">{body}</p>
          </motion.div>
        ))}
      </motion.div>
    </section>
  );
}
