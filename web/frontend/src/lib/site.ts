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

/**
 * Public base for our own static marketing assets on Cloudflare R2 (bucket
 * `trax`, prefix `marketing/`). Uploaded with a year of immutable caching, so a
 * changed asset means a new filename, never a new cache header.
 *
 * NOTE: this is the bucket's `r2.dev` development domain. Cloudflare rate-limits
 * that domain and explicitly does not support it for production traffic — it
 * also doesn't get the full CDN treatment a custom domain does. Point a custom
 * hostname (`assets.traxstaff.com`) at the bucket in the Cloudflare dashboard
 * and change this one constant; nothing else references the host.
 */
export const ASSETS_URL = "https://pub-9027425bcecb4f0a810f07b3aa12febf.r2.dev";
