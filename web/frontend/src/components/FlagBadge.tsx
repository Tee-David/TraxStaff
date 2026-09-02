"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { flagDescription, flagLabel } from "@/lib/flags";

/**
 * A risk/anomaly flag, with its plain-language explanation on hover, tap or
 * keyboard focus.
 *
 * Two details drive the implementation:
 *
 * 1. **The panel is portalled to `document.body`.** The flags list on the
 *    insights page is a `max-h-64 overflow-y-auto` scroller, so a tooltip
 *    rendered inline is clipped by its own container — which is exactly where
 *    it needs to appear. A portal plus fixed positioning escapes that; the
 *    trade is that the position has to be recomputed on scroll and resize,
 *    which the effect below does.
 *
 * 2. **Hover is not enough.** Hover does not exist on a phone and does not
 *    exist for keyboard users, so the trigger is a real `<button>` that also
 *    responds to click and focus. Click *latches* the panel open so it can be
 *    read without holding the pointer still, and Escape or an outside click
 *    closes it.
 */

/** Distance between the badge and the panel. */
const GAP = 8;
/** Keeps the panel off the very edge of the viewport. */
const MARGIN = 8;
const PANEL_WIDTH = 280;

export default function FlagBadge({ type }: { type: string }) {
  const label = flagLabel(type);
  const description = flagDescription(type);

  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const panelId = useId();

  // `latched` is a click; `hovered` is a pointer or focus. Either opens it, but
  // only a latch survives the pointer leaving.
  const [latched, setLatched] = useState(false);
  const [hovered, setHovered] = useState(false);
  const open = latched || hovered;

  const [pos, setPos] = useState<{ top: number; left: number; above: boolean } | null>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const place = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const panelH = panelRef.current?.offsetHeight ?? 0;

    // Below by default; flip above when the bottom of the viewport is closer
    // than the panel is tall.
    const roomBelow = window.innerHeight - r.bottom;
    const above = panelH > 0 && roomBelow < panelH + GAP + MARGIN && r.top > roomBelow;

    const left = Math.min(
      Math.max(MARGIN, r.left),
      Math.max(MARGIN, window.innerWidth - PANEL_WIDTH - MARGIN)
    );
    setPos({ top: above ? r.top - GAP : r.bottom + GAP, left, above });
  }, []);

  // Layout effect so the panel is positioned in the same frame it appears —
  // otherwise it paints once at the top-left corner and jumps.
  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    place();
    // `true` for the capture phase: the flags list scrolls in its own container,
    // not the window, and a scroll there does not bubble.
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open, place]);

  // Escape closes, and so does a click anywhere outside. Only while latched —
  // a hover-opened panel closes on its own when the pointer leaves.
  useEffect(() => {
    if (!latched) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setLatched(false);
        triggerRef.current?.focus();
      }
    };
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!triggerRef.current?.contains(t) && !panelRef.current?.contains(t)) setLatched(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [latched]);

  // Solid red, white text — a flag is the one thing on this page that should
  // not be mistaken for decoration.
  const badge = (
    <span className="inline-flex items-center rounded-full bg-[var(--color-negative)] px-2.5 py-0.5 text-xs font-semibold text-white">
      {label}
    </span>
  );

  // An unrecognised flag type has no explanation to give, so it renders as a
  // plain badge rather than a control that opens an empty panel.
  if (!description) return badge;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-describedby={open ? panelId : undefined}
        aria-expanded={latched}
        onClick={() => {
          setLatched((v) => !v);
          setHovered(false);
        }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onFocus={() => setHovered(true)}
        onBlur={() => setHovered(false)}
        className="cursor-help rounded-full text-left outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-negative)] focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
      >
        {badge}
      </button>

      {mounted &&
        open &&
        createPortal(
          <div
            ref={panelRef}
            id={panelId}
            role="tooltip"
            style={{
              position: "fixed",
              top: pos?.top ?? -9999,
              left: pos?.left ?? -9999,
              width: PANEL_WIDTH,
              // Flipping above means the panel's *bottom* sits at `top`.
              transform: pos?.above ? "translateY(-100%)" : undefined,
              // Hidden until placed, so it never flashes in the corner.
              visibility: pos ? "visible" : "hidden",
            }}
            className="z-[100] rounded-xl border border-border bg-surface p-3.5 shadow-lg"
          >
            <div className="text-[13px] font-semibold text-ink">{label}</div>
            <p className="mt-1.5 text-[12px] leading-relaxed text-muted">{description}</p>
          </div>,
          document.body
        )}
    </>
  );
}
