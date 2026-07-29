"use client";

import { motion } from "motion/react";
import { useMotionPresets } from "@/lib/motion";

/**
 * Per-route entrance animation.
 *
 * This lives in a `template` rather than the layout on purpose. The layout used
 * to wrap `children` in `<AnimatePresence mode="wait">` keyed by pathname, which
 * left pages blank until a manual reload: `mode="wait"` holds the incoming child
 * unmounted until the outgoing one finishes exiting, and on an App Router
 * navigation `children` has already been swapped underneath it, so the exit that
 * was being waited on never completes for the element React is now reconciling.
 *
 * Next remounts a template on every navigation, which is exactly the trigger an
 * entrance animation needs, with no bookkeeping to get wrong. The trade is that
 * exit animations are not possible here — worth it to never show an empty page.
 */
export default function AppTemplate({ children }: { children: React.ReactNode }) {
  const { page } = useMotionPresets();

  return (
    <motion.div initial={page.initial} animate={page.animate} transition={page.transition}>
      {children}
    </motion.div>
  );
}
