"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { IconInfo } from "@/components/icons";
import { flagDescription, flagLabel } from "@/lib/flags";

/**
 * A risk/anomaly flag: a solid red pill with an ⓘ at the end of the label, and
 * the plain-language explanation on hover, tap or keyboard focus.
 *
 * The ⓘ is the trigger, not the whole pill. That distinction is the point of it
 * being there: a badge that silently reacts to hover gives the reader nothing to
 * aim at and no reason to think anything would happen, whereas an info glyph is
 * the one control everybody already knows means "there is more to read here".
 *
 * Two implementation details carry weight:
 *
 * 1. **The panel is portalled to `document.body`.** The flags list on the
 *    insights page is a `overflow-y-auto` scroller, so a tooltip rendered inline
 *    is clipped by the very container it needs to escape. A portal plus fixed
 *    positioning gets out; the cost is recomputing position on scroll and
 *    resize, which the effect below does on the capture phase (the list scrolls
 *    itself, and that scroll does not bubble to the window).
 *
 * 2. **Hover alone is not enough.** It does not exist on a phone and does not
 *    exist for keyboard users, so the trigger is a real `<button>` that also
 *    answers to click and focus. A click *latches* the panel open so it can be
 *    read without holding the pointer still; Escape or an outside click closes.
 */

/** Gap between the trigger and the panel — the tail lives in this space. */
const GAP = 10;
/** Keeps the panel off the very edge of the viewport. */
const MARGIN = 8;
const PANEL_WIDTH = 300;
/** Half the tail square's diagonal, so the panel edge hides its inner half. */
const TAIL = 7;

export default function FlagBadge({ type }: { type: string }) {
  const label = flagLabel(type);
  const description = flagDescription(type);

  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const panelId = useId();

  const [latched, setLatched] = useState(false);
  const [hovered, setHovered] = useState(false);
  const open = latched || hovered;

  const [pos, setPos] = useState<{ top: number; left: number; above: boolean; tailX: number } | null>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const place = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const panelH = panelRef.current?.offsetHeight ?? 0;

    // Below by default; flip above only when there is genuinely more room up
    // there, so a flag near the bottom of the list still shows its whole panel.
    const roomBelow = window.innerHeight - r.bottom;
    const above = panelH > 0 && roomBelow < panelH + GAP + MARGIN && r.top > roomBelow;

    // Centre the panel on the trigger, then pull it back inside the viewport.
    const centreX = r.left + r.width / 2;
    const left = Math.min(
      Math.max(MARGIN, centreX - PANEL_WIDTH / 2),
      Math.max(MARGIN, window.innerWidth - PANEL_WIDTH - MARGIN)
    );

    // The tail keeps pointing at the trigger even after that clamp moved the
    // panel — but never so far that it hangs off the panel's rounded corner.
    const tailX = Math.min(Math.max(centreX - left, 18), PANEL_WIDTH - 18);

    setPos({ top: above ? r.top - GAP : r.bottom + GAP, left, above, tailX });
  }, []);

  // Layout effect so the panel is positioned in the frame it appears, rather
  // than painting once in the corner and jumping.
  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open, place]);

  // Escape and outside clicks close a latched panel. A hover-opened one closes
  // on its own when the pointer leaves, so it needs neither.
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

  // An unrecognised flag type has no explanation to offer, so it gets a plain
  // pill with no ⓘ rather than a control that opens an empty panel.
  if (!description) {
    return (
      <span className="inline-flex items-center rounded-full bg-[var(--color-negative)] px-2.5 py-0.5 text-xs font-semibold text-white">
        {label}
      </span>
    );
  }

  return (
    <>
      <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--color-negative)] py-0.5 pl-2.5 pr-1.5 text-xs font-semibold text-white">
        {label}
        <button
          ref={triggerRef}
          type="button"
          aria-label={`What "${label}" means`}
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
          className="flex h-4 w-4 items-center justify-center rounded-full text-white outline-none transition hover:text-[var(--color-negative-soft)] focus-visible:ring-2 focus-visible:ring-white"
        >
          <IconInfo width={13} height={13} strokeWidth={2.2} />
        </button>
      </span>

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
              // Flipped above means the panel's bottom edge sits at `top`.
              transform: pos?.above ? "translateY(-100%)" : undefined,
              // Hidden until measured, so it never flashes in the corner.
              visibility: pos ? "visible" : "hidden",
            }}
            className="z-[100] rounded-2xl bg-[var(--color-tooltip)] p-4 text-[var(--color-tooltip-fg)] shadow-xl"
          >
            {/* The tail. A rotated square tucked half under the panel, so its two
                outer edges read as a point and the seam is covered. */}
            <span
              aria-hidden
              style={{
                position: "absolute",
                left: pos?.tailX ?? 0,
                [pos?.above ? "bottom" : "top"]: -TAIL,
                width: TAIL * 2,
                height: TAIL * 2,
                marginLeft: -TAIL,
              }}
              className="rotate-45 rounded-[3px] bg-[var(--color-tooltip)]"
            />
            <div className="relative text-[13px] font-semibold">{label}</div>
            <p className="relative mt-1.5 text-[12px] leading-relaxed text-[var(--color-tooltip-fg-muted)]">
              {description}
            </p>
          </div>,
          document.body
        )}
    </>
  );
}
