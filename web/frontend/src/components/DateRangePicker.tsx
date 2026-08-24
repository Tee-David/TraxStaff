"use client";

import { useState, useRef, useEffect } from "react";
import { IconCalendar, IconChevron } from "./icons";

// Basic date math utilities
function getDaysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}

function getStartDayOfMonth(year: number, month: number) {
  const day = new Date(year, month, 1).getDay();
  // We want Monday=0, Sunday=6
  return day === 0 ? 6 : day - 1;
}

function isSameDay(d1?: Date | null, d2?: Date | null) {
  if (!d1 || !d2) return false;
  return d1.getFullYear() === d2.getFullYear() &&
         d1.getMonth() === d2.getMonth() &&
         d1.getDate() === d2.getDate();
}

function isBefore(d1: Date, d2: Date) {
  return d1.getTime() < d2.getTime();
}

function isAfter(d1: Date, d2: Date) {
  return d1.getTime() > d2.getTime();
}

function formatDate(date: Date) {
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function formatInputDate(date: Date) {
  return `${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}/${date.getFullYear()}`;
}

function parseInputDate(str: string): Date | null {
  const parts = str.split('/');
  if (parts.length !== 3) return null;
  const m = parseInt(parts[0], 10);
  const d = parseInt(parts[1], 10);
  const y = parseInt(parts[2], 10);
  if (isNaN(m) || isNaN(d) || isNaN(y)) return null;
  const date = new Date(y, m - 1, d);
  if (date.getMonth() !== m - 1) return null;
  return date;
}

const PRESETS = [
  { id: "today", label: "Today" },
  { id: "yesterday", label: "Yesterday" },
  { id: "week", label: "This week" },
  { id: "last_week", label: "Last week" },
  { id: "month", label: "This month" },
  { id: "last_month", label: "Last month" },
  { id: "year", label: "This year" },
  { id: "last_year", label: "Last year" },
  { id: "all", label: "All time" },
] as const;

export type PresetKey = typeof PRESETS[number]["id"];

export type DateRangeValue = 
  | { type: "preset"; preset: PresetKey }
  | { type: "custom"; from: Date; to: Date };

export function DateRangePicker({
  value,
  onChange,
}: {
  value: DateRangeValue;
  onChange: (val: DateRangeValue) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const [currentMonthDate, setCurrentMonthDate] = useState(new Date());

  const [tempType, setTempType] = useState<"preset" | "custom">(value.type);
  const [tempPreset, setTempPreset] = useState<PresetKey>(value.type === "preset" ? value.preset : "week");
  const [tempFrom, setTempFrom] = useState<Date | null>(value.type === "custom" ? value.from : null);
  const [tempTo, setTempTo] = useState<Date | null>(value.type === "custom" ? value.to : null);
  
  const [hoverDate, setHoverDate] = useState<Date | null>(null);
  const [picking, setPicking] = useState<"from" | "to" | null>(null);

  // Only one month is rendered below `md`, so that month needs its own
  // forward arrow. Tracked in state rather than read from `window` during
  // render: that is not available while prerendering, and a bare read never
  // updates when the window is resized or the device rotated.
  const [isNarrow, setIsNarrow] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const sync = () => setIsNarrow(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) {
      setTempType(value.type);
      if (value.type === "preset") {
        setTempPreset(value.preset);
        setTempFrom(null);
        setTempTo(null);
      } else {
        setTempFrom(value.from);
        setTempTo(value.to);
        setCurrentMonthDate(new Date(value.from));
      }
      setPicking("from");
    }
  }, [isOpen, value]);

  const handleApply = () => {
    if (tempType === "preset") {
      onChange({ type: "preset", preset: tempPreset });
    } else {
      if (tempFrom && tempTo) {
        onChange({ type: "custom", from: tempFrom, to: tempTo });
      } else if (tempFrom) {
        onChange({ type: "custom", from: tempFrom, to: tempFrom });
      }
    }
    setIsOpen(false);
  };

  const getLabel = () => {
    if (value.type === "preset") {
      return PRESETS.find((p) => p.id === value.preset)?.label ?? "Custom";
    }
    return `${formatDate(value.from)} – ${formatDate(value.to)}`;
  };

  const renderCalendar = (monthOffset: number) => {
    const date = new Date(currentMonthDate.getFullYear(), currentMonthDate.getMonth() + monthOffset, 1);
    const year = date.getFullYear();
    const month = date.getMonth();
    const daysInMonth = getDaysInMonth(year, month);
    const startDay = getStartDayOfMonth(year, month);

    const monthName = date.toLocaleDateString("en-US", { month: "long" });

    const days = [];
    for (let i = 0; i < startDay; i++) {
      days.push(<div key={`empty-${i}`} className="h-10 w-full md:h-8" />);
    }

    for (let d = 1; d <= daysInMonth; d++) {
      const currentDay = new Date(year, month, d);
      
      let isSelected = false;
      let isBetween = false;
      let isFrom = false;
      let isTo = false;

      if (tempType === "custom" && tempFrom) {
        if (tempTo) {
          isFrom = isSameDay(currentDay, tempFrom);
          isTo = isSameDay(currentDay, tempTo);
          isSelected = isFrom || isTo;
          isBetween = isAfter(currentDay, tempFrom) && isBefore(currentDay, tempTo);
        } else if (hoverDate) {
          isFrom = isSameDay(currentDay, tempFrom);
          const rangeStart = isBefore(hoverDate, tempFrom) ? hoverDate : tempFrom;
          const rangeEnd = isBefore(hoverDate, tempFrom) ? tempFrom : hoverDate;
          isBetween = isAfter(currentDay, rangeStart) && isBefore(currentDay, rangeEnd);
          isSelected = isFrom || isSameDay(currentDay, hoverDate);
        } else {
          isFrom = isSameDay(currentDay, tempFrom);
          isSelected = isFrom;
        }
      }

      /**
       * Two layers, because the cell and the mark want different shapes.
       *
       * The button fills its grid track so a selected range reads as one
       * continuous bar — cells narrower than the track leave gaps in it, which
       * is what the old fixed-width cells did even on desktop. The circle
       * around a chosen day then lives on an inner square, so it stays a circle
       * instead of stretching into a pill on a phone where the track is wide.
       */
      const trackClass = isBetween ? "bg-brand/10" : "";
      const markClass = isSelected
        ? "bg-brand text-white"
        : "text-ink hover:bg-canvas";

      days.push(
        <button
          key={d}
          // 40px tall on a phone rather than 28: a date grid is the densest
          // tap target in the app, and 28px is well under what a thumb hits
          // reliably.
          className={`flex h-10 w-full items-center justify-center transition-colors md:h-8 ${trackClass}`}
          onClick={() => {
            setTempType("custom");
            if (picking === "from" || !tempFrom) {
              setTempFrom(currentDay);
              setTempTo(null);
              setPicking("to");
            } else {
              if (isBefore(currentDay, tempFrom)) {
                setTempTo(tempFrom);
                setTempFrom(currentDay);
              } else {
                setTempTo(currentDay);
              }
              setPicking("from");
            }
          }}
          onMouseEnter={() => setHoverDate(currentDay)}
          onMouseLeave={() => setHoverDate(null)}
        >
          <span
            className={`flex h-9 w-9 items-center justify-center rounded-full text-[13px] font-medium transition-colors md:h-7 md:w-7 md:text-[12px] ${markClass}`}
          >
            {d}
          </span>
        </button>
      );
    }

    return (
      // Full width on a phone, fixed on desktop where two months sit side by
      // side. The old fixed width left ~150px of dead space to the right of the
      // grid on a 390px screen while the cells themselves stayed tiny.
      <div className="w-full select-none md:w-[13.5rem]">
        <div className="mb-2 flex items-center justify-between px-1">
          {monthOffset === 0 ? (
            <button
              className="p-1 hover:bg-canvas rounded text-muted hover:text-ink transition"
              onClick={() => setCurrentMonthDate(new Date(currentMonthDate.getFullYear(), currentMonthDate.getMonth() - 1, 1))}
            >
              <div className="rotate-90 scale-75"><IconChevron /></div>
            </button>
          ) : <div className="w-6" />}
          <div className="text-[13px] font-semibold">{monthName} {year}</div>
          {monthOffset === 1 || (monthOffset === 0 && isNarrow) ? (
            <button
              className="p-1 hover:bg-canvas rounded text-muted hover:text-ink transition"
              onClick={() => setCurrentMonthDate(new Date(currentMonthDate.getFullYear(), currentMonthDate.getMonth() + 1, 1))}
            >
              <div className="-rotate-90 scale-75"><IconChevron /></div>
            </button>
          ) : <div className="w-6" />}
        </div>
        <div className="grid grid-cols-7 gap-y-1 mb-1">
          {["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"].map((day) => (
            <div key={day} className="text-center text-[11px] font-medium text-muted h-6 flex items-center justify-center">
              {day}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-y-1 md:justify-items-center">
          {days}
        </div>
      </div>
    );
  };

  return (
    <div className="relative inline-block" ref={containerRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="inline-flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-1.5 text-[13px] font-medium hover:bg-canvas transition"
      >
        <span className="text-muted scale-90"><IconCalendar /></span>
        {getLabel()}
      </button>

      {/* On a phone the panel is a sheet pinned to the viewport rather than
          hanging off the trigger: at `absolute left-0 top-full` the calendar
          plus the preset list is taller and wider than the screen, so both ends
          were cut off with no way to reach Apply. From `md` up it goes back to
          being anchored to the button. */}
      {isOpen && (
        <div className="fixed inset-x-3 top-20 z-50 flex max-h-[calc(100dvh-6rem)] flex-col overflow-y-auto overscroll-contain rounded-xl border border-border bg-surface shadow-xl md:absolute md:inset-x-auto md:left-0 md:top-full md:mt-2 md:max-h-none md:flex-row md:overflow-hidden md:min-w-[280px]">
          {/* Left Sidebar - Presets */}
          {/* Three across from ~340px up. At two columns the nine presets take
              five rows before the calendar even starts, which is most of a
              phone screen spent on shortcuts. Keyed off the panel's own width
              (it is inset 12px each side) rather than `sm:`, which is the
              viewport and never fires on a phone. */}
          <div className="w-full shrink-0 md:w-32 border-b md:border-b-0 md:border-r border-border bg-canvas/30 p-1.5 grid grid-cols-2 gap-1 min-[340px]:grid-cols-3 md:flex md:flex-col md:gap-0.5 md:max-h-none">
            {PRESETS.map((p) => (
              <button
                key={p.id}
                onClick={() => {
                  setTempType("preset");
                  setTempPreset(p.id);
                  setTempFrom(null);
                  setTempTo(null);
                }}
                className={`text-left px-2.5 py-1.5 rounded-md text-[13px] transition ${
                  tempType === "preset" && tempPreset === p.id
                    ? "bg-surface font-medium text-ink shadow-sm border border-border/50"
                    : "text-muted hover:text-ink hover:bg-surface/50"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>

          {/* Right Area - Calendars & Inputs */}
          <div className="p-4 flex flex-col gap-4">
            {/* Calendars */}
            <div className="flex flex-col md:flex-row gap-5">
              {renderCalendar(0)}
              <div className="hidden md:block">
                {renderCalendar(1)}
              </div>
            </div>

            {/* Inputs & Actions */}
            {/* Sticky on mobile: the panel scrolls, and Apply sitting at the
                bottom of that scroll meant reaching the primary action
                required scrolling past the whole calendar. `-mx-4 px-4 -mb-4
                pb-4` lets it span the padded container's full width so the
                surface behind it covers the content sliding underneath. */}
            <div className="sticky bottom-0 -mx-4 -mb-4 flex flex-col items-center justify-between gap-3 border-t border-border bg-surface px-4 pb-4 pt-3 md:static md:mx-0 md:mb-0 md:flex-row md:px-0 md:pb-0">
              <div className="flex items-center gap-2 w-full md:w-auto">
                <input 
                  className="w-full md:w-[6.5rem] px-2.5 py-1.5 text-[16px] md:text-[13px] rounded-md border border-border bg-surface outline-none focus:border-brand"
                  placeholder="MM/DD/YYYY"
                  value={tempFrom ? formatInputDate(tempFrom) : ""}
                  onChange={(e) => {
                    const d = parseInputDate(e.target.value);
                    if (d) {
                      setTempType("custom");
                      setTempFrom(d);
                    }
                  }}
                />
                <span className="text-muted text-sm">–</span>
                <input 
                  className="w-full md:w-[6.5rem] px-2.5 py-1.5 text-[16px] md:text-[13px] rounded-md border border-border bg-surface outline-none focus:border-brand"
                  placeholder="MM/DD/YYYY"
                  value={tempTo ? formatInputDate(tempTo) : ""}
                  onChange={(e) => {
                    const d = parseInputDate(e.target.value);
                    if (d) {
                      setTempType("custom");
                      setTempTo(d);
                    }
                  }}
                />
              </div>

              <div className="flex w-full items-center justify-end gap-2 md:w-auto">
                <button
                  onClick={() => setIsOpen(false)}
                  className="flex-1 rounded-md border border-border px-3 py-2.5 text-[13px] font-medium transition hover:bg-canvas md:flex-none md:py-1"
                >
                  Cancel
                </button>
                <button
                  onClick={handleApply}
                  className="flex-1 rounded-md bg-brand px-3 py-2.5 text-[13px] font-medium text-white transition hover:bg-brand-600 md:flex-none md:py-1"
                >
                  Apply
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
