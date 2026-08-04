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
  const open = rect !== null;
  const canSearch = searchable ?? options.length > 6;
  const selected = options.find((o) => o.value === value);
  const filtered = q ? options.filter((o) => o.label.toLowerCase().includes(q.toLowerCase())) : options;

  function close() {
    setRect(null);
    setQ("");
  }

  useEffect(() => {
    if (!open) return;
    function outside(e: MouseEvent) {
      const t = e.target as Node;
      if (!btnRef.current?.contains(t) && !panelRef.current?.contains(t)) close();
    }
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    // Fixed coordinates go stale the moment anything scrolls, so close instead
    // of leaving the panel stranded away from its trigger (see ActionMenu).
    document.addEventListener("mousedown", outside);
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("mousedown", outside);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

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
        onClick={() => setRect(open ? null : (btnRef.current?.getBoundingClientRect() ?? null))}
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
              <div className="fixed inset-0 z-40" onClick={close} />
              <div
                ref={panelRef}
                style={{ position: "fixed", ...pos }}
                className="z-50 overflow-hidden rounded-xl border border-border bg-surface py-1 shadow-lift"
              >
                {canSearch && (
                  <div className="px-2 pb-1.5 pt-1">
                    {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
                    <input
                      autoFocus
                      value={q}
                      onChange={(e) => setQ(e.target.value)}
                      placeholder="Search…"
                      className="w-full rounded-lg border border-border bg-canvas px-2.5 py-1.5 text-sm outline-none focus:border-brand"
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
