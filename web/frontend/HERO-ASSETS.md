# Hero background tiles — provenance

The images behind the marketing hero (`src/components/marketing/HeroGridMotion.tsx`).

**Where they live:** Cloudflare R2, bucket `trax`, prefix `marketing/hero/`.
Served from the base URL in `src/lib/site.ts` (`ASSETS_URL`).

**Why they're ours:** these were downloaded, re-encoded and uploaded to our own
bucket rather than hotlinked. Hotlinking a photo CDN would put a third party in
the render path of the first thing anyone sees on the site, and would leave the
page's appearance dependent on someone else's uptime and URL stability.

## Selection rules

Both of these should hold for any replacement:

1. **CC0 / public domain only.** These are the licences that allow commercial
   use *and* redistribution — which is what self-hosting is — with no
   attribution obligation. Anything CC-BY or CC-BY-SA would put an attribution
   requirement on a decorative background, which is not a trade worth making.
   Attribution is recorded below anyway, as a courtesy and so the trail exists.

2. **No identifiable faces.** A CC0 licence clears *copyright*. It does not
   clear **personality / publicity rights**, which are what govern using a
   recognisable person to advertise a product — that needs a model release, and
   the CC0 pools contain press and personal photography where none exists. The
   candidate set for this batch included a press photograph of a head of state
   and several photos of identifiable private individuals; all were rejected on
   this rule. Every file below is desks, screens, hands or backs of heads.

## Processing

Source images (4–8 MP JPEGs) → `640×400` WebP, quality 58.

That is deliberately far below normal hero-image quality, and it is correct
here: the tiles render at 10–16% opacity, rotated 15°, behind a radial mask,
on elements at most ~512 CSS px wide. Nothing finer is resolvable. The result
is ~14 KB per file and ~170 KB for the whole set.

Uploaded with `Cache-Control: public, max-age=31536000, immutable`. Filenames
are stable, so **a changed image means a new filename** — never a re-upload
under the same key, which a year of immutable caching would not pick up.

## Files

All sourced via [Openverse](https://openverse.org), all **CC0 1.0**.

| File | Subject | Source | Credited to |
|---|---|---|---|
| `tile-01.webp` | Laptop showing charts / dashboard | StockSnap | Negative Space |
| `tile-02.webp` | Laptop showing a kanban board | StockSnap | Châu Thông Phan |
| `tile-03.webp` | Hands on laptop over drawings | StockSnap | energepic.com |
| `tile-04.webp` | Laptop and hands writing, meeting table | StockSnap | Helloquence |
| `tile-05.webp` | Hands and laptops on a wooden table | StockSnap | Startup Stock Photos |
| `tile-06.webp` | Laptop on a dark surface | StockSnap | Nao Triponez |
| `tile-07.webp` | Overhead laptop and hands | StockSnap | Burst |
| `tile-08.webp` | Home office desk, no people | StockSnap | Kristin Hardwick |
| `tile-09.webp` | Laptop and coffee on a desk | StockSnap | Matt Moloney |
| `tile-10.webp` | Overhead hands on a laptop | StockSnap | Matt Moloney |
| `tile-11.webp` | Code on screen | StockSnap | One Idea LLC |
| `tile-12.webp` | Calculator and figures on paper | Rawpixel | — |

## Known follow-up

`ASSETS_URL` currently points at the bucket's `r2.dev` domain. Cloudflare
rate-limits that domain and states it is not for production traffic; it also
doesn't get the caching a custom hostname does. Attach `assets.traxstaff.com`
(or similar) to the bucket and change the one constant in `src/lib/site.ts`.
