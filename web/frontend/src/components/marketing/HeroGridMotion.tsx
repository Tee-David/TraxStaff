"use client";

import { ASSETS_URL } from "@/lib/site";

/**
 * The hero's background texture: rows of image tiles, rotated off-axis, each row
 * drifting on its own in the opposite direction to the one above it.
 *
 * Adapted from the ReactBits `GridMotion` component, but the motion model is the
 * opposite of that one's. The original ties row position to `mousemove`, so the
 * background is dead until you move the pointer and then lurches with it. This
 * runs by itself, at a constant speed, and ignores the pointer and the scroll
 * position entirely — closer to the marquees further down the page, which is
 * also why it reuses their technique: a CSS transform animation on a track
 * holding the row plus one clone. That runs on the compositor, so a background
 * that never stops costs no main-thread work and can't compete with scrolling.
 *
 * No GSAP, no listeners, no state. The whole thing is markup plus the CSS in
 * globals.css.
 *
 * IMAGERY
 * -------
 * Stock photography, but ours: downloaded, re-encoded and served from our own
 * Cloudflare R2 bucket rather than hotlinked from a photo CDN, so nothing
 * third-party sits in the render path of the first thing anyone sees. Full
 * provenance for each file is in `web/frontend/HERO-ASSETS.md`.
 *
 * Two rules picked the set, and both should hold for any replacement:
 *
 *  1. CC0 / public domain only. Those are the licences that permit commercial
 *     use *and* redistribution (which self-hosting is) with no attribution
 *     obligation — an attribution requirement on a decorative background is not
 *     a trade worth making.
 *  2. No identifiable faces. A CC0 licence clears copyright, not personality
 *     rights: using a recognisable person to advertise a product is a separate
 *     permission that a photo licence does not grant, and the CC0 pools contain
 *     press and personal photography where no model release exists. Every tile
 *     here is desks, screens, hands or backs of heads — which is also the better
 *     texture, since a face is the one thing an eye will always try to resolve.
 *
 * They're sized for the job rather than for a photo: 640×400 WebP, ~14 KB each,
 * ~170 KB for the set. At 10–16% opacity, rotated, behind a mask, on tiles at
 * most ~512 CSS px wide, nothing larger is resolvable.
 *
 * To swap the set: replace the objects in `TILE_IMAGES`, upload to the same
 * prefix, and update HERO-ASSETS.md. Tile size, count and per-row timing are all
 * independent of what's inside them.
 */

/** Rows down the grid. Each one scrolls opposite to its neighbours. */
const ROWS = 6;

/**
 * Tiles in a single row, before cloning.
 *
 * The loop translates the track by half its width, so one row has to be at
 * least as wide as the (oversized, rotated) container or a bare edge scrolls
 * into view. Seven tiles clears that from a 360px phone up to a 2560px monitor —
 * see the sizing note in globals.css.
 */
const TILES_PER_ROW = 7;

const TILE_IMAGES = Array.from(
  { length: 12 },
  (_, i) => `${ASSETS_URL}/marketing/hero/tile-${String(i + 1).padStart(2, "0")}.webp`
);

/**
 * Seconds for one full pass, per row. Deliberately uneven and mutually
 * non-multiple: rows on tidy round durations drift back into alignment every so
 * often and the whole field briefly reads as one sliding sheet.
 */
const ROW_DURATIONS = ["82s", "104s", "71s", "119s", "93s", "134s"];

/**
 * Which image each tile gets. A fixed function of the index rather than
 * `Math.random()`, so the server and the client render identical markup and the
 * layout doesn't reshuffle on hydration.
 *
 * Both strides are coprime with 12: the column stride means a row of seven
 * tiles never repeats an image, and the row stride means each row starts
 * somewhere different, so no two rows scroll the same sequence past each other.
 */
function imageFor(row: number, col: number) {
  return TILE_IMAGES[(row * 7 + col * 5) % TILE_IMAGES.length];
}

function Tile({ row, col }: { row: number; col: number }) {
  return (
    <span
      className="mk-hero-motion-tile"
      style={{ backgroundImage: `url(${imageFor(row, col)})` }}
    />
  );
}

export function HeroGridMotion() {
  return (
    <div className="mk-hero-motion" aria-hidden>
      <div className="mk-hero-motion-grid">
        {Array.from({ length: ROWS }, (_, row) => {
          const tiles = Array.from({ length: TILES_PER_ROW }, (_, col) => (
            <Tile key={col} row={row} col={col} />
          ));

          return (
            <div key={row} className="mk-hero-motion-row">
              {/* Alternating rows run the animation in reverse, so every row
                  travels against the two beside it. */}
              <div
                className={`mk-hero-motion-track ${
                  row % 2 === 1 ? "mk-hero-motion-track--reverse" : ""
                }`}
                style={{ "--mk-row-duration": ROW_DURATIONS[row % ROW_DURATIONS.length] } as React.CSSProperties}
              >
                {tiles}
                {/* The clone is what makes the wrap seamless. */}
                {Array.from({ length: TILES_PER_ROW }, (_, col) => (
                  <Tile key={`clone-${col}`} row={row} col={col} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
