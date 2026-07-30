"use client";

import { useState, type CSSProperties } from "react";
import { motion } from "motion/react";
import { useMotionPresets } from "@/lib/motion";

/**
 * Occupies the slot a landing page normally gives to a testimonial carousel.
 *
 * There are no customer testimonials to put here — not "not gathered yet",
 * but none that exist — and the site's rule is that every claim on it is
 * checkable, so inventing quotes or borrowing logos isn't available. The
 * carousel mechanism is real: a marquee that pauses on hover and on keyboard
 * focus. What rides on it is the set of positions the product is actually
 * built on, each one verifiable in the app or the code.
 *
 * TO SWAP IN REAL TESTIMONIALS: replace the `statements` array below. The card
 * is already testimonial-shaped — `label` becomes the person's name, `body`
 * their quote, `note` their role and company. Nothing else needs to change.
 */
type Statement = {
  label: string;
  body: string;
  note: string;
};

const statements: Statement[] = [
  {
    label: "Never covert",
    body:
      "A visible indicator stays on screen the whole time tracking runs, on every client. Consent is explicit and recorded against a version.",
    note: "Accepted before capture can start",
  },
  {
    label: "Tamper-evident, not tamper-proof",
    body:
      "On a machine where someone has local admin, nothing client-side is unbeatable. We don't claim otherwise.",
    note: "Where the guarantee stops is written down",
  },
  {
    label: "Self-only by default",
    body:
      "Dashboard, timesheets, reports and screenshots all default an owner or admin to their own data — the same view a member gets.",
    note: "Org-wide visibility is an explicit opt-in",
  },
  {
    label: "Mobile captures nothing",
    body:
      "No screen capture, no activity percentage and no location on phones. That's a product boundary, not a missing feature.",
    note: "The same on Android and iOS",
  },
  {
    label: "Flags, never silent deletions",
    body:
      "Clock-skew and anomaly signals are recorded for a human to review. They are never used to quietly drop someone's tracked time.",
    note: "Recorded for review, never auto-applied",
  },
  {
    label: "Nothing invented on this page",
    body:
      "No fake client logos, no borrowed testimonials, no made-up traction numbers. Every claim here is checkable in the product or the code.",
    note: "Including the absence of customer quotes",
  },
];

function StatementCard({ item, reduce }: { item: Statement; reduce: boolean }) {
  return (
    <motion.li
      whileHover={reduce ? undefined : { y: -4 }}
      transition={{ duration: 0.2, ease: [0.22, 0.61, 0.36, 1] }}
      className="flex w-[19rem] shrink-0 flex-col rounded-3xl border border-border bg-canvas/70 p-7 sm:w-[22rem]"
    >
      <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-positive">
        {item.label}
      </span>
      <p className="mt-4 flex-1 text-[0.9375rem] leading-relaxed text-ink">{item.body}</p>
      <span className="mt-5 border-t border-border pt-4 text-xs text-muted">{item.note}</span>
    </motion.li>
  );
}

export function Statements() {
  const { page, reduce } = useMotionPresets();
  // Hover covers pointers and :focus-within covers keyboards, but a phone has
  // neither — without this a touch user can't stop the row to read it.
  const [paused, setPaused] = useState(false);

  return (
    <section className="bg-surface pb-24 lg:pb-28">
      <motion.div {...page} className="mx-auto max-w-2xl px-5 text-center sm:px-8">
        <span className="inline-flex items-center gap-2 rounded-full border border-border bg-canvas px-3.5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted">
          Where we stand
        </span>
        <h2 className="mt-6 font-heading text-[clamp(2rem,3.8vw,3rem)] font-bold leading-[1.06] tracking-[-0.035em] text-ink">
          No customer quotes.
          <br className="hidden sm:block" /> These are{" "}
          <span className="mk-mark">ours</span>
        </h2>
        <p className="mx-auto mt-5 max-w-lg text-base leading-relaxed text-muted">
          We&rsquo;d rather leave this space honest than fill it with a quote
          nobody said. These are the positions the product is built on instead
          &mdash; each one you can check.
        </p>
      </motion.div>

      {/* Full-bleed on purpose: the row runs past both edges so it reads as a
          continuous band rather than a widget sitting inside the column.

          Focusable deliberately. Nothing inside the cards is interactive, so
          without this the :focus-within pause could never fire and hover would
          be the only way to stop it — which leaves keyboard users with no way
          to read moving text (WCAG 2.2.2). Tabbing to the band pauses it, and
          under reduced motion the same tab stop is what makes the scrollable
          row operable from the keyboard. */}
      <div
        className={`mk-marquee mt-14 ${paused ? "mk-marquee-paused" : ""}`}
        style={{ "--mk-marquee-duration": "72s" } as CSSProperties}
        tabIndex={0}
        role="group"
        aria-label="What TraxStaff stands behind. Scrolls automatically; pauses on hover, and on tap or Enter."
        onClick={() => setPaused((p) => !p)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setPaused((p) => !p);
          }
        }}
      >
        <div className="mk-marquee-track">
          <ul className="mk-marquee-row">
            {statements.map((s) => (
              <StatementCard key={s.label} item={s} reduce={reduce} />
            ))}
          </ul>
          {/* The duplicate exists only to make the wrap seamless — hidden from
              assistive tech so the list isn't announced twice. */}
          <ul className="mk-marquee-row mk-marquee-clone" aria-hidden>
            {statements.map((s) => (
              <StatementCard key={s.label} item={s} reduce={reduce} />
            ))}
          </ul>
        </div>
      </div>

      <p className="mt-7 text-center text-xs text-faint">
        {paused ? "Paused — tap to resume" : "Hover or tap to pause"}
      </p>
    </section>
  );
}
