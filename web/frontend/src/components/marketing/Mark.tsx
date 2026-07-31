"use client";

import { useRef, type ReactNode } from "react";
import { useInView } from "motion/react";

/**
 * The emphasised word in a headline, with the orange brush stroke under it.
 *
 * The stroke draws itself on left to right the first time the phrase reaches
 * the viewport, so each headline marks itself as you scroll to it. The hero's
 * fires on load, being already on screen.
 *
 * The animation itself is a CSS transition on `.mk-mark-stroke` rather than a
 * Framer one — see the note in globals.css for why nesting a motion element
 * inside a variant-driven heading doesn't work. This hook only decides *when*;
 * CSS decides how, including honouring prefers-reduced-motion.
 */
export function Mark({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLSpanElement>(null);
  // `once` so it never re-draws on scroll-back, which reads as a glitch.
  const drawn = useInView(ref, { once: true, amount: 0.6 });

  return (
    <span ref={ref} className="mk-mark">
      {children}
      <span aria-hidden className="mk-mark-stroke" data-drawn={drawn} />
    </span>
  );
}
