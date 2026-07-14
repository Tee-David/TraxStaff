"use client";

import { useEffect, useState } from "react";

export type Theme = "light" | "dark";

export function useTheme(): [Theme, (t: Theme) => void] {
  const [theme, setThemeState] = useState<Theme>("light");

  useEffect(() => {
    const saved = (localStorage.getItem("trax_theme") as Theme) || "light";
    setThemeState(saved);
    document.documentElement.dataset.theme = saved;
  }, []);

  function setTheme(t: Theme) {
    setThemeState(t);
    document.documentElement.dataset.theme = t;
    try {
      localStorage.setItem("trax_theme", t);
    } catch {
      /* ignore */
    }
  }

  return [theme, setTheme];
}
