"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import { Joyride, EVENTS, STATUS, type EventData, type Controls } from "react-joyride";
import { TOURS, type TourRole, type TourStep } from "./registry";
import { pageTourIdFor } from "./route-match";
import { BRAND_OPTIONS, LOCALE } from "./joyride-theme";
import { withStepMeta, type TourStepMeta } from "./tour-meta";
import { TourTooltip } from "./tour-tooltip";
import { isDesktop, prefersReducedMotion, waitForTarget } from "./wait-for-target";
import { fireConfetti } from "./confetti";

type TourContextValue = {
  /** Start any registered tour by id. */
  startTour: (id: string) => void;
  /** Start the page tour for the current route (no-op if none). */
  startPageTour: () => void;
  /** Start the cross-page walkthrough. */
  startWalkthrough: () => void;
  /** Start (replay) the welcome tour. */
  startWelcome: () => void;
  /** Stop any running tour. */
  stopTour: () => void;
  /** Whether a runnable page tour exists for the current route. */
  hasPageTour: () => boolean;
  /** Whether a tour is currently running. */
  isRunning: boolean;
};

const TourContext = createContext<TourContextValue | null>(null);

export function useTour(): TourContextValue {
  const ctx = useContext(TourContext);
  if (!ctx) {
    throw new Error("useTour must be used within a <TourProvider>");
  }
  return ctx;
}

const WELCOME_KEY = "trax:tour:welcome";

/**
 * How long a `before` hook waits for a cross-page target to mount. Kept well
 * under `targetWaitTimeout + beforeTimeout` so a step whose anchor never
 * arrives fails fast into the skip path instead of stalling the tour.
 */
const TARGET_WAIT_MS = 5000;

export function TourProvider({
  role,
  children,
}: {
  /** The signed-in user's role — gates `adminOnly` steps (Insights/Projects/Members). */
  role: TourRole;
  children: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const isPrivileged = role === "owner" || role === "admin";

  // Live refs so before-hooks / callbacks always see the current values.
  const pathnameRef = useRef(pathname);
  useEffect(() => {
    pathnameRef.current = pathname;
  }, [pathname]);
  const privilegedRef = useRef(isPrivileged);
  useEffect(() => {
    privilegedRef.current = isPrivileged;
  }, [isPrivileged]);

  const [activeTourId, setActiveTourId] = useState<string | null>(null);
  const [steps, setSteps] = useState<TourStep[]>([]);
  const [run, setRun] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [scrollOffset, setScrollOffset] = useState(96);
  const [reduced, setReduced] = useState(false);

  const activeTourIdRef = useRef<string | null>(null);
  useEffect(() => {
    activeTourIdRef.current = activeTourId;
  }, [activeTourId]);
  // Joyride hands `controls` to the event handler; stash them so the
  // interactive-step listener can advance the tour from outside React's tree.
  const controlsRef = useRef<Controls | null>(null);
  // Guards the terminal handler — a finished tour can emit more than one event
  // carrying the terminal status before the teardown re-render lands.
  const terminalHandledRef = useRef(false);

  // Keep the scroll offset clear of the sticky topbar, and track the
  // reduced-motion preference live (users flip it mid-session).
  useEffect(() => {
    const sync = () => {
      setScrollOffset(isDesktop() ? 104 : 84);
      setReduced(prefersReducedMotion());
    };
    sync();
    window.addEventListener("resize", sync);
    const motion = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    motion?.addEventListener?.("change", sync);
    return () => {
      window.removeEventListener("resize", sync);
      motion?.removeEventListener?.("change", sync);
    };
  }, []);

  const stopTour = useCallback(() => {
    setRun(false);
    setActiveTourId(null);
    setSteps([]);
    setStepIndex(0);
  }, []);

  /** Poll until the router has actually landed on `route` (or we time out). */
  const waitForRoute = useCallback(async (route: string, timeout = 8000) => {
    const start = Date.now();
    while (pathnameRef.current !== route && Date.now() - start < timeout) {
      await new Promise((r) => setTimeout(r, 60));
    }
  }, []);

  /** Is a step's target present, and does it apply to this viewport/role? */
  const isStepPresent = useCallback((step: TourStep): boolean => {
    // Sidebar anchors are `hidden lg:block` — present in the DOM but invisible —
    // so a viewport check has to gate them, not just `querySelector`.
    if (step.desktopOnly && !isDesktop()) return false;
    if (step.mobileOnly && isDesktop()) return false;
    if (step.adminOnly && !privilegedRef.current) return false;
    const target = step.target;
    if (typeof target !== "string") return true;
    if (target === "body") return true;
    return typeof document !== "undefined" && document.querySelector(target) !== null;
  }, []);

  const startTour = useCallback(
    (id: string) => {
      const def = TOURS[id];
      if (!def) return;

      let built: TourStep[];
      if (def.kind === "walkthrough") {
        // Cross-page steps: we can't know whether a target exists until we're on
        // its page, so viewport/role filtering happens up front and missing
        // anchors fall through to the TARGET_NOT_FOUND skip path.
        built = def.steps
          .filter((step) => {
            if (step.desktopOnly && !isDesktop()) return false;
            if (step.mobileOnly && isDesktop()) return false;
            if (step.adminOnly && !privilegedRef.current) return false;
            return true;
          })
          .map((step) => {
            const route = step.route;
            if (!route) return step;
            return {
              ...step,
              before: async () => {
                if (pathnameRef.current !== route) {
                  router.push(route);
                  await waitForRoute(route);
                }
                const target = typeof step.target === "string" ? step.target : null;
                if (target && target !== "body") {
                  await waitForTarget(target, TARGET_WAIT_MS);
                }
              },
            };
          });
      } else {
        // Page / welcome tours run on the current page — drop any step whose
        // target isn't in the DOM so we never spotlight nothing.
        built = def.steps.filter(isStepPresent);
      }

      if (built.length === 0) return;

      terminalHandledRef.current = false;
      setSteps(withStepMeta(built, def.kind));
      setActiveTourId(id);
      setStepIndex(0);
      setRun(true);
    },
    [router, waitForRoute, isStepPresent],
  );

  const startWelcome = useCallback(() => {
    startTour("welcome");
  }, [startTour]);

  const startWalkthrough = useCallback(() => {
    startTour("walkthrough");
  }, [startTour]);

  const startPageTour = useCallback(() => {
    const id = pageTourIdFor(pathnameRef.current);
    if (id) startTour(id);
  }, [startTour]);

  const hasPageTour = useCallback(() => {
    const id = pageTourIdFor(pathnameRef.current);
    if (!id) return false;
    const def = TOURS[id];
    return !!def && def.steps.some(isStepPresent);
  }, [isStepPresent]);

  const onEvent = useCallback(
    (data: EventData, controls: Controls) => {
      controlsRef.current = controls;

      // Track the live index so the interactive listener knows which step is up.
      if (data.type === EVENTS.STEP_BEFORE || data.type === EVENTS.TOOLTIP) {
        setStepIndex(data.index);
      }
      // A missing target (e.g. an optional anchor on an empty table) just
      // advances the tour rather than stalling on nothing.
      if (data.type === EVENTS.TARGET_NOT_FOUND) {
        controls.next();
        return;
      }
      // Terminal states: persist the welcome flag and tear the tour down.
      const finished = data.status === STATUS.FINISHED;
      const skipped = data.status === STATUS.SKIPPED;
      if (!finished && !skipped) return;
      if (terminalHandledRef.current) return;
      terminalHandledRef.current = true;

      const id = activeTourIdRef.current;
      const def = id ? TOURS[id] : null;
      if (def?.kind === "welcome") {
        try {
          localStorage.setItem(WELCOME_KEY, "1");
        } catch {}
      }
      // Celebrate only when they made it to the end — never on a skip.
      if (finished) fireConfetti();
      stopTour();
    },
    [stopTour],
  );

  /**
   * Interactive steps: the user clicks the real UI and the tour moves itself on.
   * Listening on the document in the capture phase means we still fire when the
   * target is a nav link that unmounts the page out from under us, and it
   * survives the target re-rendering mid-step.
   */
  useEffect(() => {
    if (!run) return;
    const meta = steps[stepIndex]?.data as TourStepMeta | undefined;
    const selector = meta?.interactSelector;
    if (!selector) return;

    const onClick = (event: MouseEvent) => {
      const el = event.target as Element | null;
      if (el?.closest?.(selector)) {
        // Let the click do its real work (navigate, toggle) before advancing.
        setTimeout(() => controlsRef.current?.next(), 0);
      }
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [run, stepIndex, steps]);

  /**
   * If `scroll-behavior: smooth` is ever set globally, it fights joyride's own
   * rAF scroll tween (every scrollTop write gets re-smoothed by the browser,
   * so the spotlight lands late and jitters). Neutralise it for the duration
   * of a tour, then hand it back.
   */
  useEffect(() => {
    if (!run) return;
    const html = document.documentElement;
    const previous = html.style.scrollBehavior;
    html.style.scrollBehavior = "auto";
    return () => {
      html.style.scrollBehavior = previous;
    };
  }, [run]);

  // Auto-run the welcome tour once, ever, per browser.
  useEffect(() => {
    let seen = false;
    try {
      if (localStorage.getItem(WELCOME_KEY)) seen = true;
    } catch {
      seen = true; // storage blocked — err on the side of not auto-running.
    }
    if (seen) return;

    const timer = setTimeout(() => {
      startWelcome();
    }, 900);
    return () => clearTimeout(timer);
    // Run once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const value = useMemo<TourContextValue>(
    () => ({
      startTour,
      startPageTour,
      startWalkthrough,
      startWelcome,
      stopTour,
      hasPageTour,
      isRunning: run,
    }),
    [startTour, startPageTour, startWalkthrough, startWelcome, stopTour, hasPageTour, run],
  );

  return (
    <TourContext.Provider value={value}>
      {children}
      <Joyride
        key={activeTourId ?? "idle"}
        steps={steps}
        run={run}
        continuous
        scrollToFirstStep
        locale={LOCALE}
        options={{
          ...BRAND_OPTIONS,
          beforeTimeout: 12000,
          targetWaitTimeout: 3000,
          scrollOffset,
          scrollDuration: reduced ? 0 : 420,
        }}
        tooltipComponent={TourTooltip}
        onEvent={onEvent}
      />
    </TourContext.Provider>
  );
}
