"use client";

import { useState, type CSSProperties } from "react";
import { motion } from "motion/react";
import { useMotionPresets } from "@/lib/motion";
import { Mark } from "./Mark";

/**
 * The positions the product is built on, as a pair of counter-scrolling
 * marquees — the same two-row treatment the testimonials carousel uses.
 *
 * This used to stand in for the testimonial slot, back when there was nothing
 * honest to put there. Now that a testimonials carousel sits earlier in the
 * page it does its own job instead: closing the argument just before the
 * download CTA. What keeps the two from reading as the same widget twice is no
 * longer the row count but the cards themselves — principle labels and a rule,
 * against quote marks and faces.
 *
 * Every line here is checkable against the app or the code. That mattered
 * enough to cost this section a card: it used to end on "nothing invented on
 * this page", which stopped being true the moment placeholder testimonials
 * went in above. Rather than leave a false claim sitting a few sections away
 * from the thing that falsifies it, that card was replaced with the consent
 * versioning rule from `desktop/src/Consent.tsx`. Put it back if and when the
 * testimonials become real.
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
    label: "Consent is versioned",
    body:
      "Capture is unreachable until the current disclosure is accepted. Change what gets collected and everyone has to accept it again.",
    note: "Enforced in the client, not just promised",
  },
];

/* Both rows carry all six positions rather than three each.
 *
 * Splitting them would make each row about 1100px of cards, and the loop needs
 * a row at least as wide as the viewport or a gap opens up at the end of every
 * cycle on a wide monitor — the track is only ever the row plus one clone. Six
 * cards is ~2200px, which covers anything short of an ultrawide. The second row
 * is rotated so the two never show the same card at the same x, and it runs the
 * other way at a different speed, so they don't read as one belt.
 */
const rowTwo = [...statements.slice(3), ...statements.slice(0, 3)];

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

function Row({
  items,
  duration,
  reverse,
  decorative,
  reduce,
}: {
  items: Statement[];
  duration: string;
  reverse?: boolean;
  /** Hide the whole row from assistive tech — for the row that repeats content
   *  already announced by the one above it. */
  decorative?: boolean;
  reduce: boolean;
}) {
  const cards = items.map((s) => <StatementCard key={s.label} item={s} reduce={reduce} />);

  return (
    <div
      className={`mk-marquee-track ${reverse ? "mk-marquee-track--reverse" : ""}`}
      style={{ "--mk-marquee-duration": duration } as CSSProperties}
      aria-hidden={decorative || undefined}
    >
      <ul className="mk-marquee-row">{cards}</ul>
      {/* Clone only exists to make the wrap seamless — hidden from assistive
          tech so the list isn't announced twice. */}
      <ul className="mk-marquee-row mk-marquee-clone" aria-hidden>
        {cards}
      </ul>
    </div>
  );
}

export function Statements() {
  const { revealStagger, revealItem, reduce } = useMotionPresets();
  // Hover covers pointers and :focus-visible covers keyboards, but a phone has
  // neither — without this a touch user can't stop the row to read it.
  const [paused, setPaused] = useState(false);

  return (
    <section className="bg-surface pb-24 lg:pb-28">
      <motion.div {...revealStagger()} className="mx-auto max-w-2xl px-5 text-center sm:px-8">
        <motion.span {...revealItem} className="inline-flex items-center gap-2 rounded-full border border-border bg-canvas px-3.5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted">
          Where we stand
        </motion.span>
        <motion.h2 {...revealItem} className="mt-6 font-heading text-[clamp(2rem,3.8vw,3rem)] font-bold leading-[1.06] tracking-[-0.035em] text-ink">
          Positions we&rsquo;ll put
          <br className="hidden sm:block" /> <Mark>in writing</Mark>
        </motion.h2>
        <motion.p {...revealItem} className="mx-auto mt-5 max-w-lg text-base leading-relaxed text-muted">
          Not marketing lines. Each one is checkable against the product or the
          code that runs it.
        </motion.p>
      </motion.div>

      {/* Full-bleed on purpose: the row runs past both edges so it reads as a
          continuous band rather than a widget sitting inside the column.

          Focusable deliberately. Nothing inside the cards is interactive, so
          without this the :focus-visible pause could never fire and hover
          would be the only way to stop it — which leaves keyboard users with
          no way to read moving text (WCAG 2.2.2). Under reduced motion the
          same tab stop is what makes the scrollable row keyboard-operable. */}
      <div
        className={`mk-marquee mt-14 ${paused ? "mk-marquee-paused" : ""}`}
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
        {/* The leading row runs the opposite way to the testimonials' leading
            row, so the page's two marquees never appear to be driving in
            lockstep. */}
        <Row items={statements} duration="72s" reverse reduce={reduce} />
        {/* Same six positions rotated, so this row is decoration as far as a
            screen reader is concerned — the list is announced once, above. */}
        <div className="mt-5">
          <Row items={rowTwo} duration="88s" decorative reduce={reduce} />
        </div>
      </div>

      <p className="mt-7 text-center text-xs text-faint">
        {paused ? "Paused — tap to resume" : "Hover or tap to pause"}
      </p>
    </section>
  );
}
