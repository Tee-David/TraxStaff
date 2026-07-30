"use client";

import { motion, useReducedMotion } from "motion/react";
import { Clock3, MousePointerClick } from "lucide-react";
import type { TooltipRenderProps } from "react-joyride";
import { TourIcon } from "./tour-icon";
import type { TourStepMeta } from "./tour-meta";

/**
 * The tour's tooltip — replaces joyride's default so every stop can carry an
 * animated icon, a progress rail, an encouragement line and (on interactive
 * steps) a "do this" prompt.
 *
 * Sizing is `min(92vw, 22rem)` so it never overflows a phone; joyride's floater
 * is `display:inline-block; max-width:100%`, so the tooltip's own width wins.
 * All motion is skipped under `prefers-reduced-motion`.
 */
export function TourTooltip({
  index,
  size,
  step,
  backProps,
  primaryProps,
  skipProps,
  tooltipProps,
  isLastStep,
}: TooltipRenderProps) {
  const reduced = useReducedMotion();
  const meta = (step.data ?? {}) as Partial<TourStepMeta>;
  const pct = size > 0 ? Math.round(((index + 1) / size) * 100) : 0;

  return (
    <div
      {...tooltipProps}
      className="w-[min(92vw,22rem)] overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface text-left shadow-[var(--shadow-lift)]"
    >
      {/* Progress rail — doubles as the "how far in am I" cue. */}
      <div className="h-1 w-full bg-canvas">
        <motion.div
          className="h-full rounded-r-full bg-brand"
          initial={reduced ? false : { width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={reduced ? { duration: 0 } : { duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
        />
      </div>

      <div className="p-4">
        <div className="flex items-start gap-3">
          <TourIcon name={meta.icon} />
          <div className="min-w-0 flex-1">
            {step.title ? (
              <p className="font-heading text-sm font-bold leading-snug text-ink">{step.title}</p>
            ) : null}
            <p className="mt-0.5 text-[11px] font-medium tnum text-muted">
              {meta.page ? `${meta.page} · ` : ""}Step {index + 1} of {size}
            </p>
          </div>
        </div>

        {meta.showEstimate && meta.estimateMinutes && meta.totalStops ? (
          <p className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-brand/10 px-2.5 py-1 text-[11px] font-semibold text-brand">
            <Clock3 className="size-3" aria-hidden />~{meta.estimateMinutes} min · {meta.totalStops}{" "}
            stops
          </p>
        ) : null}

        <div className="mt-2.5 text-[13.5px] leading-relaxed text-ink/90">{step.content}</div>

        {meta.interactHint ? (
          <div className="mt-3 flex items-center gap-2.5 rounded-xl border border-brand/25 bg-brand/[0.06] px-3 py-2.5">
            <span className="relative grid size-6 shrink-0 place-items-center rounded-full bg-brand text-brand-fg">
              {!reduced && (
                <motion.span
                  aria-hidden
                  className="absolute inset-0 rounded-full bg-brand"
                  animate={{ scale: [1, 1.7], opacity: [0.5, 0] }}
                  transition={{ duration: 1.6, repeat: Infinity, ease: "easeOut" }}
                />
              )}
              <MousePointerClick className="relative size-3.5" aria-hidden />
            </span>
            <p className="text-xs font-semibold text-ink">{meta.interactHint}</p>
          </div>
        ) : null}

        {meta.encouragement ? (
          <p className="mt-3 text-[11px] font-medium text-muted">{meta.encouragement}</p>
        ) : null}

        <div className="mt-4 flex items-center justify-between gap-2">
          <button
            {...skipProps}
            className="rounded-full px-2 py-1.5 text-xs font-medium text-muted transition-colors hover:text-ink"
          >
            Skip tour
          </button>
          <div className="flex items-center gap-1.5">
            {index > 0 && (
              <button
                {...backProps}
                className="rounded-full px-3 py-2 text-xs font-semibold text-ink transition-colors hover:bg-canvas"
              >
                Back
              </button>
            )}
            <button
              {...primaryProps}
              className="rounded-full bg-brand px-4 py-2 text-xs font-semibold text-brand-fg transition-colors hover:bg-brand-600"
            >
              {isLastStep ? "Done" : "Next"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
