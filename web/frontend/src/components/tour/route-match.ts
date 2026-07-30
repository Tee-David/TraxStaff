/**
 * Route helpers for matching the current pathname to a page tour.
 *
 * `normalizeRoute` strips query/hash and trailing slashes. `pageTourIdFor`
 * maps a normalized route to the id of the page tour that covers it (or null
 * when none exists — e.g. `/app/projects/[id]`, a detail route driven by the
 * record in front of you rather than a fixed layout, intentionally has no
 * tour of its own).
 */

export function normalizeRoute(pathname: string): string {
  const clean = pathname.split(/[?#]/)[0].replace(/\/+$/, "") || "/";
  return clean;
}

/** Normalized route → page tour id. Mirrors `Sidebar.tsx`'s `MENU`/`SECONDARY`. */
const ROUTE_TO_TOUR: Record<string, string> = {
  "/app": "dashboard",
  "/app/timesheets": "timesheets",
  "/app/reports": "reports",
  "/app/screenshots": "screenshots",
  "/app/insights": "insights",
  "/app/projects": "projects",
  "/app/members": "members",
  "/app/settings": "settings",
};

export function pageTourIdFor(pathname: string): string | null {
  return ROUTE_TO_TOUR[normalizeRoute(pathname)] ?? null;
}
