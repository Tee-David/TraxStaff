"use client";

import { motion } from "motion/react";
import { useMotionPresets } from "@/lib/motion";
import { IconWindows, IconLinux, IconAndroid, IconApple } from "@/components/icons";

/**
 * Stands in for the usual client-logo strip. There are no named customers to
 * show, so this shows what's actually shipped instead: real platform support,
 * plainly labeled, including the one that isn't ready yet.
 */
const platforms = [
  { icon: IconWindows, label: "Windows", available: true },
  { icon: IconLinux, label: "Linux", available: true },
  { icon: IconAndroid, label: "Android", available: true },
  { icon: IconApple, label: "iOS", available: false },
];

export function PlatformStrip() {
  const { stagger, item } = useMotionPresets();

  return (
    <section className="border-y border-border bg-canvas/70">
      <div className="mx-auto max-w-6xl px-5 py-9 sm:px-8">
        <motion.div
          {...stagger()}
          className="flex flex-col items-center gap-6 sm:flex-row sm:justify-between sm:gap-10"
        >
          <motion.p {...item} className="max-w-xs text-center text-sm leading-snug text-muted sm:text-left">
            One tracker, every machine your team works on
          </motion.p>

          <div className="flex flex-wrap items-center justify-center gap-x-9 gap-y-4 sm:gap-x-11">
            {platforms.map(({ icon: Icon, label, available }) => (
              <motion.div
                key={label}
                {...item}
                className={`flex items-center gap-2 ${available ? "text-ink" : "text-faint"}`}
              >
                <Icon width={20} height={20} />
                <span className="text-sm font-semibold tracking-tight">{label}</span>
                {!available && (
                  <span className="rounded-full border border-border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-faint">
                    Soon
                  </span>
                )}
              </motion.div>
            ))}
          </div>
        </motion.div>
      </div>
    </section>
  );
}
