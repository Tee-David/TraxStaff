// Resolves the app's light/dark palette from a stored user preference, falling
// back to the OS setting when the preference is "system" (the default before
// anything has been chosen). This is the one place that reads/writes the
// preference — the Profile screen's segmented control calls `setPreference`
// rather than touching AsyncStorage itself, so there is exactly one writer.

import AsyncStorage from "@react-native-async-storage/async-storage";
import { createContext, ReactNode, useContext, useEffect, useMemo, useState } from "react";
import { useColorScheme } from "react-native";
import { Colors, ColorScheme, palettes } from "./theme";

// Preference-only key, not a secret — deliberately NOT in secureStorage.ts,
// which is reserved for credentials held in the Android Keystore. Shared with
// app/(tabs)/profile.tsx's Appearance picker; there must only ever be one
// reader/writer of this key.
export const THEME_PREF_KEY = "trax.themePreference";

export type ThemePreference = "light" | "dark" | "system";

type ThemeContextValue = {
  /** What the user picked — may be "system", unlike `scheme`. */
  preference: ThemePreference;
  /** The actual palette in effect right now: "system" resolved against the OS. */
  scheme: ColorScheme;
  colors: Colors;
  setPreference: (pref: ThemePreference) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

function isThemePreference(value: unknown): value is ThemePreference {
  return value === "light" || value === "dark" || value === "system";
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const osScheme = useColorScheme();
  const [preference, setPreferenceState] = useState<ThemePreference>("system");

  useEffect(() => {
    void AsyncStorage.getItem(THEME_PREF_KEY).then((stored) => {
      if (isThemePreference(stored)) setPreferenceState(stored);
    });
  }, []);

  const setPreference = (pref: ThemePreference) => {
    setPreferenceState(pref);
    void AsyncStorage.setItem(THEME_PREF_KEY, pref);
  };

  const scheme: ColorScheme = preference === "system" ? (osScheme === "dark" ? "dark" : "light") : preference;
  const colors = palettes[scheme];

  const value = useMemo<ThemeContextValue>(
    () => ({ preference, scheme, colors, setPreference }),
    [preference, scheme, colors]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme() must be called under <ThemeProvider>");
  return ctx;
}
