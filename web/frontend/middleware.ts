import { NextResponse, type NextRequest } from "next/server";

/**
 * Splits the marketing site from the dashboard app by hostname — both are
 * served from this one Next.js deployment (no second Vercel project).
 *
 *   traxstaff.com / www.traxstaff.com  -> `/` renders the real landing page
 *                                          (`src/app/page.tsx`), untouched.
 *   every other hostname (app.traxstaff.com, any *.vercel.app preview,
 *   localhost in dev)                 -> `/` redirects to `/app`, exactly
 *                                          what `page.tsx` used to do itself
 *                                          before this milestone.
 *
 * Why this lives in middleware instead of a `headers()` check inside
 * `page.tsx`: calling `headers()`/`cookies()` in a Server Component marks
 * the whole route dynamic, opting the marketing page — the one route on
 * this site that most benefits from being statically pre-rendered — out of
 * static generation for no real gain. Rewriting the apex to a separate
 * route (e.g. `/(marketing)/page.tsx`) was the other option, but the brief
 * wants the landing content to live directly in `page.tsx`. Doing the
 * hostname check here, and only ever redirecting the *other* hostnames,
 * gets both: `page.tsx` stays a plain, statically-optimizable Server
 * Component, and every non-apex hostname keeps behaving exactly as it does
 * today.
 *
 * `matcher` below limits this to the root path only — `/login`, `/app/*`,
 * `/api/*`, static assets, etc. are never touched, on any hostname.
 */
const MARKETING_HOSTNAMES = new Set(["traxstaff.com", "www.traxstaff.com"]);

export function middleware(request: NextRequest) {
  // `nextUrl.hostname` is already port-stripped and normalized by Next,
  // unlike the raw `host` header (which can carry `:3000` in dev).
  const { hostname } = request.nextUrl;

  if (MARKETING_HOSTNAMES.has(hostname)) {
    return NextResponse.next();
  }

  return NextResponse.redirect(new URL("/app", request.url));
}

export const config = {
  matcher: "/",
};
