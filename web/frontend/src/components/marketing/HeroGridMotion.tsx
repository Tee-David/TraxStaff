"use client";

import { useEffect, useRef } from "react";
import { gsap } from "gsap";
import { useReducedMotion } from "motion/react";

/**
 * The hero's background texture: a grid of panels, rotated off-axis, whose rows
 * drift in alternating directions as the pointer moves across the page.
 *
 * Adapted from the ReactBits `GridMotion` component, with four changes it needed
 * to work here:
 *
 *  1. No imagery. The original fills its tiles with stock photographs. Nothing
 *     on this site is a stock photo, and a wall of them behind the headline
 *     would be both off-brand and the single most distracting thing on the page.
 *     The tiles are tinted panels built from the theme's own tokens instead, so
 *     this reads as an extension of the blueprint field the rest of the page
 *     already uses rather than a photo collage behind it.
 *  2. It has to be invisible where the words are. The mask on `.mk-hero-motion`
 *     is the inverse of the one on the hero's ruled lines: tiles are absent
 *     behind the headline and strongest out at the edges, so the two textures
 *     divide the stage between them instead of stacking up in the middle.
 *  3. It has to move without a mouse. `mousemove` leaves the whole thing frozen
 *     on every phone and tablet, so with no fine pointer the grid drifts on a
 *     slow sine of its own. Under `prefers-reduced-motion` it doesn't move at
 *     all — the tiles stay as static texture.
 *  4. `window` can't be touched during render (the original seeds a ref from
 *     `window.innerWidth`, which throws in SSR). Everything here happens in an
 *     effect.
 *
 * Also `quickTo` rather than a fresh `gsap.to` per row per frame, which is what
 * the original does — that allocates ~360 tweens a second for a decorative
 * background.
 */

/* 6 × 8 rather than the original's 4 × 7. The grid has to be oversized to cover
   the viewport once it's rotated (see the sizing in globals.css), and at four
   rows that overshoot makes each tile tall enough that only two of them are ever
   on screen — which reads as stripes, not a grid. */
const ROWS = 6;
const COLS = 8;

/** Per-row easing, so the rows trail the pointer by different amounts. */
const INERTIA = [0.6, 0.4, 0.3, 0.2, 0.45, 0.28];

/** How far the outermost rows travel, end to end, at a normal desktop width. */
const MAX_TRAVEL = 280;

/**
 * Which tint each tile gets. A fixed function of the index rather than
 * `Math.random()`, so the server and client render the same markup — and so the
 * distribution stays put between renders instead of reshuffling on every
 * hydration.
 */
function tintFor(index: number) {
  const m = (index * 5) % 11;
  if (m === 0) return "mk-hero-motion-tile--accent";
  if (m < 4) return "mk-hero-motion-tile--brand";
  return "";
}

export function HeroGridMotion() {
  const rowRefs = useRef<(HTMLDivElement | null)[]>([]);
  const reduce = useReducedMotion() ?? false;

  useEffect(() => {
    if (reduce) return;

    const rows = rowRefs.current.filter((r): r is HTMLDivElement => r !== null);
    if (rows.length === 0) return;

    // A background must never be the reason the page drops frames, so the
    // ticker keeps running at its own pace rather than trying to catch up after
    // a long main-thread task.
    gsap.ticker.lagSmoothing(0);

    const setX = rows.map((row, i) =>
      gsap.quickTo(row, "x", {
        duration: 0.8 + INERTIA[i % INERTIA.length],
        ease: "power3.out",
      })
    );

    const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
    let pointerX = window.innerWidth / 2;

    const onPointerMove = (e: PointerEvent) => {
      pointerX = e.clientX;
    };
    if (finePointer) {
      window.addEventListener("pointermove", onPointerMove, { passive: true });
    }

    const start = performance.now();

    const tick = () => {
      // Travel is capped against the viewport as well as in absolute px: 280px
      // of shift is a third of a phone's width, which turns a drift into a
      // lurch.
      const travel = Math.min(MAX_TRAVEL, window.innerWidth * 0.3);
      const seconds = (performance.now() - start) / 1000;
      /* 0…1 across the viewport with a pointer; a slow 18-second round trip
         without one. */
      const norm = finePointer
        ? pointerX / window.innerWidth
        : 0.5 + Math.sin(seconds / 9) * 0.5;

      for (let i = 0; i < setX.length; i += 1) {
        const direction = i % 2 === 0 ? 1 : -1;
        setX[i]((norm * travel - travel / 2) * direction);
      }
    };

    gsap.ticker.add(tick);

    return () => {
      gsap.ticker.remove(tick);
      if (finePointer) window.removeEventListener("pointermove", onPointerMove);
      gsap.killTweensOf(rows);
    };
  }, [reduce]);

  return (
    <div className="mk-hero-motion" aria-hidden>
      <div className="mk-hero-motion-grid">
        {Array.from({ length: ROWS }, (_, rowIndex) => (
          <div
            key={rowIndex}
            className="mk-hero-motion-row"
            ref={(el) => {
              rowRefs.current[rowIndex] = el;
            }}
          >
            {Array.from({ length: COLS }, (_, colIndex) => (
              <span
                key={colIndex}
                className={`mk-hero-motion-tile ${tintFor(rowIndex * COLS + colIndex)}`}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
