/**
 * DOM-readiness helpers used by the tour engine. These are only ever called
 * client-side (inside effects / event handlers) but guard against `document`
 * being undefined so they're safe to import anywhere.
 */

/**
 * Resolve `true` once an element matching `sel` exists in the DOM, or `false`
 * if it never appears within `timeout` ms. Uses a MutationObserver so
 * cross-page walkthrough steps wait for the new page to render.
 */
export function waitForTarget(sel: string, timeout = 8000): Promise<boolean> {
  return new Promise((resolve) => {
    if (typeof document === "undefined") {
      resolve(false);
      return;
    }
    if (document.querySelector(sel)) {
      resolve(true);
      return;
    }

    let settled = false;
    const finish = (value: boolean) => {
      if (settled) return;
      settled = true;
      observer.disconnect();
      clearTimeout(timer);
      resolve(value);
    };

    const observer = new MutationObserver(() => {
      if (document.querySelector(sel)) finish(true);
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });

    const timer = setTimeout(() => finish(false), timeout);
  });
}

/** True on `lg` and wider viewports (matches Tailwind's 1024px breakpoint, and
 * TraxStaff's own sidebar which is `hidden lg:block`). */
export function isDesktop(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return true;
  return window.matchMedia("(min-width: 1024px)").matches;
}

/** True when the user has asked the OS to reduce motion. */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
