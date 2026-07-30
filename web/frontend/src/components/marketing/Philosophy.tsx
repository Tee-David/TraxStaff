"use client";

import { motion } from "motion/react";
import { useMotionPresets } from "@/lib/motion";

/**
 * Occupies the slot a landing page normally gives to a customer testimonial.
 * There is no named customer quote to put here, so rather than invent one,
 * this states the product's actual position in the product's own voice —
 * clearly attributed to the team, never dressed up as a review, and with no
 * stock headshot standing in for a person who doesn't exist.
 */
export function Philosophy() {
  const { page } = useMotionPresets();

  return (
    <section className="bg-surface px-5 pb-24 sm:px-8 lg:pb-28">
      <motion.figure {...page} className="mx-auto max-w-3xl text-center">
        <span
          aria-hidden
          className="font-heading text-5xl font-bold leading-none text-accent"
        >
          &ldquo;
        </span>

        <blockquote className="mt-5 font-heading text-[clamp(1.375rem,2.9vw,2rem)] font-medium leading-[1.32] tracking-[-0.025em] text-ink">
          On a machine where someone has local admin, nothing client-side is
          unbeatable. So we don&rsquo;t sell you tamper-proof. We build
          tamper-evident, and we tell you exactly where the line is.
        </blockquote>

        <figcaption className="mt-9 flex flex-col items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/icon-badge.svg" alt="" width={36} height={36} className="h-9 w-9" />
          <span className="text-sm font-semibold text-ink">The TraxStaff team</span>
          <span className="text-xs text-muted">
            On what this product does and doesn&rsquo;t guarantee
          </span>
        </figcaption>
      </motion.figure>
    </section>
  );
}
