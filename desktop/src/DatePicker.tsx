import { useEffect, useMemo, useRef, useState } from "react";

// A branded date picker for the tracker.
//
// Replaces `input[type="date"]`, which renders WebView2's native calendar —
// unstyled, off-brand, and visually inconsistent between the desktop app and
// the web dashboard. This is the same month-grid pattern used on the web side.
//
// Values are ISO date strings (YYYY-MM-DD) so callers are unchanged.

const DOW = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function toISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Parse YYYY-MM-DD as a *local* date. `new Date("2026-07-28")` parses as UTC,
 *  which shifts the day backwards for anyone west of Greenwich. */
function fromISO(s: string | undefined): Date | null {
  if (!s) return null;
  const [y, m, d] = s.split("-").map((n) => parseInt(n, 10));
  if (!y || !m || !d) return null;
  const dt = new Date(y, m - 1, d);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function sameDay(a: Date | null, b: Date | null): boolean {
  return !!a && !!b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** Monday-first weekday index of the 1st of the month. */
function startOffset(year: number, month: number): number {
  const dow = new Date(year, month, 1).getDay(); // 0=Sun
  return dow === 0 ? 6 : dow - 1;
}

function daysIn(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

function fmtLabel(d: Date | null, placeholder: string): string {
  if (!d) return placeholder;
  return d.toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" });
}

export function DatePicker({
  value,
  onChange,
  min,
  max,
  placeholder = "Pick a date",
}: {
  value?: string;
  onChange: (iso: string | undefined) => void;
  min?: string;
  max?: string;
  placeholder?: string;
}) {
  const selected = fromISO(value);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<Date>(selected ?? new Date());
  const wrap = useRef<HTMLDivElement>(null);

  const minDate = fromISO(min);
  const maxDate = fromISO(max);

  // Re-centre on the selected month each time the panel opens.
  useEffect(() => {
    if (open) setView(selected ?? new Date());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const cells = useMemo(() => {
    const y = view.getFullYear();
    const m = view.getMonth();
    const lead = startOffset(y, m);
    const count = daysIn(y, m);
    const out: (Date | null)[] = [];
    for (let i = 0; i < lead; i++) out.push(null);
    for (let d = 1; d <= count; d++) out.push(new Date(y, m, d));
    return out;
  }, [view]);

  const today = new Date();

  // Bounds precomputed ONCE. `Date.prototype.setHours` mutates the receiver and
  // returns a timestamp, so calling it inside the per-cell predicate silently
  // walked minDate/maxDate forward on every render — days drifted in and out of
  // range as the grid drew.
  const minMs = minDate ? new Date(minDate).setHours(0, 0, 0, 0) : null;
  const maxMs = maxDate ? new Date(maxDate).setHours(23, 59, 59, 999) : null;
  const disabled = (d: Date) =>
    (minMs !== null && d.getTime() < minMs) || (maxMs !== null && d.getTime() > maxMs);

  const shift = (months: number) =>
    setView(new Date(view.getFullYear(), view.getMonth() + months, 1));

  return (
    <div className="dp" ref={wrap}>
      <button
        type="button"
        className={`dp-trigger ${open ? "on" : ""}`}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden>
          <rect x="3" y="5" width="18" height="16" rx="2.5" />
          <path d="M3 10h18M8 3v4M16 3v4" />
        </svg>
        <span className={selected ? "" : "dp-ph"}>{fmtLabel(selected, placeholder)}</span>
      </button>

      {open && (
        <div className="dp-panel" role="dialog" aria-label="Choose date">
          <div className="dp-head">
            <button type="button" className="dp-nav" onClick={() => shift(-1)} aria-label="Previous month">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M15 6l-6 6 6 6" /></svg>
            </button>
            <div className="dp-title">{MONTHS[view.getMonth()]} {view.getFullYear()}</div>
            <button type="button" className="dp-nav" onClick={() => shift(1)} aria-label="Next month">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M9 6l6 6-6 6" /></svg>
            </button>
          </div>

          <div className="dp-dow">
            {DOW.map((d) => <span key={d}>{d}</span>)}
          </div>

          <div className="dp-grid">
            {cells.map((d, i) =>
              d === null ? (
                // Leading blanks are pure spacers — they must NOT carry .dp-cell,
                // whose sizing/hover/outline rules made them render as boxes.
                <span key={`e${i}`} className="dp-pad" aria-hidden />
              ) : (
                <button
                  key={toISO(d)}
                  type="button"
                  className={[
                    "dp-cell",
                    sameDay(d, selected) ? "sel" : "",
                    sameDay(d, today) ? "today" : "",
                  ].filter(Boolean).join(" ")}
                  disabled={disabled(new Date(d))}
                  onClick={() => { onChange(toISO(d)); setOpen(false); }}
                >
                  {d.getDate()}
                </button>
              )
            )}
          </div>

          <div className="dp-foot">
            <button type="button" className="dp-link" onClick={() => { onChange(undefined); setOpen(false); }}>Clear</button>
            <button
              type="button"
              className="dp-link primary"
              onClick={() => { const t = new Date(); onChange(toISO(t)); setView(t); setOpen(false); }}
            >
              Today
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
