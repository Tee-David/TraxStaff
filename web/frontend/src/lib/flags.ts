/**
 * The risk and anomaly flags the detector can raise, in one place.
 *
 * The labels used to be copy-pasted into the insights page and the notification
 * describer, which is how the bell and the flags card ended up saying two
 * different things about the same row. One definition, imported by both.
 *
 * The descriptions exist because the labels alone are jargon: nobody outside
 * this codebase knows what "input channel imbalance" means, and an admin who
 * cannot read a flag either ignores it or — worse — treats it as proof of
 * something it does not prove. So each one says, in plain words, what the
 * detector actually saw, and stops short of saying what it means about the
 * person. They are deliberately written to a reader who has never used
 * TraxStaff before.
 *
 * The mechanics behind each are in `web/backend/src/lib/anomaly.ts` (the first
 * three, computed from activity blocks) and `web/backend/src/routes/sync.ts`
 * (the rest, checked at ingestion). If a threshold changes there, the wording
 * here should change with it.
 */

export type FlagType =
  | "sustained_high_activity"
  | "low_variance_robotic"
  | "input_channel_imbalance"
  | "jiggler_process_detected"
  | "clock_skew_detected"
  | "exceeds_elapsed_cap"
  | "block_outside_session_window";

export interface FlagInfo {
  /** The short name on the badge. */
  label: string;
  /** What the detector saw, in everyday words. */
  description: string;
}

export const FLAGS: Record<FlagType, FlagInfo> = {
  sustained_high_activity: {
    label: "Sustained high activity",
    description:
      "The keyboard and mouse were in near-constant use for more than half an hour without a natural pause. Real work usually has small gaps in it. Long focused stretches do happen, so this one is a prompt to look, not a conclusion.",
  },
  low_variance_robotic: {
    label: "Robotic / low variance",
    description:
      "Activity stayed at almost exactly the same level for a long stretch. People naturally speed up and slow down; input that holds perfectly steady is more typical of a script or a tool moving things automatically.",
  },
  input_channel_imbalance: {
    label: "Input channel imbalance",
    description:
      "For nearly an hour, one input was busy while the other was almost completely unused: lots of mouse movement with virtually no typing, or the reverse. Most real work uses both.",
  },
  jiggler_process_detected: {
    label: "Mouse-jiggler detected",
    description:
      "A known “mouse jiggler” app was running on the computer. These move the pointer on their own so a machine keeps looking busy while nobody is actually at it.",
  },
  clock_skew_detected: {
    label: "System clock changed",
    description:
      "The computer’s clock was moved while tracking was running. Sleep and hibernation do not cause this. Changing the clock can make recorded time come out longer or shorter than the work really was.",
  },
  exceeds_elapsed_cap: {
    label: "Claimed more time than elapsed",
    description:
      "The tracker app reported more worked time for this session than has actually passed since the session started, measured on our own server clock rather than the device's. This looks only at time the tracker itself recorded; hours an admin or owner adds by hand are never counted here, so approving manual time cannot cause this flag. The usual innocent causes are a device clock that is wrong, or the same stretch of time being sent twice after a failed upload was retried.",
  },
  block_outside_session_window: {
    label: "Time recorded outside the session",
    description:
      "Every session runs between a start time and a stop time, and all the time it records should fall between those two. Here some of it did not: the tracker sent time stamped from before this session started, from after it had already stopped, or from a moment that has not happened yet. Almost always this means the clock on that computer is set wrong.",
  },
};

/** Just the labels, for the places that only need a name. */
export const FLAG_LABELS: Record<string, string> = Object.fromEntries(
  Object.entries(FLAGS).map(([type, info]) => [type, info.label])
);

/**
 * Label for a flag type, falling back to the raw key.
 *
 * The fallback is load-bearing: the backend can start emitting a new flag type
 * before this build knows about it, and showing the raw key is far better than
 * showing nothing at all.
 */
export function flagLabel(type: string): string {
  return FLAGS[type as FlagType]?.label ?? type;
}

/** Plain-language explanation, or null for a type this build has not heard of. */
export function flagDescription(type: string): string | null {
  return FLAGS[type as FlagType]?.description ?? null;
}
