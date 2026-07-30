// Trax brand tokens. Values only — mobile derives StyleSheet from these, web
// derives CSS vars from its own copy. Never share components or classnames
// across web and mobile (checklist §6.1).
//
// Two palettes, same keys, so any consumer can swap the whole set at once via
// ThemeProvider/useTheme() (src/ThemeProvider.tsx) without knowing which
// scheme is active. Dark values are chosen to match the web app's
// `:root[data-theme="dark"]` tokens (web/frontend/src/app/globals.css) so both
// clients read as the same product, not just independently "dark".

export const lightColors = {
  brand: "#000065",
  brandSoft: "#1a1a80",
  accent: "#FF6600",
  accentSoft: "#fff1e6",

  bg: "#f7f8fb",
  surface: "#ffffff",
  surfaceAlt: "#f1f3f9",

  // Foregrounds for anything sitting on a filled surface — brand navy, accent
  // orange or danger red. `onBrandMuted` is only legible on the navy.
  onDark: "#ffffff",
  onBrandMuted: "#a7abe0",

  text: "#0d1020",
  textMuted: "#5b6478",
  // 4.6:1 on #f7f8fb — the web app's --color-faint (#9aa3b2) fails contrast at
  // 2.6:1 (checklist §4.5); don't reintroduce it here.
  faint: "#6b7385",

  border: "#dfe3ee",
  borderStrong: "#c6ccdd",

  success: "#0f7b4f",
  danger: "#c02626",
  // Soft red wash behind an error Banner's text — was inlined as `#fdeceb` at
  // the one call site; promoted to a token so dark mode gets a real value
  // instead of that literal (a light pink patch) leaking onto a dark screen.
  dangerSoft: "#fdeceb",
  warning: "#b26b00",
} as const;

export const darkColors = {
  // Web's dark mode lightens the navy to `#5468ff` because raw #000065 on a
  // near-black canvas is close to invisible (~1.3:1) — same reasoning here.
  brand: "#5468ff",
  brandSoft: "#6d7dff",
  accent: "#FF6600",
  // A dark, warm-tinted surface rather than the light theme's pale wash — the
  // light accentSoft (#fff1e6) would read as a glowing card on a dark screen.
  accentSoft: "#402a12",

  bg: "#0a0e1a",
  surface: "#121829",
  surfaceAlt: "#1a2138",

  onDark: "#ffffff",
  // Lighter than the light theme's onBrandMuted to stay legible on the lit
  // #5468ff brand fill instead of the deep #000065 one.
  onBrandMuted: "#cfd4ff",

  text: "#eef1f8",
  textMuted: "#9aa4bd",
  faint: "#6a7391",

  border: "#242c42",
  borderStrong: "#354063",

  success: "#35c281",
  danger: "#f4685f",
  // Dark, warm-red surface — the light theme's pale pink wash would glow on a
  // near-black screen the same way accentSoft would.
  dangerSoft: "#3a1a1a",
  warning: "#e8a33d",
} as const;

export type ColorScheme = "light" | "dark";
// Plain strings, not the literal union each palette's `as const` infers —
// otherwise the dark palette (different literal hex values) couldn't satisfy
// the same type as the light one.
export type Colors = { [K in keyof typeof lightColors]: string };

export const palettes: Record<ColorScheme, Colors> = {
  light: lightColors,
  dark: darkColors,
};

export const fonts = {
  heading: "SpaceGrotesk_700Bold",
  headingMedium: "SpaceGrotesk_500Medium",
  body: "Outfit_400Regular",
  bodyMedium: "Outfit_500Medium",
  bodySemi: "Outfit_600SemiBold",
} as const;

export const radius = { sm: 8, md: 12, lg: 18, xl: 26 } as const;

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

export const shadow = {
  // Soft card shadow — the clean minimal SaaS look the desktop/web apps use.
  shadowColor: "#0d1020",
  shadowOpacity: 0.06,
  shadowRadius: 14,
  shadowOffset: { width: 0, height: 4 },
  elevation: 2,
} as const;
