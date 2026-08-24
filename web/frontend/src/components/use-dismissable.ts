"use client";

import { useEffect, useRef, type RefObject } from "react";

/**
 * Close-on-outside-interaction for a portalled popover anchored to a trigger.
 *
 * Extracted because the two row menus (Members, Projects) had each hand-rolled
 * it and both got the mobile case wrong in the same way — while `Select`, three
 * files away, already carried the fix and the explanation. One copy, so the next
 * popover inherits the fix instead of the bug.
 *
 * The mobile case, which is the whole reason this is not four lines:
 *
 *   - `resize` fires constantly on a phone that is doing nothing unusual. The
 *     URL bar retracts as you scroll, the on-screen keyboard opens, the page
 *     zooms — all of them resize the visual viewport, and a menu that closes on
 *     any resize closes itself immediately after opening. That is why tapping
 *     "⋯" on a phone appeared to do nothing at all. Only a real WIDTH change
 *     (a rotation, a genuine window resize) invalidates the anchored position;
 *     height-only changes are ignored.
 *
 *   - A tap dispatches a whole sequence after the one that opened the menu
 *     (mousedown/mouseup/click, plus scroll and resize as the chrome moves), and
 *     any of them arriving late reads as "the user dismissed this" before they
 *     have seen it. Dismissals are ignored for a moment after opening — short
 *     enough to be invisible to a real click-away.
 *
 *   - Scrolling *inside* the popover is not a dismissal. Without this, a menu
 *     with its own scrollbar closes the instant you try to scroll it.
 */

/** How long after opening dismissals are ignored. */
const GRACE_MS = 350;

/** A width change smaller than this is the browser chrome moving, not a resize. */
const WIDTH_NOISE_PX = 40;

export function useDismissable(
  open: boolean,
  close: () => void,
  refs: { trigger: RefObject<HTMLElement | null>; panel: RefObject<HTMLElement | null> }
) {
  const openedAt = useRef(0);
  const openWidth = useRef(0);

  // Stamped when the popover opens, so the grace period is measured from the
  // gesture that opened it rather than from the first render after it.
  useEffect(() => {
    if (!open) return;
    openedAt.current = Date.now();
    openWidth.current = window.innerWidth;
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const settled = () => Date.now() - openedAt.current >= GRACE_MS;

    function outside(e: MouseEvent) {
      const t = e.target as Node;
      if (refs.trigger.current?.contains(t) || refs.panel.current?.contains(t)) return;
      if (!settled()) return;
      close();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    function onScroll(e: Event) {
      const t = e.target as Node | null;
      if (t && refs.panel.current?.contains(t)) return;
      if (!settled()) return;
      close();
    }
    function onResize() {
      if (Math.abs(window.innerWidth - openWidth.current) > WIDTH_NOISE_PX) close();
    }

    document.addEventListener("mousedown", outside);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("mousedown", outside);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [open, close, refs.trigger, refs.panel]);
}
