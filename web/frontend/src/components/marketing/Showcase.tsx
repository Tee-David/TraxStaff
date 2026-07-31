"use client";

import { motion } from "motion/react";
import { useMotionPresets } from "@/lib/motion";
import { APP_URL } from "@/lib/site";
import { Mark } from "./Mark";
import { PhoneFrame, TabletFrame } from "./DeviceFrames";

/**
 * The product, shown rather than described.
 *
 * Every image in this section is a genuine capture of the app running — the
 * Tauri desktop UI and the Expo mobile UI, rendered from their own source with
 * the native layers stubbed and the backend served fixture data. They are not
 * drawings of the product, and not marketing renders of a design file.
 *
 * The data inside them is invented (there is no seeded database to shoot
 * against) but it is consistent across the two: the same three projects, the
 * same 3h 36m today and 28h 01m this week, the same live session on Design
 * sprint. If the app's UI changes, these go stale — re-shoot rather than
 * retouch.
 */

/** Desktop window chrome, the way the reference frames its browser shot. */
function WindowFrame({
  children,
  className = "",
  label,
}: {
  children: React.ReactNode;
  className?: string;
  label: string;
}) {
  return (
    <div
      className={`overflow-hidden rounded-2xl border border-black/10 bg-surface shadow-[0_28px_70px_-24px_rgba(18,22,43,0.45)] ${className}`}
    >
      <div className="flex items-center gap-2 border-b border-border bg-canvas px-3.5 py-2.5">
        <span className="flex gap-1.5" aria-hidden>
          <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
        </span>
        <span className="mx-auto truncate rounded-md bg-surface px-3 py-0.5 text-[10px] font-medium text-faint">
          {label}
        </span>
      </div>
      {children}
    </div>
  );
}

export function Showcase() {
  const { revealStagger, revealItem, press } = useMotionPresets();

  return (
    <section id="showcase" className="bg-surface px-5 pb-24 sm:px-8 lg:pb-28">
      <motion.div
        {...revealStagger()}
        className="mx-auto max-w-6xl overflow-hidden rounded-[2rem] bg-showcase px-6 pt-14 sm:px-10 sm:pt-16 lg:px-14"
      >
        {/* Centred and stacked on small screens, split left/right once there's
            room for the buttons to sit beside the heading. */}
        <div className="flex flex-col items-center gap-8 text-center lg:flex-row lg:items-start lg:justify-between lg:text-left">
          <motion.h2
            {...revealItem}
            className="max-w-xl font-heading text-[clamp(1.875rem,3.6vw,2.75rem)] font-bold leading-[1.08] tracking-[-0.035em] text-ink"
          >
            Set it up in minutes. <Mark>Visible</Mark> from the first second.
          </motion.h2>

          {/* Full-width buttons below `sm`, matching the hero's. A pair of
              content-width pills stacked on a phone reads as an afterthought
              and gives two different tap widths. */}
          <motion.div
            {...revealItem}
            className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:justify-center lg:shrink-0 lg:pt-2"
          >
            <motion.a
              {...press}
              href="#download"
              className="cursor-target w-full rounded-full bg-field px-6 py-4 text-center text-sm font-semibold text-white transition-colors hover:bg-brand-600 sm:w-auto sm:py-3.5"
            >
              Download the app
            </motion.a>
            <motion.a
              {...press}
              href={`${APP_URL}/app`}
              className="cursor-target w-full rounded-full border border-ink/15 bg-surface px-6 py-4 text-center text-sm font-semibold text-ink transition-colors hover:border-ink/30 sm:w-auto sm:py-3.5"
            >
              Open the dashboard
            </motion.a>
          </motion.div>
        </div>

        {/* Devices run off the panel's bottom edge, as in the reference — the
            frames are cropped rather than floated inside it. */}
        <motion.div {...revealItem} className="relative mt-12 sm:mt-14">
          {/* Below `sm` the desktop capture shrinks to the point of being
              unreadable, so the phone carries the section on its own there and
              the window frames come back once there's width for them. */}
          {/* Each device sits slightly over the one before it — desktop, then
              tablet, then phone — with the stacking order following the same
              order, so the overlaps read as a group of screens rather than
              three unrelated frames in a row. Negative margins do the overlap;
              `items-end` keeps them on one baseline. */}
          <div className="flex items-end justify-center gap-5 sm:gap-0">
            <div className="relative z-10 hidden min-w-0 flex-1 sm:block">
              <WindowFrame label="TraxStaff — Dashboard">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/screens/desktop-dashboard.webp"
                  alt="The TraxStaff desktop app expanded, showing the live tracker beside a week of hours, activity and work-by-hour breakdowns."
                  width={1800}
                  height={1157}
                  loading="lazy"
                  className="block w-full"
                />
              </WindowFrame>

              {/* The tray window it collapses to. Only shown in the band where
                  the tablet isn't: at `lg` and up the line-up is already
                  desktop, tablet and phone, and a fourth frame overlapping the
                  dashboard turns a composition into clutter. */}
              <WindowFrame
                label="Tracker"
                className="absolute -bottom-3 right-5 hidden w-[9rem] rotate-2 sm:block lg:hidden"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/screens/desktop-tracker.webp"
                  alt="The TraxStaff tray window with a session running on Design sprint."
                  width={700}
                  height={1190}
                  loading="lazy"
                  className="block w-full"
                />
              </WindowFrame>
            </div>

            {/* The dashboard is a responsive web app, so a tablet runs it in a
                browser today. It is deliberately not the mobile app: iOS isn't
                shipped, and an iPad running it would imply otherwise. */}
            <TabletFrame className="z-20 hidden w-[19rem] shrink-0 lg:-ml-[4.5rem] lg:block xl:-ml-[5.5rem] xl:w-[23rem]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/screens/tablet-dashboard.webp"
                alt="The TraxStaff dashboard in a tablet browser: the sidebar, today's totals, a timeline of the day and the project board."
                width={960}
                height={671}
                loading="lazy"
                className="block w-full"
              />
            </TabletFrame>

            <PhoneFrame className="z-30 w-[13rem] shrink-0 sm:-ml-14 sm:w-[9rem] lg:-ml-16 lg:w-[8.5rem] xl:w-[10rem]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/screens/mobile-timer.webp"
                alt="The TraxStaff Android app, showing today's tracked time and the timer ready to start."
                width={780}
                height={1688}
                loading="lazy"
                className="block w-full"
              />
            </PhoneFrame>
          </div>
        </motion.div>
      </motion.div>
    </section>
  );
}
