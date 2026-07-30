"use client";

import { motion, useReducedMotion, type Transition, type TargetAndTransition } from "motion/react";
import {
  Activity,
  BadgeCheck,
  BarChart3,
  Bell,
  Briefcase,
  Calculator,
  CheckCircle2,
  Clock,
  Compass,
  Filter,
  Flag,
  Gauge,
  Image as ImageIcon,
  Inbox,
  KanbanSquare,
  LayoutGrid,
  Lock,
  MousePointerClick,
  PanelLeft,
  Plus,
  RotateCcw,
  Settings,
  ShieldCheck,
  Sparkles,
  Trophy,
  UserCog,
  Users,
  type LucideIcon,
} from "lucide-react";

/**
 * The tour's icon vocabulary. Every step names one of these; the tooltip header
 * renders it inside a brand-tinted disc with a gentle, looping animation.
 *
 * Kept as a plain map (no JSX) so `registry.ts` can import the `TourIconName`
 * union as a type without pulling a client component into its module graph.
 */
export const TOUR_ICONS = {
  activity: Activity,
  badgeCheck: BadgeCheck,
  barChart: BarChart3,
  bell: Bell,
  briefcase: Briefcase,
  calculator: Calculator,
  check: CheckCircle2,
  clock: Clock,
  compass: Compass,
  filter: Filter,
  flag: Flag,
  gauge: Gauge,
  image: ImageIcon,
  inbox: Inbox,
  kanban: KanbanSquare,
  layout: LayoutGrid,
  lock: Lock,
  pointer: MousePointerClick,
  panelLeft: PanelLeft,
  plus: Plus,
  replay: RotateCcw,
  settings: Settings,
  shieldCheck: ShieldCheck,
  sparkles: Sparkles,
  trophy: Trophy,
  userCog: UserCog,
  users: Users,
} satisfies Record<string, LucideIcon>;

export type TourIconName = keyof typeof TOUR_ICONS;

type MotionFamily = "float" | "pulse" | "wiggle" | "spin" | "bob" | "nudge";

/** Each family is a small, low-amplitude loop — presence, never distraction. */
const FAMILIES: Record<MotionFamily, { animate: TargetAndTransition; transition: Transition }> = {
  float: {
    animate: { y: [0, -2.5, 0] },
    transition: { duration: 2.6, repeat: Infinity, ease: "easeInOut" },
  },
  pulse: {
    animate: { scale: [1, 1.12, 1] },
    transition: { duration: 2, repeat: Infinity, ease: "easeInOut" },
  },
  wiggle: {
    animate: { rotate: [0, -9, 8, -4, 0] },
    transition: { duration: 1.6, repeat: Infinity, repeatDelay: 1.6, ease: "easeInOut" },
  },
  spin: {
    animate: { rotate: 360 },
    transition: { duration: 10, repeat: Infinity, ease: "linear" },
  },
  bob: {
    animate: { y: [0, -1.5, 0], scale: [1, 1.06, 1] },
    transition: { duration: 2.8, repeat: Infinity, ease: "easeInOut" },
  },
  nudge: {
    animate: { x: [0, 2.5, 0], y: [0, 2.5, 0] },
    transition: { duration: 1.4, repeat: Infinity, repeatDelay: 0.6, ease: "easeInOut" },
  },
};

/** Icon → motion family. Anything unmapped floats. */
const ICON_MOTION: Partial<Record<TourIconName, MotionFamily>> = {
  activity: "pulse",
  bell: "wiggle",
  compass: "spin",
  check: "pulse",
  badgeCheck: "pulse",
  clock: "spin",
  flag: "wiggle",
  gauge: "pulse",
  pointer: "nudge",
  panelLeft: "nudge",
  plus: "pulse",
  replay: "spin",
  settings: "spin",
  sparkles: "pulse",
  trophy: "wiggle",
  lock: "wiggle",
};

/**
 * Animated step icon. Renders a lucide glyph in a brand disc with a soft halo
 * that breathes behind it. All motion is disabled under `prefers-reduced-motion`
 * (via `useReducedMotion`), leaving a clean static icon.
 */
export function TourIcon({
  name = "sparkles",
  className,
}: {
  name?: TourIconName;
  className?: string;
}) {
  const reduced = useReducedMotion();
  const Icon = TOUR_ICONS[name] ?? Sparkles;
  const family = FAMILIES[ICON_MOTION[name] ?? "float"];

  return (
    <span
      className={`relative grid size-9 shrink-0 place-items-center rounded-full bg-brand/10 text-brand ${className ?? ""}`}
    >
      {!reduced && (
        <motion.span
          aria-hidden
          className="absolute inset-0 rounded-full bg-brand/10"
          animate={{ scale: [1, 1.3, 1], opacity: [0.55, 0, 0.55] }}
          transition={{ duration: 3, repeat: Infinity, ease: "easeOut" }}
        />
      )}
      <motion.span
        className="relative grid place-items-center"
        animate={reduced ? undefined : family.animate}
        transition={reduced ? undefined : family.transition}
      >
        <Icon className="size-[18px]" strokeWidth={2} aria-hidden />
      </motion.span>
    </span>
  );
}
