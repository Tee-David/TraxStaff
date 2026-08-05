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
 *
 * Written for whoever signs off on the tool, not for whoever integrates it.
 * The mechanisms named here are real (a monotonic counter, a server-side cap,
 * a hash chain), but the API names and the jargon belong in the docs — on this
 * page each one is stated as the thing it stops someone doing.
 */
const layers = [
  {
    where: "On the device",
    title: "Changing the clock changes nothing",
    body:
      "The app doesn't read the date and time on the computer. It uses a separate counter that only ever moves forward, so nudging the clock ahead an hour doesn't add an hour to anyone's day.",
  },
  {
    where: "On the server",
    title: "Checked against a clock we hold",
    body:
      "However many hours a device sends in, we measure them against our own clock — one the tracked machine can't read or change. Nobody can log more time than has actually passed.",
  },
  {
    where: "In the record",
    title: "Every session is sealed to the last",
    body:
      "Sessions are linked together like a chain, so altering an old one visibly breaks it. Anything that looks off gets flagged for a person to look at — never quietly deleted.",
  },
  {
    where: "In the org",
    title: "The strongest safeguard isn't software",
    body:
      "If someone can install anything they like on their own machine, no tracker on earth is unbeatable — ours included. The best protection is a policy one: don't hand out admin rights on the computers you track.",
  },
];

export function Integrity() {
  const { revealStagger, revealItem, item } = useMotionPresets();

  return (
    <section className="bg-surface px-5 pb-24 sm:px-8 lg:pb-28">
      <div className="mk-on-field mk-grid mk-grid-invert relative mx-auto max-w-6xl overflow-hidden rounded-[2rem] bg-field px-6 py-20 text-white sm:px-10 lg:py-24">
        <motion.div {...revealStagger()} className="mx-auto max-w-2xl text-center">
          <motion.span {...revealItem} className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/5 px-3.5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-white/70">
            Integrity
          </motion.span>
          <motion.h2 {...revealItem} className="mt-6 font-heading text-[clamp(2rem,3.8vw,3rem)] font-bold leading-[1.06] tracking-[-0.035em]">
            Tamper-evident by design,
            <br className="hidden sm:block" /> not tamper-proof by{" "}
            <Mark>claim</Mark>
          </motion.h2>
          <motion.p {...revealItem} className="mx-auto mt-5 max-w-lg text-base leading-relaxed text-white/70">
            Four layers stand between a tracked hour and a number you can trust.
            Here is exactly where each one lives &mdash; and where the last one
            stops.
          </motion.p>
        </motion.div>

        <motion.div {...revealStagger()} className="mt-14 grid gap-4 sm:grid-cols-2">
          {layers.map((l) => (
            <motion.div
              key={l.where}
              {...item}
              className="cursor-target min-w-0 rounded-2xl border border-white/12 bg-white/[0.04] p-7"
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
