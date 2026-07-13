"use client";

import { motion } from "motion/react";

// Compact progress donut used across the dashboard (matches the reference's
// percentage rings). Single-value ring with a soft track.
export function Donut({
  value,
  size = 56,
  stroke = 7,
  color = "var(--color-brand)",
  label,
  sublabel,
}: {
  value: number; // 0–100
  size?: number;
  stroke?: number;
  color?: string;
  label?: string;
  sublabel?: string;
}) {
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div className="flex items-center gap-3">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-canvas)" strokeWidth={stroke} />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          strokeDasharray={circ}
          initial={{ strokeDashoffset: circ }}
          animate={{ strokeDashoffset: circ - (circ * pct) / 100 }}
          transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
        />
      </svg>
      {(label || sublabel) && (
        <div>
          {label && <div className="font-heading text-lg font-bold">{label}</div>}
          {sublabel && <div className="text-xs text-muted">{sublabel}</div>}
        </div>
      )}
    </div>
  );
}
