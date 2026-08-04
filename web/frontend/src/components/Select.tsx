"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export type Option = { value: string; label: string };

/**
 * Custom dropdown. The option panel is portaled to `document.body` with fixed
 * coordinates taken from the trigger's own rect — the same fix `ActionMenu`
 * (members/page.tsx) uses for the identical problem. `Select` sits inside
 * tables/cards with `overflow-hidden` / `overflow-x-auto` ancestors (member
 * rows, project rows); an absolutely positioned child gets clipped by those,
 * silently hiding whichever options fall past the clip line — e.g. the role
 * dropdown rendering "Member" but cutting off "Admin" beneath it.
 */
export function Select({
  value,
  onChange,
  options,
  placeholder = "Select…",
  searchable,
  className = "",
  align = "left",
  minWidth = 200,
}: {
  value: string;
  onChange: (v: string) => void;
  options: Option[];
  placeholder?: string;
  searchable?: boolean;
  className?: string;
  align?: "left" | "right";
  minWidth?: number;
}) {
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [q, setQ] = useState("");
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  // Viewport width at the moment the panel opened — see the resize handler.
  const openWidth = useRef(0);
  // When it opened, so the tail of the opening tap can be ignored.
  const openedAt = useRef(0);
  const open = rect !== null;
  const canSearch = searchable ?? options.length > 6;
  const selected = options.find((o) => o.value === value);
  const filtered = q ? options.filter((o) => o.label.toLowerCase().includes(q.toLowerCase())) : options;

  function close() {
    setRect(null);
    setQ("");
  }

  function toggle() {
    // The synthesized click a touch screen sends after touchend lands back on
    // this same button, so a plain toggle closed the list in the same gesture
    // that opened it — the dropdown could not be opened on a phone at all.
    // Closing by tapping the trigger again still works; it just has to be a
    // separate tap rather than the tail of the opening one.
    if (open) return closeUnlessJustOpened();
    openWidth.current = window.innerWidth;
    openedAt.current = Date.now();
    setRect(btnRef.current?.getBoundingClientRect() ?? null);
  }

  /**
   * Ignore dismissals for a moment after opening. A tap on a touch screen
   * produces a whole sequence of events after the one that opened the list
   * (mousedown/mouseup/click, plus scroll and resize as the keyboard or URL bar
   * move), and any of them arriving late reads as "the user dismissed this"
   * when they have not even seen the list yet. Short enough to be invisible for
   * a genuine click-away.
   */
  const GRACE_MS = 350;
  function closeUnlessJustOpened() {
    if (Date.now() - openedAt.current < GRACE_MS) return;
    close();
  }

  useEffect(() => {
    if (!open) return;
    function outside(e: MouseEvent) {
      const t = e.target as Node;
      if (!btnRef.current?.contains(t) && !panelRef.current?.contains(t)) closeUnlessJustOpened();
    }
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();

    // Fixed coordinates go stale the moment the page scrolls, so close rather
    // than leave the panel stranded away from its trigger (see ActionMenu).
    // Scrolling *inside* the panel's own option list is not that, and used to
    // dismiss the list the moment you tried to scroll it.
    function onScroll(e: Event) {
      const t = e.target as Node | null;
      if (t && panelRef.current?.contains(t)) return;
      closeUnlessJustOpened();
    }

    // Only a real width change (rotation, window resize) invalidates the
    // position. On a phone the panel was closing the instant it opened: tapping
    // the search field pops up the keyboard and — on iOS, for any field under
    // 16px — zooms the page, both of which fire `resize`. So the dropdown
    // appeared to "go off every time you click", and the page appeared to zoom
    // in for no reason. Height-only changes are now ignored, and the field is
    // 16px on small screens so iOS has no reason to zoom at all.
    function onResize() {
      if (Math.abs(window.innerWidth - openWidth.current) > 40) closeUnlessJustOpened();
    }

    document.addEventListener("mousedown", outside);
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("mousedown", outside);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [open]);

  // Focus the search field with a pointer, but never on touch: raising the
  // keyboard unprompted covers the options the user opened the list to read.
  useEffect(() => {
    if (!open || !canSearch) return;
    if (window.matchMedia("(pointer: coarse)").matches) return;
    searchRef.current?.focus();
  }, [open, canSearch]);

  const estimatedHeight = (canSearch ? 46 : 0) + Math.min(Math.max(filtered.length, 1), 6) * 36 + 16;

  /**
   * Horizontal placement is clamped to the viewport, and the panel is given the
   * width that is actually left over on the side it opens toward. Without the
   * cap, `minWidth` plus a long option (a member's full email) pushed the panel
   * past the right edge on a phone, where it simply could not be read or
   * scrolled to. `maxWidth` + the options' own `truncate` keeps it on-screen at
   * any width instead.
   */
  const GUTTER = 8;
  const pos = rect
    ? (() => {
        const vw = window.innerWidth;
        // Room from the panel's anchored edge to the opposite gutter.
        const room = align === "right" ? rect.right - GUTTER : vw - rect.left - GUTTER;
        const width = Math.max(120, Math.min(minWidth, vw - GUTTER * 2));
        return {
          ...(align === "right"
            ? { right: Math.max(GUTTER, Math.min(vw - rect.right, vw - GUTTER - width)) }
            : { left: Math.max(GUTTER, Math.min(rect.left, vw - GUTTER - width)) }),
          ...(rect.bottom + 6 + estimatedHeight > window.innerHeight
            ? { bottom: window.innerHeight - rect.top + 6 }
            : { top: rect.bottom + 6 }),
          minWidth: width,
          maxWidth: Math.max(width, room),
        };
      })()
    : null;

  return (
    <div className={`inline-block ${className}`}>
      <button
        ref={btnRef}
        type="button"
        onClick={toggle}
        className="inline-flex items-center gap-2 rounded-lg border border-border bg-surface px-3.5 py-2 text-sm font-medium outline-none transition hover:border-border-strong focus:border-brand"
      >
        <span className={selected ? "" : "text-muted"}>{selected?.label ?? placeholder}</span>
        <svg
          width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          className={`text-faint transition-transform ${open ? "rotate-180" : ""}`}
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {typeof document !== "undefined" &&
        createPortal(
          open && pos ? (
            <>
              {/* Deliberately no full-screen click-away overlay here.
                  One used to be rendered at `fixed inset-0` — i.e. directly
                  under the finger that had just opened the list — and a tap on
                  a touch screen dispatches a synthesized click after touchend,
                  at the same coordinates. That click landed on the overlay that
                  had appeared mid-tap and closed the list instantly, so the
                  dropdown could not be opened on a phone at all. Click-away is
                  handled by the document `mousedown` listener above, which is
                  also all `ActionMenu` has ever used — and those menus never
                  had this problem. */}
              <div
                ref={panelRef}
                style={{ position: "fixed", ...pos }}
                className="z-50 overflow-hidden rounded-xl border border-border bg-surface py-1 shadow-lift"
              >
                {canSearch && (
                  <div className="px-2 pb-1.5 pt-1">
                    {/* 16px on small screens: iOS zooms the page whenever a
                        focused field is smaller than that. */}
                    <input
                      ref={searchRef}
                      value={q}
                      onChange={(e) => setQ(e.target.value)}
                      placeholder="Search…"
                      className="w-full rounded-lg border border-border bg-canvas px-2.5 py-1.5 text-[16px] outline-none focus:border-brand sm:text-sm"
                    />
                  </div>
                )}
                <div className="max-h-60 overflow-y-auto">
                  {filtered.length === 0 && <div className="px-3.5 py-2 text-sm text-muted">No matches</div>}
                  {filtered.map((o) => (
                    <button
                      key={o.value}
                      type="button"
                      onClick={() => { onChange(o.value); close(); }}
                      className={`flex w-full items-center justify-between gap-3 px-3.5 py-2 text-left text-sm transition hover:bg-canvas ${
                        o.value === value ? "font-semibold text-brand" : ""
                      }`}
                    >
                      <span className="truncate">{o.label}</span>
                      {o.value === value && <span className="text-brand">✓</span>}
                    </button>
                  ))}
                </div>
              </div>
            </>
          ) : null,
          document.body
        )}
    </div>
  );
}
