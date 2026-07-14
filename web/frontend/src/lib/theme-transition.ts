import { flushSync } from "react-dom";

export function toggleThemeWithTransition(
  e: React.MouseEvent,
  theme: "light" | "dark",
  setTheme: (theme: "light" | "dark") => void,
  variant: "circle" = "circle"
) {
  if (typeof document.startViewTransition !== "function") {
    setTheme(theme);
    return;
  }

  const x = e.clientX;
  const y = e.clientY;
  const maxRadius = Math.hypot(
    Math.max(x, window.innerWidth - x),
    Math.max(y, window.innerHeight - y)
  );

  const transition = document.startViewTransition(() => {
    flushSync(() => setTheme(theme));
  });

  transition.ready.then(() => {
    const clipPath = [
      `circle(0px at ${x}px ${y}px)`,
      `circle(${maxRadius}px at ${x}px ${y}px)`,
    ];

    document.documentElement.animate(
      { clipPath },
      {
        duration: 500,
        easing: "ease-in-out",
        pseudoElement: "::view-transition-new(root)",
      }
    );
  });
}
