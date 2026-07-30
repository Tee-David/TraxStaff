import type { TourKind, TourStep } from "./registry";
import type { TourIconName } from "./tour-icon";

/**
 * Step metadata — computed once when a tour starts and hung off each joyride
 * step's `data` field, so the tooltip can render its icon, progress,
 * encouragement, interactive prompt and up-front duration estimate without
 * re-deriving anything at paint time.
 *
 * It has to be computed *after* the provider has filtered the step list
 * (optional/desktop-only/admin-only steps drop out), otherwise the counts we
 * promise the user ("12 stops", "3 pages to go") wouldn't match the tour they
 * actually get.
 */

/** Average dwell per stop, in seconds — tuned against the length of the real copy. */
const SECONDS_PER_STOP = 9;

/** Rounded minutes for a tour of `stops` steps. Never rounds down to zero. */
export function estimateMinutes(stops: number): number {
  return Math.max(1, Math.round((stops * SECONDS_PER_STOP) / 60));
}

export type TourStepMeta = {
  icon?: TourIconName;
  /** Selector the user must click for an interactive step to advance itself. */
  interactSelector?: string;
  interactHint?: string;
  /** Lead the step with the "~3 min · 12 stops" chip (intro steps only). */
  showEstimate?: boolean;
  estimateMinutes: number;
  totalStops: number;
  /** Friendly name of the page this step belongs to. */
  page?: string;
  /** Pre-computed nudge shown under the progress rail. */
  encouragement?: string;
};

/**
 * Group consecutive steps into "pages". A step declares a new page by carrying
 * a `route` different from the running one; steps without a `route` continue
 * the current page. Page/welcome tours never set `route`, so they collapse to a
 * single group — which is exactly what we want for their "steps left" copy.
 */
function groupSteps(steps: TourStep[]): { groupOf: number[]; pageOf: (string | undefined)[]; groupCount: number } {
  const groupOf: number[] = [];
  const pageOf: (string | undefined)[] = [];
  let route: string | undefined;
  let page: string | undefined;
  let group = -1;

  steps.forEach((step, i) => {
    if (i === 0 || (step.route !== undefined && step.route !== route)) {
      group += 1;
      if (step.route !== undefined) route = step.route;
    }
    if (step.page) page = step.page;
    groupOf[i] = group;
    pageOf[i] = page;
  });

  return { groupOf, pageOf, groupCount: group + 1 };
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The nudge under the progress rail. Kept short — it's a garnish, not a paragraph. */
function encouragementFor(options: {
  index: number;
  total: number;
  kind: TourKind;
  pagesLeft: number;
  stopsLeftOnPage: number;
}): string | undefined {
  const { index, total, kind, pagesLeft, stopsLeftOnPage } = options;

  if (index === total - 1) return "That's the lot — you're all set.";
  // The opener leads with the duration estimate instead.
  if (index === 0) return undefined;

  if (kind === "walkthrough") {
    // Last stop on this page → celebrate and point at what's left.
    if (stopsLeftOnPage === 0 && pagesLeft > 0) {
      return `Good job — ${plural(pagesLeft, "page", "pages")} to go.`;
    }
    if (stopsLeftOnPage > 0) return `${plural(stopsLeftOnPage, "stop", "stops")} left on this page.`;
    return undefined;
  }

  const left = total - 1 - index;
  return left > 0 ? `Only ${plural(left, "step", "steps")} left on this page.` : undefined;
}

/**
 * Attach the computed `data` payload to every step. Returns a new array; the
 * registry definitions are never mutated (a tour can be replayed many times).
 */
export function withStepMeta(steps: TourStep[], kind: TourKind): TourStep[] {
  const total = steps.length;
  const minutes = estimateMinutes(total);
  const { groupOf, pageOf, groupCount } = groupSteps(steps);

  return steps.map((step, index) => {
    const stopsLeftOnPage = steps.filter((_, j) => j > index && groupOf[j] === groupOf[index]).length;
    const pagesLeft = groupCount - 1 - groupOf[index];

    const meta: TourStepMeta = {
      icon: step.icon,
      interactSelector: step.interact
        ? (step.interact.clickTarget ?? (typeof step.target === "string" ? step.target : undefined))
        : undefined,
      interactHint: step.interact?.hint,
      showEstimate: step.showEstimate,
      estimateMinutes: minutes,
      totalStops: total,
      page: pageOf[index],
      encouragement: encouragementFor({ index, total, kind, pagesLeft, stopsLeftOnPage }),
    };

    return { ...step, data: meta };
  });
}
