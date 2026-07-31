"use client";

import { useState, type CSSProperties } from "react";
import { motion } from "motion/react";
import { useMotionPresets } from "@/lib/motion";
import { Mark } from "./Mark";

/* ===========================================================================
   PLACEHOLDER CONTENT — NOT REAL CUSTOMERS.
   ---------------------------------------------------------------------------
   Every quote, name, role and company below is invented sample copy, written
   to show the layout. None of these people exist and none of these companies
   are TraxStaff customers.

   This is a deliberate exception to the rule in the repo README that the
   marketing site carries no invented testimonials, made at the product
   owner's explicit request. Company names are fictional on purpose so that no
   real organisation is implied to be a customer.

   REPLACE `testimonials` BELOW BEFORE THIS COUNTS AS FINISHED COPY.
   =========================================================================== */
type Testimonial = {
  quote: string;
  name: string;
  role: string;
};

const testimonials: Testimonial[] = [
  {
    quote:
      "We switched because the team could finally see when it was running. The pushback disappeared inside a week.",
    name: "Priya Raghunathan",
    role: "Head of Operations, Northwind Logistics",
  },
  {
    quote:
      "The server-side cap ended an argument we'd been having for months about whose clock was right.",
    name: "Daniel Okafor",
    role: "Engineering Manager, Cascade Systems",
  },
  {
    quote:
      "Contractors bill against the same records we review. No more reconciling two different spreadsheets.",
    name: "Marta Lindqvist",
    role: "Finance Lead, Alderman Studio",
  },
  {
    quote:
      "Blurred screenshots were the compromise that got this past our works council.",
    name: "Tomás Herrera",
    role: "People Operations, Vela Health",
  },
  {
    quote:
      "Admins seeing only their own data by default was the detail that sold our security team.",
    name: "Aisha Bello",
    role: "IT Director, Kestrel Financial",
  },
  {
    quote:
      "Setup took an afternoon, and the Linux build actually works. I did not expect that.",
    name: "Jonas Weber",
    role: "CTO, Halden Software",
  },
  {
    quote:
      "Staff can pull up their own captures. That one thing changed how people felt about being tracked.",
    name: "Grace Mwangi",
    role: "Support Lead, Umoja Group",
  },
  {
    quote:
      "We needed something auditable, not something invisible. This was the only tool honest about the difference.",
    name: "Ryan Delacroix",
    role: "COO, Pinewood Partners",
  },
];

/* Split into the two counter-scrolling rows the reference uses. */
const rowOne = testimonials.slice(0, 4);
const rowTwo = testimonials.slice(4);

/* Monogram stands in for the reference's photography. Stock photos can't be
   fetched into this repo, and a headshot of a real person attached to an
   invented quote would be a considerably worse thing to ship than initials. */
const tints = [
  "var(--color-brand)",
  "var(--color-accent)",
  "var(--color-cat-other)",
  "var(--color-positive)",
];

function Avatar({ name, index }: { name: string; index: number }) {
  const tint = tints[index % tints.length];
  const initials = name
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("");

  return (
    <span
      aria-hidden
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full font-heading text-xs font-bold"
      style={{ background: `color-mix(in srgb, ${tint} 18%, transparent)`, color: tint }}
    >
      {initials}
    </span>
  );
}

function IconStar() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 2.6l2.9 6 6.6.9-4.8 4.6 1.2 6.5-5.9-3.1-5.9 3.1 1.2-6.5L2.5 9.5l6.6-.9z" />
    </svg>
  );
}

function TestimonialCard({
  item,
  index,
  reduce,
}: {
  item: Testimonial;
  index: number;
  reduce: boolean;
}) {
  return (
    <motion.li
      whileHover={reduce ? undefined : { y: -4 }}
      transition={{ duration: 0.2, ease: [0.22, 0.61, 0.36, 1] }}
      className="flex w-[19rem] shrink-0 flex-col rounded-3xl border border-border bg-canvas/70 p-7 sm:w-[23rem]"
    >
      <span aria-hidden className="font-heading text-3xl font-bold leading-none text-brand">
        &ldquo;
      </span>
      <p className="mt-4 flex-1 text-[0.9375rem] leading-relaxed text-ink">{item.quote}</p>
      <span className="mt-6 flex items-center gap-3">
        <Avatar name={item.name} index={index} />
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold text-ink">{item.name}</span>
          <span className="block truncate text-xs text-muted">{item.role}</span>
        </span>
      </span>
    </motion.li>
  );
}

function Row({
  items,
  offset,
  duration,
  reverse,
  reduce,
}: {
  items: Testimonial[];
  offset: number;
  duration: string;
  reverse?: boolean;
  reduce: boolean;
}) {
  const cards = items.map((t, i) => (
    <TestimonialCard key={t.name} item={t} index={offset + i} reduce={reduce} />
  ));

  return (
    <div
      className={`mk-marquee-track ${reverse ? "mk-marquee-track--reverse" : ""}`}
      style={{ "--mk-marquee-duration": duration } as CSSProperties}
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

export function Testimonials() {
  const { revealStagger, revealItem, reduce } = useMotionPresets();
  // Hover covers pointers and :focus-visible covers keyboards, but a phone has
  // neither — without this a touch user can't stop the rows to read them.
  const [paused, setPaused] = useState(false);

  return (
    <section className="bg-surface pb-24 lg:pb-28">
      <motion.div {...revealStagger()} className="mx-auto max-w-2xl px-5 text-center sm:px-8">
        <motion.span {...revealItem} className="inline-flex items-center gap-2 rounded-full bg-field px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-white shadow-[var(--shadow-lift)] ring-1 ring-white/15">
          <span className="text-accent">
            <IconStar />
          </span>
          What teams say
        </motion.span>
        <motion.h2 {...revealItem} className="mt-6 font-heading text-[clamp(2rem,3.8vw,3rem)] font-bold leading-[1.06] tracking-[-0.035em] text-ink">
          Words from teams who
          <br className="hidden sm:block" /> stopped{" "}
          <Mark>fighting</Mark> the timer.
        </motion.h2>
      </motion.div>

      {/* Full-bleed on purpose: the rows run past both edges so they read as a
          continuous band rather than a widget sitting inside the column.

          Focusable deliberately. Nothing inside the cards is interactive, so
          without this the :focus-visible pause could never fire and hover
          would be the only way to stop it — which leaves keyboard users with
          no way to read moving text (WCAG 2.2.2). Under reduced motion the
          same tab stop is what makes the scrollable rows keyboard-operable. */}
      <div
        className={`mk-marquee mt-14 ${paused ? "mk-marquee-paused" : ""}`}
        tabIndex={0}
        role="group"
        aria-label="What teams say about TraxStaff. Scrolls automatically; pauses on hover, and on tap or Enter."
        onClick={() => setPaused((p) => !p)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setPaused((p) => !p);
          }
        }}
      >
        <Row items={rowOne} offset={0} duration="78s" reduce={reduce} />
        {/* Second row runs the other way and slower, so the two never line up
            into one moving block. */}
        <div className="mt-5">
          <Row items={rowTwo} offset={4} duration="94s" reverse reduce={reduce} />
        </div>
      </div>

      <p className="mt-7 text-center text-xs text-faint">
        {paused ? "Paused — tap to resume" : "Hover or tap to pause"}
      </p>
    </section>
  );
}
