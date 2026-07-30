"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { HelpCircle, Compass, Sparkles, MousePointerClick } from "lucide-react";
import { useTour } from "./tour-provider";
import { prefersReducedMotion } from "./wait-for-target";

const OPENED_KEY = "trax:tour:launcher-opened";

/**
 * Round "?" help button for the topbar. It does a gentle idle wiggle every few
 * seconds to hint that a guided tour is available — paused on hover, once the
 * user has opened it, and when reduced-motion is requested. Clicking opens a
 * small popover with the available tours for the current page.
 *
 * This is the resumable entry point: reachable from every page (it lives in
 * `app/template.tsx`'s shared header, not on any one page), so a first-run
 * auto-tour is never the only way to see it again.
 */
export function TourLauncher() {
  const { startPageTour, startWalkthrough, startWelcome, hasPageTour } = useTour();

  const [open, setOpen] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [opened, setOpened] = useState(true); // assume opened until we read storage (no wiggle during SSR/hydration)
  const [reduced, setReduced] = useState(true);
  const [canPage, setCanPage] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setReduced(prefersReducedMotion());
    try {
      setOpened(localStorage.getItem(OPENED_KEY) === "1");
    } catch {
      setOpened(true);
    }
  }, []);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  function markOpened() {
    setOpened(true);
    try {
      localStorage.setItem(OPENED_KEY, "1");
    } catch {}
  }

  function toggle() {
    setOpen((o) => {
      const next = !o;
      if (next) {
        markOpened();
        setCanPage(hasPageTour());
      }
      return next;
    });
  }

  function run(fn: () => void) {
    setOpen(false);
    fn();
  }

  const wiggling = !reduced && !opened && !hovered && !open;

  return (
    <div className="relative" ref={ref}>
      <motion.button
        type="button"
        aria-label="Guided tours"
        aria-haspopup="menu"
        aria-expanded={open}
        data-tour="tour-launcher"
        onClick={toggle}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        className="grid h-9 w-9 place-items-center rounded-full text-muted transition hover:bg-canvas hover:text-ink"
        animate={wiggling ? { rotate: [0, -12, 11, -7, 6, 0], scale: [1, 1.09, 1] } : { rotate: 0, scale: 1 }}
        transition={
          wiggling
            ? { duration: 0.85, repeat: Infinity, repeatDelay: 8.2, ease: "easeInOut" }
            : { duration: 0.2 }
        }
      >
        <HelpCircle className="size-[18px]" />
      </motion.button>

      {open && (
        <div
          role="menu"
          className="fixed inset-x-3 top-16 z-50 overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface p-1.5 shadow-[var(--shadow-lift)] sm:absolute sm:inset-x-auto sm:right-0 sm:top-auto sm:mt-2 sm:w-64"
        >
          <div className="px-3 py-2">
            <p className="text-sm font-semibold text-ink">Guided tours</p>
            <p className="mt-0.5 text-xs text-muted">Take a quick, friendly walk-through.</p>
          </div>
          <div className="my-1 h-px bg-border" />

          <button
            type="button"
            role="menuitem"
            disabled={!canPage}
            onClick={() => run(startPageTour)}
            className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium transition ${
              canPage ? "text-ink hover:bg-canvas" : "cursor-not-allowed text-muted opacity-60"
            }`}
          >
            <MousePointerClick className="size-4 text-muted" />
            Tour this page
          </button>

          <button
            type="button"
            role="menuitem"
            onClick={() => run(startWalkthrough)}
            className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium text-ink transition hover:bg-canvas"
          >
            <Compass className="size-4 text-muted" />
            Take the full tour
          </button>

          <button
            type="button"
            role="menuitem"
            onClick={() => run(startWelcome)}
            className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium text-ink transition hover:bg-canvas"
          >
            <Sparkles className="size-4 text-muted" />
            Replay welcome
          </button>
        </div>
      )}
    </div>
  );
}
