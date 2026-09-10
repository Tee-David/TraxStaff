import { useEffect, useMemo, useRef, useState } from "react";

/**
 * A branded 24-hour time picker for the tracker.
 *
 * The sibling of DatePicker.tsx, and it exists for the same reason: an
 * `input[type="time"]` is drawn by the webview, so it cannot be styled, and it
 * follows the OS locale rather than the app. On a US-locale Windows box that
 * means a 12-hour AM/PM control sitting next to a date the rest of the app
 * writes as dd/mm/yyyy — two different conventions in one form, on the one
 * screen where getting the time wrong costs a member their hours.
 *
 * Values are "HH:MM" in 24-hour form so callers are unchanged, and typing is
 * never blocked: the field stays a text input, with the dropdown as a shortcut
 * rather than the only way in. Someone who knows they started at 09:20 should
 * not have to scroll to it.
 */

const STEP_MINUTES = 15;

/** Every quarter hour of the day, as "HH:MM". */
function slots(): string[] {
  const out: string[] = [];
  for (let m = 0; m < 24 * 60; m += STEP_MINUTES) {
    out.push(`${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`);
  }
  return out;
}

/**
 * Normalise loose input into "HH:MM", or null if it cannot be read.
 *
 * Accepts what people actually type: "9", "930", "9:3", "9.30", "0930".
 * Rejecting those and blanking the field is how a form loses someone's entry.
 */
export function normalizeTime(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;
  const digits = t.replace(/[^0-9]/g, "");
  let h: number;
  let m: number;
  if (/[:.]/.test(t)) {
    const [hs, ms = "0"] = t.split(/[:.]/);
    h = parseInt(hs, 10);
    m = parseInt(ms.padEnd(2, "0").slice(0, 2), 10);
  } else if (digits.length <= 2) {
    h = parseInt(digits, 10);
    m = 0;
  } else {
    h = parseInt(digits.slice(0, digits.length - 2), 10);
    m = parseInt(digits.slice(-2), 10);
  }
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function TimePicker({
  value,
  onChange,
  ariaLabel,
  id,
}: {
  value: string;
  onChange: (v: string) => void;
  ariaLabel?: string;
  id?: string;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const wrap = useRef<HTMLDivElement>(null);
  const options = useMemo(slots, []);

  // Follow the value when it changes from outside (a reset, or the other field
  // nudging this one), but never while the member is mid-edit.
  useEffect(() => {
    if (!open) setDraft(value);
  }, [value, open]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  /** Commit whatever is in the field, falling back to the last good value. */
  function commit() {
    const norm = normalizeTime(draft);
    if (norm) onChange(norm);
    setDraft(norm ?? value);
  }

  return (
    <div className="tp-wrap" ref={wrap}>
      <input
        id={id}
        className="addtime-input tp-input"
        type="text"
        inputMode="numeric"
        aria-label={ariaLabel}
        value={draft}
        placeholder="HH:MM"
        onChange={(e) => setDraft(e.target.value)}
        onFocus={() => setOpen(true)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
            setOpen(false);
          } else if (e.key === "Escape") {
            setDraft(value);
            setOpen(false);
          }
        }}
      />
      {open && (
        <div className="tp-panel" data-select-panel>
          {options.map((t) => (
            <button
              key={t}
              type="button"
              className={`tp-opt ${t === value ? "is-sel" : ""}`}
              // mousedown, not click: the input's onBlur fires first otherwise
              // and closes the panel out from under the pointer.
              onMouseDown={(e) => {
                e.preventDefault();
                onChange(t);
                setDraft(t);
                setOpen(false);
              }}
            >
              {t}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
