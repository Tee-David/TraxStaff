import { prefersReducedMotion } from "./wait-for-target";

/**
 * Tiny, dependency-free confetti burst fired when a tour is completed (never on
 * skip). Paints onto a throwaway fixed canvas above the Joyride overlay
 * (zIndex 10000) and removes itself after the animation. No-ops when the user
 * prefers reduced motion.
 */

/** Trax brand navy + accent orange/teal/positive-green, plus white. */
const COLORS = ["#000065", "#ff6600", "#12b5a5", "#1f9d63", "#ffffff"];

const DURATION = 2000;
const PARTICLE_COUNT = 90;
const GRAVITY = 0.22;
const DRAG = 0.99;

type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  rot: number;
  vr: number;
};

export function fireConfetti(): void {
  if (typeof document === "undefined" || typeof window === "undefined") return;
  if (prefersReducedMotion()) return;

  const width = window.innerWidth;
  const height = window.innerHeight;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);

  const canvas = document.createElement("canvas");
  canvas.width = Math.floor(width * dpr);
  canvas.height = Math.floor(height * dpr);
  canvas.setAttribute("aria-hidden", "true");
  canvas.style.cssText =
    "position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:10001;";

  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  document.body.appendChild(canvas);
  ctx.scale(dpr, dpr);

  const originX = width / 2;
  const originY = height * 0.42;
  const particles: Particle[] = Array.from({ length: PARTICLE_COUNT }, (_, i) => {
    const angle = (Math.PI * 2 * i) / PARTICLE_COUNT + Math.random() * 0.3;
    const speed = 5 + Math.random() * 7;
    return {
      x: originX,
      y: originY,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 3, // bias upward for a nicer arc
      size: 5 + Math.random() * 5,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      rot: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.3,
    };
  });

  const start = performance.now();
  let raf = 0;
  let cleaned = false;

  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    cancelAnimationFrame(raf);
    clearTimeout(safety);
    canvas.remove();
  };

  const tick = (now: number) => {
    const elapsed = now - start;
    if (elapsed >= DURATION) {
      cleanup();
      return;
    }

    // Fade out over the last 40% of the run.
    const fadeStart = DURATION * 0.6;
    const alpha = elapsed > fadeStart ? 1 - (elapsed - fadeStart) / (DURATION - fadeStart) : 1;

    ctx.clearRect(0, 0, width, height);
    ctx.globalAlpha = Math.max(alpha, 0);

    for (const p of particles) {
      p.vy += GRAVITY;
      p.vx *= DRAG;
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.vr;

      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
      ctx.restore();
    }

    raf = requestAnimationFrame(tick);
  };

  // Safety net in case rAF is throttled (e.g. the tab is backgrounded).
  const safety = setTimeout(cleanup, DURATION + 500);
  raf = requestAnimationFrame(tick);
}
