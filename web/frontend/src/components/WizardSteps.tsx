"use client";

import type { ReactNode } from "react";

export type WizardStep = {
  id: string;
  label: string;
  /** One line under the label once the step has been answered. */
  summary?: string;
};

/**
 * The step rail for a multi-step form.
 *
 * Layout is lifted straight from `SettingsNav` — a vertical rail from `lg` up,
 * collapsing to a horizontally scrollable strip below — because the two solve
 * the same problem and a second layout would only be a second thing to keep in
 * sync.
 *
 * What it adds is state: done / current / upcoming, and the summary line. Both
 * exist to answer the complaint a wizard normally earns, that it hides what you
 * already chose and traps you three steps in. A completed step shows its answer
 * and is clickable; an upcoming one is not, because jumping ahead of a decision
 * the next step depends on is how you end up with a half-configured form.
 */
export function WizardSteps({
  steps,
  current,
  furthest,
  onSelect,
}: {
  steps: WizardStep[];
  /** Index of the step being shown. */
  current: number;
  /** Furthest index reached, so already-answered steps stay reachable. */
  furthest: number;
  onSelect: (index: number) => void;
}) {
  function Row({ step, index }: { step: WizardStep; index: number }) {
    const done = index < furthest;
    const active = index === current;
    const reachable = index <= furthest;

    return (
      <button
        type="button"
        disabled={!reachable}
        onClick={() => reachable && onSelect(index)}
        aria-current={active ? "step" : undefined}
        className={`flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left transition ${
          active
            ? "bg-brand/10 text-brand"
            : reachable
              ? "text-muted hover:bg-canvas hover:text-ink"
              : "cursor-default text-faint"
        }`}
      >
        <Marker index={index} done={done} active={active} />
        <span className="min-w-0 flex-1">
          <span className="block text-[13.5px] font-medium leading-tight">{step.label}</span>
          {step.summary && (
            <span className={`mt-0.5 block truncate text-xs ${active ? "text-brand/70" : "text-faint"}`}>
              {step.summary}
            </span>
          )}
        </span>
      </button>
    );
  }

  return (
    <nav aria-label="Steps" className="min-w-0 lg:sticky lg:top-4 lg:w-60 lg:shrink-0">
      {/* Rail — lg and up */}
      <div className="hidden lg:flex lg:flex-col lg:gap-0.5">
        {steps.map((step, i) => (
          <Row key={step.id} step={step} index={i} />
        ))}
      </div>

      {/* Strip — below lg. Summaries are dropped: there is no room for them, and
          the current step's own heading already says where you are. */}
      <div className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-2 lg:hidden">
        {steps.map((step, i) => {
          const reachable = i <= furthest;
          return (
            <button
              key={step.id}
              type="button"
              disabled={!reachable}
              onClick={() => reachable && onSelect(i)}
              aria-current={i === current ? "step" : undefined}
              className={`flex shrink-0 items-center gap-2 rounded-xl px-3 py-2 text-[13px] font-medium transition ${
                i === current
                  ? "bg-brand/10 text-brand"
                  : reachable
                    ? "text-muted hover:bg-canvas"
                    : "cursor-default text-faint"
              }`}
            >
              <Marker index={i} done={i < furthest} active={i === current} />
              {step.label}
            </button>
          );
        })}
      </div>
    </nav>
  );
}

function Marker({ index, done, active }: { index: number; done: boolean; active: boolean }) {
  return (
    <span
      className={`mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
        done
          ? "bg-brand text-brand-fg"
          : active
            ? "border-2 border-brand text-brand"
            : "border border-border text-faint"
      }`}
    >
      {done ? <Tick /> : index + 1}
    </span>
  );
}

function Tick() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" className="h-3 w-3">
      <path d="m5 13 4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Back / Next footer, so every step ends the same way. */
export function WizardFooter({
  onBack,
  onNext,
  nextLabel = "Next",
  nextDisabled,
  busy,
  hint,
  children,
}: {
  onBack?: () => void;
  onNext?: () => void;
  nextLabel?: string;
  nextDisabled?: boolean;
  busy?: boolean;
  /** Why Next is unavailable — shown instead of leaving a dead button unexplained. */
  hint?: string;
  children?: ReactNode;
}) {
  return (
    <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-border pt-4">
      {onBack && (
        <button
          type="button"
          onClick={onBack}
          className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted transition hover:bg-canvas hover:text-ink"
        >
          Back
        </button>
      )}
      {children}
      <div className="flex-1" />
      {hint && nextDisabled && <span className="text-xs text-muted">{hint}</span>}
      {onNext && (
        <button
          type="button"
          onClick={onNext}
          disabled={nextDisabled || busy}
          className="rounded-lg bg-brand px-5 py-2 text-sm font-medium text-brand-fg transition hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? "Working…" : nextLabel}
        </button>
      )}
    </div>
  );
}
