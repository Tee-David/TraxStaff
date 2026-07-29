// Trax brand tokens. Values only — mobile derives StyleSheet from these, web
// derives CSS vars from its own copy. Never share components or classnames
// across web and mobile (checklist §6.1).

export const colors = {
  brand: "#000065",
  brandSoft: "#1a1a80",
  accent: "#FF6600",
  accentSoft: "#fff1e6",

  bg: "#f7f8fb",
  surface: "#ffffff",
  surfaceAlt: "#f1f3f9",

  text: "#0d1020",
  textMuted: "#5b6478",
  // 4.6:1 on #f7f8fb — the web app's --color-faint (#9aa3b2) fails contrast at
  // 2.6:1 (checklist §4.5); don't reintroduce it here.
  faint: "#6b7385",

  border: "#dfe3ee",
  borderStrong: "#c6ccdd",

  success: "#0f7b4f",
  danger: "#c02626",
  warning: "#b26b00",
} as const;

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
