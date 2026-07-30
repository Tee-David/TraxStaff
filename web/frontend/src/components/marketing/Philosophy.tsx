"use client";

import { motion } from "motion/react";
import { useMotionPresets } from "@/lib/motion";

/**
 * Stands in for the usual customer-testimonial slot. There is no named
 * customer quote to put here, so instead of inventing one, this states the
 * product's actual position on tamper-resistance plainly — team-attributed,
 * not dressed up as a review. Language follows the project's own internal
 * "keep this honest" positioning notes: tamper-evident and hard-capped, not
 * tamper-proof, because nothing client-side is unbeatable on a machine
 * where the user has local admin.
 */
const points = [
  {
    title: "A hardware clock, not the system clock",
    body: "Credited duration comes from a hardware counter the local system clock can't influence.",
  },
  {
    title: "Capped against the server",
    body: "Credited time is capped against the server's own clock, which the client can't see or change.",
  },
  {
    title: "Tamper-evident records",
    body: "Session records are chained, so edits after the fact are detectable — not just trusted.",
  },
  {
    title: "The real control isn't code",
    body: "The highest-leverage safeguard is organizational: staff not having local admin on the tracked machine.",
  },
];

export function Philosophy() {
  const { stagger, item } = useMotionPresets();

  return (
    <section className="bg-brand py-20 text-brand-fg">
      <div className="mx-auto max-w-6xl px-5 sm:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="font-heading text-3xl font-bold tracking-tight sm:text-4xl">
            Tamper-evident by design, not tamper-proof by claim
          </h2>
          <p className="mt-3 text-base text-brand-fg/75">
            We&rsquo;d rather tell you exactly what TraxStaff can and can&rsquo;t
            guarantee than oversell it.
          </p>
        </div>

        <motion.div {...stagger(0.05)} className="mt-12 grid gap-5 sm:grid-cols-2">
          {points.map((p) => (
            <motion.div
              key={p.title}
              {...item}
              className="rounded-2xl border border-white/15 bg-white/5 p-6"
            >
              <h3 className="font-heading text-base font-semibold">{p.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-brand-fg/75">{p.body}</p>
            </motion.div>
          ))}
        </motion.div>

        <p className="mt-10 text-center text-sm font-medium text-brand-fg/60">
          &mdash; the TraxStaff team
        </p>
      </div>
    </section>
  );
}
