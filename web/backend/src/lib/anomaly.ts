import type { ActivityBlock } from "@prisma/client";

// Server-side "unusual activity" detection, thresholds adapted from Hubstaff's
// documented rules. Operates on a session's activity blocks (each ~10 min).
// Pure function → returns the flag types that currently apply; the caller
// persists new ones. Never mutates input.

export type DetectedFlag =
  | "sustained_high_activity"
  | "low_variance_robotic"
  | "input_channel_imbalance";

const BLOCK_MINUTES = 10;

export function detectAnomalies(blocks: ActivityBlock[]): {
  type: DetectedFlag;
  details: Record<string, unknown>;
}[] {
  const found: { type: DetectedFlag; details: Record<string, unknown> }[] = [];
  if (blocks.length === 0) return found;

  // Chronological order.
  const b = [...blocks].sort((x, y) => x.blockStart.getTime() - y.blockStart.getTime());

  // 1) Sustained ≥95% activity for ≥30 min (3 consecutive blocks).
  let run = 0;
  for (const blk of b) {
    run = blk.activityPct >= 95 ? run + 1 : 0;
    if (run * BLOCK_MINUTES >= 30) {
      found.push({
        type: "sustained_high_activity",
        details: { thresholdPct: 95, minutes: run * BLOCK_MINUTES },
      });
      break;
    }
  }

  // 2) Low variance (robotic): activity varies ≤4 pts over a 90-min window,
  //    or is perfectly flat (0 variance) over 40 min.
  for (let i = 0; i < b.length; i++) {
    for (const [win, spread] of [[90, 4], [40, 0]] as const) {
      const n = win / BLOCK_MINUTES;
      if (i + n <= b.length) {
        const slice = b.slice(i, i + n).map((x) => x.activityPct);
        const range = Math.max(...slice) - Math.min(...slice);
        if (range <= spread) {
          found.push({
            type: "low_variance_robotic",
            details: { windowMinutes: win, maxSpread: spread, observedSpread: +range.toFixed(2) },
          });
          i = b.length; // break outer
          break;
        }
      }
    }
  }

  // 3) Input-channel imbalance: one channel near-zero while the other is active,
  //    sustained ≥50 min (5 blocks) — the classic mouse-jiggler signature.
  for (const [active, quiet, label] of [
    ["mousePct", "keyboardPct", "keyboard"],
    ["keyboardPct", "mousePct", "mouse"],
  ] as const) {
    let imbalance = 0;
    for (const blk of b) {
      const a = blk[active] as number;
      const q = blk[quiet] as number;
      imbalance = a > 10 && q <= 1 ? imbalance + 1 : 0;
      if (imbalance * BLOCK_MINUTES >= 50) {
        found.push({
          type: "input_channel_imbalance",
          details: { silentChannel: label, minutes: imbalance * BLOCK_MINUTES },
        });
        break;
      }
    }
  }

  return found;
}
