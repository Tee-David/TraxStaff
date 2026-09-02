"use client";

import { useState } from "react";
import { Card, Input, Label } from "@/components/ui";
import { Select } from "@/components/Select";
import { Toggle } from "@/components/Toggle";
import { addDays, daysBetween, shortDay, weekStart } from "@/lib/platform";
import { derive, type PeriodMode, type WizardState } from "./types";

/**
 * Step 3 — when, and how much.
 *
 * Everything that used to sit in the "Realism" card is gone from the main view.
 * The three numeric jitter inputs are now one switch, because "how many percent
 * should the day length vary by" is a question about the implementation, not
 * about the work being recorded — and it has a sensible answer that almost
 * nobody needs to change.
 *
 * They are still reachable under Advanced. Hiding a capability is fine; removing
 * it would not be.
 */
export function StepWhen({
  state,
  update,
}: {
  state: WizardState;
  update: (patch: Partial<WizardState>) => void;
}) {
  const [advanced, setAdvanced] = useState(false);
  const { needsAmount, isActivityOnly, canReplaceCaptured } = derive(state.intent);

  const pickable = daysBetween(state.from, state.to);
  const rangey = state.mode === "range" || state.mode === "days";

  return (
    <div>
      <h2 className="font-heading text-lg font-semibold">
        {isActivityOnly ? "Which period, and what activity?" : "When, and how much?"}
      </h2>

      {/* ── period ─────────────────────────────────────────────────────── */}
      <div className="mt-5">
        <Label>Period</Label>
        <div className="flex flex-wrap gap-2">
          {(
            [
              ["day", "A day"],
              ["week", "A week"],
              ["range", "A range"],
              ["days", "Specific days"],
            ] as [PeriodMode, string][]
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => update({ mode: value })}
              className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition ${
                state.mode === value
                  ? "border-brand bg-brand-soft text-brand"
                  : "border-border text-muted hover:bg-canvas"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="mt-3">
          {(state.mode === "day" || state.mode === "week") && (
            <div className="max-w-[14rem]">
              <Input
                type="date"
                value={state.date}
                onChange={(e) => update({ date: e.target.value })}
              />
              {state.mode === "week" && state.date && (
                <p className="mt-1.5 text-xs text-muted">
                  {shortDay(weekStart(state.date))} to {shortDay(addDays(weekStart(state.date), 6))}
                </p>
              )}
            </div>
          )}

          {rangey && (
            <div className="flex flex-wrap gap-3">
              <div className="max-w-[14rem]">
                <Label>From</Label>
                <Input
                  type="date"
                  value={state.from}
                  onChange={(e) => update({ from: e.target.value })}
                />
              </div>
              <div className="max-w-[14rem]">
                <Label>To</Label>
                <Input type="date" value={state.to} onChange={(e) => update({ to: e.target.value })} />
              </div>
            </div>
          )}

          {state.mode === "days" && (
            <div className="mt-3">
              <Label>Which days</Label>
              <div className="flex flex-wrap gap-1.5">
                {pickable.map((d) => {
                  const on = state.picked.includes(d);
                  return (
                    <button
                      key={d}
                      type="button"
                      onClick={() =>
                        update({
                          picked: on
                            ? state.picked.filter((x) => x !== d)
                            : [...state.picked, d].sort(),
                        })
                      }
                      className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium transition ${
                        on
                          ? "border-brand bg-brand-soft text-brand"
                          : "border-border text-muted hover:bg-canvas"
                      }`}
                    >
                      {shortDay(d)}
                    </button>
                  );
                })}
              </div>
              <p className="mt-2 text-xs text-muted">
                {state.picked.length} selected. Naming a weekend day includes it.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* ── amount ─────────────────────────────────────────────────────── */}
      {needsAmount && (
        <div className="mt-6">
          <Label>How many hours</Label>
          <div className="flex flex-wrap items-start gap-2">
            <Input
              type="number"
              step="0.01"
              min="0.1"
              value={state.hours}
              onChange={(e) => update({ hours: e.target.value })}
              className="max-w-[8rem]"
            />
            {/* One field with a unit, rather than two buttons above a field that
                silently changes meaning depending on which is pressed. */}
            <div className="min-w-[13rem]">
              <Select
                value={state.amountKind}
                onChange={(v) => update({ amountKind: v as "total" | "perDay" })}
                options={[
                  { value: "total", label: "in total across the period" },
                  { value: "perDay", label: "per day" },
                ]}
              />
            </div>
          </div>
          <p className="mt-1.5 text-xs text-muted">
            40 hours 2 minutes is <code>40.0333</code>.
          </p>
        </div>
      )}

      {/* ── activity ───────────────────────────────────────────────────── */}
      <div className="mt-6 max-w-[10rem]">
        <Label>Activity %</Label>
        <Input
          type="number"
          min="0"
          max="100"
          value={state.activityPct}
          onChange={(e) => update({ activityPct: e.target.value })}
        />
      </div>

      {isActivityOnly && (
        <label className="mt-4 flex max-w-2xl cursor-pointer items-start gap-3 rounded-lg border border-border p-3">
          <input
            type="checkbox"
            checked={state.includeCaptured}
            onChange={(e) => update({ includeCaptured: e.target.checked })}
            className="mt-1"
          />
          <span className="text-sm">
            <span className="font-medium">Include captured tracker sessions</span>
            <span className="mt-0.5 block text-xs text-muted">
              Their blocks are rewritten in place, so every screenshot survives. Without this only
              manually-entered sessions change, and a period that is mostly real tracking will
              barely move.
            </span>
          </span>
        </label>
      )}

      {/* ── the destructive one, on its own ────────────────────────────── */}
      {canReplaceCaptured && (
        <label className="mt-4 flex max-w-2xl cursor-pointer items-start gap-3 rounded-lg border border-[var(--color-negative)]/40 bg-[var(--color-negative-soft)] p-3">
          <input
            type="checkbox"
            checked={state.replaceCaptured}
            onChange={(e) => update({ replaceCaptured: e.target.checked })}
            className="mt-1"
          />
          <span className="text-sm">
            <span className="font-medium text-[var(--color-negative)]">
              Also delete captured tracker sessions
            </span>
            <span className="mt-0.5 block text-xs text-muted">
              Removes real tracked work along with its activity blocks and screenshots. An undo
              snapshot is taken, and the review step lists exactly what would go.
            </span>
          </span>
        </label>
      )}

      {/* ── natural variation, one switch ──────────────────────────────── */}
      {needsAmount && (
        <div className="mt-6 flex max-w-2xl items-start justify-between gap-4 rounded-lg border border-border p-3">
          <span className="text-sm">
            <span className="font-medium">Vary it naturally</span>
            <span className="mt-0.5 block text-xs text-muted">
              Day lengths, start times and activity wobble a little, the way a real week does. The
              totals you asked for stay exact either way.
            </span>
          </span>
          <Toggle
            checked={state.natural}
            onChange={(v) => update({ natural: v })}
            label="Vary it naturally"
          />
        </div>
      )}

      {/* ── advanced ───────────────────────────────────────────────────── */}
      <div className="mt-6">
        <button
          type="button"
          onClick={() => setAdvanced((a) => !a)}
          className="text-sm font-medium text-muted underline transition hover:text-ink"
        >
          {advanced ? "Hide advanced" : "Advanced"}
        </button>

        {advanced && (
          <Card className="mt-3 space-y-4 p-4">
            {needsAmount && (
              <>
                <div className="grid gap-4 sm:grid-cols-3">
                  <div>
                    <Label>Activity spread ±%</Label>
                    <Input
                      type="number"
                      min="0"
                      max="50"
                      value={state.activityJitter}
                      onChange={(e) => update({ activityJitter: e.target.value })}
                      disabled={!state.natural}
                    />
                  </div>
                  <div>
                    <Label>Day length ±%</Label>
                    <Input
                      type="number"
                      min="0"
                      max="50"
                      value={state.lengthJitterPct}
                      onChange={(e) => update({ lengthJitterPct: e.target.value })}
                      disabled={!state.natural}
                    />
                  </div>
                  <div>
                    <Label>Start time ± minutes</Label>
                    <Input
                      type="number"
                      min="0"
                      max="180"
                      value={state.startJitterMinutes}
                      onChange={(e) => update({ startJitterMinutes: e.target.value })}
                      disabled={!state.natural}
                    />
                  </div>
                </div>

                <div className="max-w-[12rem]">
                  <Label>Unpaid break (minutes)</Label>
                  <Input
                    type="number"
                    min="0"
                    value={state.breakMinutes}
                    onChange={(e) => update({ breakMinutes: e.target.value })}
                  />
                  <p className="mt-1.5 text-xs text-muted">
                    Inserted as a real gap, not shaved off the end.
                  </p>
                </div>

                <label className="flex cursor-pointer items-start gap-3">
                  <input
                    type="checkbox"
                    checked={state.matchMemberPattern}
                    onChange={(e) => update({ matchMemberPattern: e.target.checked })}
                    className="mt-1"
                  />
                  <span className="text-sm">
                    <span className="font-medium">Match their own habits</span>
                    <span className="mt-0.5 block text-xs text-muted">
                      Start time and activity default to this person&rsquo;s real tracked history
                      rather than a generic 09:00.
                    </span>
                  </span>
                </label>

                <label className="flex cursor-pointer items-start gap-3">
                  <input
                    type="checkbox"
                    checked={state.recordAsTracked}
                    onChange={(e) => update({ recordAsTracked: e.target.checked })}
                    className="mt-1"
                  />
                  <span className="text-sm">
                    <span className="font-medium">Record as ordinary tracked work</span>
                    <span className="mt-0.5 block text-xs text-muted">
                      Off (the default) flags these rows as manually entered, which is what keeps
                      them safely revisable later. On makes them indistinguishable from real
                      capture — and the revise and delete tools then refuse them.
                    </span>
                  </span>
                </label>
              </>
            )}

            {rangey && (
              <label className="flex cursor-pointer items-center gap-3">
                <input
                  type="checkbox"
                  checked={state.includeWeekends}
                  onChange={(e) => update({ includeWeekends: e.target.checked })}
                />
                <span className="text-sm font-medium">Include weekends</span>
              </label>
            )}
          </Card>
        )}
      </div>
    </div>
  );
}
