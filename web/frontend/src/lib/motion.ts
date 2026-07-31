"use client";

import { useMemo } from "react";
import { useReducedMotion, type Transition, type Variants } from "motion/react";

/**
 * Shared motion vocabulary. Two rules hold everywhere:
 *
 * 1. Only `transform` and `opacity` are animated — anything else (height, top,
 *    box-shadow, filter) forces layout or paint on every frame.
 * 2. `prefers-reduced-motion` collapses every movement to a plain opacity fade
 *    at zero duration. The CSS already honours the query; this extends it into
 *    JS, which the ~40 existing Framer animations were bypassing.
 *
 * Durations stay in the 150–250ms band: fast enough to read as responsiveness
 * rather than decoration.
 */
export const EASE: Transition["ease"] = [0.22, 0.61, 0.36, 1];

export function useMotionPresets() {
  const reduce = useReducedMotion() ?? false;

  return useMemo(() => {
    const dur = reduce ? 0 : 0.2;
    const shift = reduce ? 0 : 8;
    const transition: Transition = { duration: dur, ease: EASE };

    const listItem: Variants = {
      hidden: { opacity: 0, y: shift },
      show: { opacity: 1, y: 0, transition },
    };

    return {
      reduce,
      transition,

      /** Whole-page / tab-panel entrance. */
      page: {
        initial: { opacity: 0, y: shift },
        animate: { opacity: 1, y: 0 },
        exit: { opacity: 0, y: reduce ? 0 : -shift },
        transition,
      },

      /** Spread on the wrapper of a staggered list or card grid. */
      stagger: (delayChildren = 0) => ({
        initial: "hidden" as const,
        animate: "show" as const,
        variants: {
          hidden: {},
          show: { transition: { staggerChildren: reduce ? 0 : 0.03, delayChildren: reduce ? 0 : delayChildren } },
        } satisfies Variants,
      }),

      /** Spread on each child of a `stagger` or `revealStagger` wrapper. */
      item: { variants: listItem },

      /**
       * Scroll-triggered entrance for a single block — a section heading, a
       * panel. Unlike `page`/`stagger`, which run on mount, this waits until
       * the block actually reaches the viewport, so a long marketing page
       * reveals as you scroll instead of having every section below the fold
       * finish animating before anyone sees it.
       *
       * `once: true` means it never replays on scroll-back, which reads as
       * twitchy. `amount` is low so tall blocks trigger as they arrive rather
       * than only once a quarter of them is showing. Movement is a little
       * larger than `page` because it has room to travel here.
       */
      reveal: {
        initial: { opacity: 0, y: reduce ? 0 : shift * 1.75 },
        whileInView: { opacity: 1, y: 0 },
        viewport: { once: true, amount: 0.15 },
        transition: { duration: reduce ? 0 : 0.45, ease: EASE },
      },

      /**
       * Fade-up for an individual element inside a revealed section — an
       * eyebrow, a heading, a paragraph, a card. Travels further and runs
       * longer than `item`, which is tuned for dense dashboard lists where
       * movement that size would be noise. Pair with `revealStagger`.
       */
      revealItem: {
        variants: {
          hidden: { opacity: 0, y: reduce ? 0 : 24 },
          show: {
            opacity: 1,
            y: 0,
            transition: { duration: reduce ? 0 : 0.5, ease: EASE },
          },
        } satisfies Variants,
      },

      /**
       * Scroll-triggered version of `stagger`, for grids and card rows. Pair
       * with `item` on the children exactly as with `stagger`.
       */
      revealStagger: (delayChildren = 0) => ({
        initial: "hidden" as const,
        whileInView: "show" as const,
        viewport: { once: true, amount: 0.15 },
        variants: {
          hidden: {},
          show: {
            transition: {
              staggerChildren: reduce ? 0 : 0.07,
              delayChildren: reduce ? 0 : delayChildren,
            },
          },
        } satisfies Variants,
      }),

      /**
       * Press feedback for a button or link. Hover lifts, press settles —
       * the pair reads as a physical control rather than a colour swap, and
       * it is the only feedback a touch user gets, since they never hover.
       */
      press: reduce
        ? {}
        : {
            whileHover: { y: -2 },
            whileTap: { scale: 0.97, y: 0 },
            transition: { duration: 0.15, ease: EASE },
          },

      /** Modal/lightbox backdrop. */
      backdrop: {
        initial: { opacity: 0 },
        animate: { opacity: 1 },
        exit: { opacity: 0 },
        transition: { duration: reduce ? 0 : 0.15 },
      },

      /** Modal/lightbox panel. */
      dialog: {
        initial: { opacity: 0, scale: reduce ? 1 : 0.96, y: reduce ? 0 : 12 },
        animate: { opacity: 1, scale: 1, y: 0 },
        exit: { opacity: 0, scale: reduce ? 1 : 0.96, y: reduce ? 0 : 12 },
        transition: { duration: reduce ? 0 : 0.18, ease: EASE },
      },

      /** Toast / inline notice. */
      toast: {
        initial: { opacity: 0, y: reduce ? 0 : 10, scale: reduce ? 1 : 0.98 },
        animate: { opacity: 1, y: 0, scale: 1 },
        exit: { opacity: 0, y: reduce ? 0 : 10, scale: reduce ? 1 : 0.98 },
        transition: { duration: reduce ? 0 : 0.18, ease: EASE },
      },

      /** Hover/tap affordance for cards and tiles. */
      hover: reduce ? {} : { whileHover: { y: -2 }, whileTap: { scale: 0.99 }, transition },
    };
  }, [reduce]);
}
