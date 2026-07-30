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
    <section className="border-y border-border bg-canvas/60 py-10">
      <div className="mx-auto max-w-6xl px-5 sm:px-8">
        <p className="text-center text-xs font-semibold uppercase tracking-wide text-faint">
          Available on
        </p>
        <motion.div
          {...stagger()}
          className="mt-5 flex flex-wrap items-center justify-center gap-x-10 gap-y-5"
        >
          {platforms.map(({ icon: Icon, label, available }) => (
            <motion.div
              key={label}
              {...item}
              className={`flex items-center gap-2 ${available ? "text-ink" : "text-faint"}`}
            >
              <Icon width={22} height={22} />
              <span className="text-sm font-medium">{label}</span>
              {!available && (
                <span className="rounded-full bg-canvas px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-faint">
                  Coming soon
                </span>
              )}
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
