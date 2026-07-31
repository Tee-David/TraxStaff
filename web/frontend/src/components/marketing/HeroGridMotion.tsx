"use client";

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
 * These are the app's own screenshots. There is no stock photography in this
 * repo, and hotlinking a photo CDN from the production marketing page would put
 * a third party in the render path of the first thing anyone sees — so the tiles
 * use the eight real captures in `public/screens` instead. At the opacity this
 * runs at they read as texture rather than as content, which is the point: you
 * should register movement and warmth behind the headline, not screenshots.
 *
 * To swap in licensed stock photography, drop the files in `public/` and change
 * `TILE_IMAGES` below. Nothing else needs to move — tile size, count and the
 * per-row timing are all independent of what's inside them.
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

const TILE_IMAGES = [
  "/screens/desktop-dashboard.webp",
  "/screens/feature-timesheets.webp",
  "/screens/mobile-timer.webp",
  "/screens/feature-reports.webp",
  "/screens/tablet-dashboard.webp",
  "/screens/feature-projects.webp",
  "/screens/desktop-tracker.webp",
  "/screens/feature-activity.webp",
];

/**
 * Seconds for one full pass, per row. Deliberately uneven and mutually
 * non-multiple: rows on tidy round durations drift back into alignment every so
 * often and the whole field briefly reads as one sliding sheet.
 */
const ROW_DURATIONS = ["82s", "104s", "71s", "119s", "93s", "134s"];

/**
 * Which image each tile gets. A fixed function of the index rather than
 * `Math.random()`, so the server and the client render identical markup and the
 * layout doesn't reshuffle on hydration. The stride is coprime with the image
 * count, so no row repeats an image until it has used all eight, and adjacent
 * rows start on different ones.
 */
function imageFor(row: number, col: number) {
  return TILE_IMAGES[(row * 3 + col * 5) % TILE_IMAGES.length];
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
