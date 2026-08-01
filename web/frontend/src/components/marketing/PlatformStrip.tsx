"use client";

import { motion } from "motion/react";
import { useMotionPresets } from "@/lib/motion";
import { IconWindows, IconLinux, IconAndroid, IconApple } from "@/components/icons";

/**
 * Stands in for the usual client-logo strip. There are no named customers to
 * show, so this shows what's actually shipped instead: real platform support,
 * plainly labeled, including the one that isn't ready yet.
 *
 * Now the bottom row of the hero rather than a band beneath it, so "one
 * tracker, every machine your team works on" is read together with the
 * headline instead of after it. Two things follow from that: it sits on the
 * hero's own background with a hairline rule and no fill of its own, and its
 * height is part of the hero's one-screen budget — hence the vh-aware padding
 * and the tighter phone scale.
 *
 * The "Soon" badge on iOS stays visible at every width. It's the one label
 * here that would be a lie by omission if it were dropped to save room.
 */
const platforms = [
  { icon: IconWindows, label: "Windows", available: true },
  { icon: IconLinux, label: "Linux", available: true },
  { icon: IconAndroid, label: "Android", available: true },
  { icon: IconApple, label: "iOS", available: false },
];

export function PlatformRail() {
  const { revealStagger, item } = useMotionPresets();

  return (
    /* The hero it sits on is a dark stage in both themes (see `.mk-hero` in
       globals.css), so the rule and every label here are written white. */
    <motion.div {...revealStagger()} className="relative z-10 shrink-0 border-t border-white/12">
      <div className="mx-auto flex max-w-6xl flex-col items-center gap-2 px-5 py-[clamp(0.625rem,1.7vh,1.25rem)] sm:flex-row sm:justify-between sm:gap-10 sm:px-8">
        <motion.p
          {...item}
          className="text-center text-xs leading-snug text-white/80 sm:max-w-xs sm:text-left sm:text-sm"
        >
          One tracker, every machine your team works on
        </motion.p>

        {/* `flex-nowrap` with the phone scale below is sized to keep all four on
            one line at 360px, so the rail stays one row tall in the hero's
            height budget. */}
        <div className="flex flex-nowrap items-center justify-center gap-x-4 sm:gap-x-9 lg:gap-x-11">
          {platforms.map(({ icon: Icon, label, available }) => (
            <motion.div
              key={label}
              {...item}
              className={`flex shrink-0 items-center gap-1.5 sm:gap-2 ${
                available ? "text-white" : "text-white/55"
              }`}
            >
              <Icon className="h-3.5 w-3.5 sm:h-5 sm:w-5" />
              <span className="text-[11px] font-semibold tracking-tight sm:text-sm">{label}</span>
              {!available && (
                <span className="rounded-full border border-white/35 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.1em] text-white/55 sm:px-2 sm:text-[10px]">
                  Soon
                </span>
              )}
            </motion.div>
          ))}
        </div>
      </div>
    </motion.div>
  );
}
