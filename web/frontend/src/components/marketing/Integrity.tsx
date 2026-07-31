"use client";

import { motion } from "motion/react";
import { useMotionPresets } from "@/lib/motion";
import { Mark } from "./Mark";

/**
 * Takes the slot the reference layout gives to an integrations marquee.
 * TraxStaff has no third-party integrations to show, and inventing a wall of
 * logos would break the site's own rule, so this states the thing that
 * actually differentiates the product instead: where each guarantee lives.
 *
 * The labels are the structure. Ordering these from the metal outward —
 * device, server, record, org — is the honest shape of the argument: each
 * layer covers what the one before it can't, and the last one isn't code at
 * all. Copy follows the project's internal positioning notes: tamper-evident
 * and hard-capped, never "tamper-proof".
 */
const layers = [
  {
    where: "On the device",
    title: "A counter the system clock can't touch",
    body:
      "Credited duration comes from a hardware counter, not the OS clock — QueryUnbiasedInterruptTimePrecise on Windows, CLOCK_MONOTONIC on Linux. Winding the clock forward changes nothing.",
  },
  {
    where: "On the server",
    title: "Capped against a clock the client never sees",
    body:
      "However much time a client reports, it's hard-capped against the server's own clock — which the machine being tracked can neither read nor influence.",
  },
  {
    where: "In the record",
    title: "Sessions are hash-chained",
    body:
      "Each session links to the one before it, so an edit after the fact breaks the chain. Skew and anomaly signals are recorded as flags for a human to review — never used to silently drop data.",
  },
  {
    where: "In the org",
    title: "The strongest control isn't code",
    body:
      "On a machine where someone has local admin, nothing client-side is unbeatable. The highest-leverage safeguard is organizational: staff not having local admin on the tracked machine.",
  },
];

export function Integrity() {
  const { reveal, revealStagger, item } = useMotionPresets();

  return (
    <section className="bg-surface px-5 pb-24 sm:px-8 lg:pb-28">
      <div className="mk-on-field mk-grid mk-grid-invert relative mx-auto max-w-6xl overflow-hidden rounded-[2rem] bg-field px-6 py-20 text-white sm:px-10 lg:py-24">
        <motion.div {...reveal} className="mx-auto max-w-2xl text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/5 px-3.5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-white/70">
            Integrity
          </span>
          <h2 className="mt-6 font-heading text-[clamp(2rem,3.8vw,3rem)] font-bold leading-[1.06] tracking-[-0.035em]">
            Tamper-evident by design,
            <br className="hidden sm:block" /> not tamper-proof by{" "}
            <Mark>claim</Mark>
          </h2>
          <p className="mx-auto mt-5 max-w-lg text-base leading-relaxed text-white/70">
            Four layers stand between a tracked hour and a number you can trust.
            Here is exactly where each one lives &mdash; and where the last one
            stops.
          </p>
        </motion.div>

        <motion.div {...revealStagger()} className="mt-14 grid gap-4 sm:grid-cols-2">
          {layers.map((l) => (
            <motion.div
              key={l.where}
              {...item}
              className="min-w-0 rounded-2xl border border-white/12 bg-white/[0.04] p-7"
            >
              <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-accent">
                {l.where}
              </span>
              <h3 className="mt-3 font-heading text-lg font-bold tracking-[-0.02em]">{l.title}</h3>
              <p className="mt-2.5 break-words text-sm leading-relaxed text-white/65">{l.body}</p>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
