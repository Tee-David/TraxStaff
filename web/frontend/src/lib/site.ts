/**
 * The marketing site (`traxstaff.com` / `www.traxstaff.com`) and the
 * dashboard app (`app.traxstaff.com`) are the same Next.js deployment split
 * by hostname in `middleware.ts` — but `page.tsx` only ever renders for the
 * marketing hostnames (every other hostname is redirected to `/app` before
 * it gets here, see `middleware.ts`). So links from the marketing page to
 * the dashboard always need the app's own origin, not a same-origin
 * relative path — a relative `/login` from `traxstaff.com` would load the
 * login form on the wrong hostname and set its auth cookie there instead of
 * on `app.traxstaff.com`, where the rest of the dashboard actually lives.
 */
export const APP_URL = "https://app.traxstaff.com";
export const SUPPORT_EMAIL = "info@traxstaff.com";
