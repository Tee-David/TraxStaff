"use client";

import { useEffect, useRef, useState } from "react";

export type Option = { value: string; label: string };

/**
 * Custom dropdown: content-width trigger (tight label→chevron gap, proper
 * height) with an optional search box. Falls back to searchable automatically
 * once the list is long. Closes on click-away or Escape.
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
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const canSearch = searchable ?? options.length > 6;
  const selected = options.find((o) => o.value === value);
  const filtered = q ? options.filter((o) => o.label.toLowerCase().includes(q.toLowerCase())) : options;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className={`relative inline-block ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
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
      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          <div
            className={`absolute z-30 mt-1.5 overflow-hidden rounded-xl border border-border bg-surface py-1 shadow-lift ${align === "right" ? "right-0" : "left-0"}`}
            style={{ minWidth }}
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
                  onClick={() => { onChange(o.value); setOpen(false); setQ(""); }}
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
      )}
    </div>
  );
}
