"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { useReducedMotion } from "motion/react";

/**
 * Animated theme toggle — the MagicUI component, written out here rather than
 * pulled from the registry (this project isn't a shadcn install, and the
 * registry isn't reachable from CI).
 *
 * It flips the theme inside a View Transition and animates
 * `::view-transition-new(root)` with a clip-path that grows from the button —
 * so the new theme wipes over the old one in the chosen shape instead of
 * cutting. Browsers without `startViewTransition`, and anyone who asked for
 * reduced motion, get the plain switch.
 *
 * Controlled or not: pass `theme` and `onThemeChange` and the parent owns
 * persistence (that's how the marketing nav uses it, against the app's own
 * `data-theme` + `trax_theme` storage). Left uncontrolled it falls back to
 * toggling the `dark` class and remembering the choice itself.
 */
export type TransitionVariant =
  | "circle"
  | "square"
  | "triangle"
  | "diamond"
  | "rectangle"
  | "hexagon"
  | "star";

type Theme = "light" | "dark";

/** Unit outlines, drawn around the origin and scaled by the reveal radius. */
const SHAPES: Record<Exclude<TransitionVariant, "circle">, [number, number][]> = {
  square: [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ],
  rectangle: [
    [-1.6, -0.9],
    [1.6, -0.9],
    [1.6, 0.9],
    [-1.6, 0.9],
  ],
  triangle: [
    [0, -1.25],
    [1.15, 1],
    [-1.15, 1],
  ],
  diamond: [
    [0, -1.3],
    [1.3, 0],
    [0, 1.3],
    [-1.3, 0],
  ],
  hexagon: Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 3) * i - Math.PI / 2;
    return [Math.cos(a) * 1.15, Math.sin(a) * 1.15] as [number, number];
  }),
  star: Array.from({ length: 10 }, (_, i) => {
    const a = (Math.PI / 5) * i - Math.PI / 2;
    const r = i % 2 === 0 ? 1.45 : 0.62;
    return [Math.cos(a) * r, Math.sin(a) * r] as [number, number];
  }),
};

function clipAt(variant: TransitionVariant, x: number, y: number, radius: number) {
  if (variant === "circle") return `circle(${radius}px at ${x}px ${y}px)`;
  const points = SHAPES[variant]
    .map(([px, py]) => `${(x + px * radius).toFixed(1)}px ${(y + py * radius).toFixed(1)}px`)
    .join(", ");
  return `polygon(${points})`;
}

export function AnimatedThemeToggler({
  className = "",
  duration = 400,
  variant = "circle",
  fromCenter = false,
  theme,
  onThemeChange,
}: {
  className?: string;
  duration?: number;
  variant?: TransitionVariant;
  fromCenter?: boolean;
  theme?: Theme;
  onThemeChange?: (theme: Theme) => void;
}) {
  const controlled = theme !== undefined;
  const [ownTheme, setOwnTheme] = useState<Theme>("light");
  const [mounted, setMounted] = useState(false);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const reduce = useReducedMotion() ?? false;

  useEffect(() => {
    setMounted(true);
    if (controlled) return;
    const saved = (localStorage.getItem("theme") as Theme) || "light";
    setOwnTheme(saved);
    document.documentElement.classList.toggle("dark", saved === "dark");
  }, [controlled]);

  const current = controlled ? theme : ownTheme;

  const apply = useCallback(
    (next: Theme) => {
      if (controlled) {
        onThemeChange?.(next);
        return;
      }
      setOwnTheme(next);
      document.documentElement.classList.toggle("dark", next === "dark");
      try {
        localStorage.setItem("theme", next);
      } catch {
        /* private mode — the class is still flipped for this page */
      }
    },
    [controlled, onThemeChange]
  );

  const toggle = useCallback(async () => {
    const next: Theme = current === "dark" ? "light" : "dark";

    if (reduce || typeof document.startViewTransition !== "function") {
      apply(next);
      return;
    }

    const rect = buttonRef.current?.getBoundingClientRect();
    const x = fromCenter || !rect ? window.innerWidth / 2 : rect.left + rect.width / 2;
    const y = fromCenter || !rect ? window.innerHeight / 2 : rect.top + rect.height / 2;
    // Far enough to cover the furthest corner from wherever it started.
    const radius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));

    const transition = document.startViewTransition(() => {
      // Not flushSync'd: React 19 batches this into the transition's own
      // callback frame, which is what the snapshot is taken against.
      apply(next);
    });

    try {
      await transition.ready;
      document.documentElement.animate(
        { clipPath: [clipAt(variant, x, y, 0), clipAt(variant, x, y, radius)] },
        { duration, easing: "cubic-bezier(0.22, 0.61, 0.36, 1)", pseudoElement: "::view-transition-new(root)" }
      );
    } catch {
      /* the transition was skipped — the theme still changed */
    }
  }, [apply, current, duration, fromCenter, reduce, variant]);

  const next: Theme = current === "dark" ? "light" : "dark";

  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={toggle}
      aria-label={`Switch to the ${next} theme`}
      title={`Switch to the ${next} theme`}
      className={className}
    >
      {/* Nothing until mounted: the saved theme isn't known during the server
          render, and a sun that flips to a moon on load is worse than an icon
          that arrives a frame late. The box is sized by `className`, so
          nothing shifts when it does. */}
      {mounted && (current === "dark" ? <Sun size={17} strokeWidth={1.8} /> : <Moon size={17} strokeWidth={1.8} />)}
    </button>
  );
}
