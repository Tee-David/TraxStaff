"use client";

import { motion } from "motion/react";
import { useMotionPresets } from "@/lib/motion";

/**
 * Takes the slot the reference layout gives to a stats row ("50K+ users",
 * "1k+ partners"). There are no traction numbers to put here that would be
 * true, and the site's rule is that every claim on it is verifiable — so this
 * uses the space for something that is both checkable and more persuasive:
 * the collection disclosure itself.
 *
 * Both columns are lifted from the first-run consent screen every staff member
 * must accept before capture can start (`desktop/src/Consent.tsx`), plus the
 * mobile boundary stated in the repo README. If this list and that screen ever
 * disagree, that screen is the source of truth and this one is the bug.
 */
const recorded = [
  {
    title: "Screenshots",
    body: "Of all your monitors, at the frequency your org sets — and blurred if your org turns that on.",
  },
  {
    title: "Activity level",
    body: "How often the keyboard and mouse are used. Timing and intensity only.",
  },
  {
    title: "Apps and sites",
    body: "The names of the apps you use and the domains of the sites you visit while tracking.",
  },
  {
    title: "Device",
    body: "An identifier, so tracked time is attributed to the right machine.",
  },
];

const never = [
  {
    title: "What you type",
    body: "Keystrokes are never captured — only that input happened, never its content.",
  },
  {
    title: "Full URLs",
    body: "The domain of a site, never the page, the path or the query string.",
  },
  {
    title: "Anything after you stop",
    body: "Capture ends the moment you stop the timer or quit the app. There is no background mode.",
  },
  {
    title: "Your phone's screen",
    body: "Mobile has no screen capture, no activity percentage and no location. That's a boundary, not a gap.",
  },
];

function MarkOn() {
  return (
    <span
      aria-hidden
      className="mt-1.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-accent/15"
    >
      <span className="h-1.5 w-1.5 rounded-full bg-accent" />
    </span>
  );
}

function MarkOff() {
  return (
    <svg
      aria-hidden
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      className="mt-1.5 shrink-0 text-faint"
    >
      <circle cx="8" cy="8" r="6.25" />
      <path d="M4.4 11.6 11.6 4.4" strokeLinecap="round" />
    </svg>
  );
}

export function Transparency() {
  const { reveal, revealStagger, item } = useMotionPresets();

  return (
    <section id="transparency" className="bg-surface px-5 pb-24 sm:px-8 lg:pb-28">
      <div className="mx-auto max-w-6xl">
        <motion.div {...reveal} className="mx-auto max-w-2xl text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-border bg-canvas px-3.5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted">
            Transparency
          </span>
          <h2 className="mt-6 font-heading text-[clamp(2rem,3.8vw,3rem)] font-bold leading-[1.06] tracking-[-0.035em] text-ink">
            What&rsquo;s recorded,
            <br className="hidden sm:block" /> and what{" "}
            <span className="mk-mark">never</span> is
          </h2>
          <p className="mx-auto mt-5 max-w-lg text-base leading-relaxed text-muted">
            The same disclosure every staff member reads and accepts before
            tracking can start. Not a summary of it &mdash; the list itself.
          </p>
        </motion.div>

        <motion.div
          {...revealStagger()}
          className="mt-14 grid overflow-hidden rounded-[2rem] border border-border bg-canvas/70 lg:grid-cols-2"
        >
          <div className="border-b border-border p-8 sm:p-10 lg:border-b-0 lg:border-r">
            <h3 className="font-heading text-base font-bold tracking-[-0.02em] text-ink">
              Recorded, while the timer runs
            </h3>
            <ul className="mt-6 space-y-5">
              {recorded.map((r) => (
                <motion.li key={r.title} {...item} className="flex gap-3.5">
                  <MarkOn />
                  <span>
                    <span className="block text-sm font-semibold text-ink">{r.title}</span>
                    <span className="mt-1 block text-sm leading-relaxed text-muted">{r.body}</span>
                  </span>
                </motion.li>
              ))}
            </ul>
          </div>

          <div className="p-8 sm:p-10">
            <h3 className="font-heading text-base font-bold tracking-[-0.02em] text-ink">
              Never recorded, at any setting
            </h3>
            <ul className="mt-6 space-y-5">
              {never.map((n) => (
                <motion.li key={n.title} {...item} className="flex gap-3.5">
                  <MarkOff />
                  <span>
                    <span className="block text-sm font-semibold text-ink">{n.title}</span>
                    <span className="mt-1 block text-sm leading-relaxed text-muted">{n.body}</span>
                  </span>
                </motion.li>
              ))}
            </ul>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
