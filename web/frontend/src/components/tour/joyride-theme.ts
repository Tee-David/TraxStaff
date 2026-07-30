import type { Locale, Options } from "react-joyride";

/**
 * Brand theme for react-joyride.
 *
 * The tooltip itself is a custom component (`tour-tooltip.tsx`) styled with the
 * usual Tailwind tokens, so the only thing left for joyride to theme is the
 * chrome around it: the overlay, the spotlight cutout and the arrow. Colors use
 * CSS custom properties so tours stay legible in dark mode.
 *
 * `zIndex` is raised to 10000 so the spotlight/tooltip sit above the mobile
 * drawer (z-50 in `app/layout.tsx`) and the sticky topbar (z-30).
 */
export const LOCALE: Locale = {
  back: "Back",
  close: "Close",
  last: "Done",
  next: "Next",
  skip: "Skip tour",
};

export const BRAND_OPTIONS: Partial<Options> = {
  skipBeacon: true,
  zIndex: 10000,
  buttons: ["back", "skip", "primary"],
  // Joyride derives hover/lighten-darken shades from this internally, so it
  // needs a literal color rather than a `var()` the color-math can't parse.
  // This is Trax's brand navy (`--color-brand` in light mode).
  primaryColor: "#000065",
  textColor: "var(--color-ink, #12162b)",
  backgroundColor: "var(--color-surface, #ffffff)",
  arrowColor: "var(--color-surface, #ffffff)",
  overlayColor: "rgba(18, 22, 43, 0.55)",
  spotlightRadius: 14,
  // Interactive steps need clicks to reach the real UI through the cutout.
  blockTargetInteraction: false,
  // A stray overlay click shouldn't silently skip a step — the tooltip's own
  // Back / Skip / Next buttons are the only way through.
  overlayClickAction: false,
  // The custom tooltip draws its own progress rail and "Step N of M" line.
  showProgress: false,
};
