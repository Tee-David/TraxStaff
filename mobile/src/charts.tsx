// Small display primitives borrowed from the reference dashboards: a radial
// progress gauge and a day timeline strip.
//
// Drawn with plain Views on purpose. An arc would normally want react-native-svg,
// but that is a native dependency and every teammate would have to rebuild their
// dev client to get it. A ticked ring costs nothing at install time and reads as
// a deliberate style rather than a compromise.

import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useTheme } from "./ThemeProvider";
import { Colors, fonts, radius, spacing } from "./theme";

/* ─────────────────────────────  Radial gauge  ───────────────────────────── */

const TICKS = 48;

export function Ring({
  progress,
  size = 190,
  tick = 4,
  tickLength = 14,
  color,
  track = "rgba(255,255,255,0.18)",
  children,
}: {
  /** 0–1. Values above 1 fill the ring completely rather than wrapping. */
  progress: number;
  size?: number;
  tick?: number;
  tickLength?: number;
  color?: string;
  track?: string;
  children?: React.ReactNode;
}) {
  const { colors } = useTheme();
  const litColor = color ?? colors.accent;
  const pct = Number.isFinite(progress) ? Math.max(0, Math.min(1, progress)) : 0;
  const lit = Math.round(pct * TICKS);

  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      {Array.from({ length: TICKS }, (_, i) => (
        <View
          key={i}
          style={{
            position: "absolute",
            width: tick,
            height: tickLength,
            borderRadius: tick / 2,
            backgroundColor: i < lit ? litColor : track,
            // rotate first, then push outward along the rotated axis
            transform: [
              { rotate: `${(i * 360) / TICKS}deg` },
              { translateY: -(size / 2 - tickLength / 2) },
            ],
          }}
        />
      ))}
      {/* Constrained to the clear space inside the ticks, so a long label wraps
          instead of running underneath them. */}
      <View
        style={{
          width: size - tickLength * 2 - 12,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {children}
      </View>
    </View>
  );
}

/* ────────────────────────────  Day timeline  ───────────────────────────── */

export type Span = { start: number; end: number };

/**
 * Sessions laid out across the working day. The window widens automatically for
 * work that falls outside it — a 5am start must not silently vanish off the left
 * edge, which is exactly the kind of missing time people notice and distrust.
 */
export function DayTimeline({ spans, height = 34 }: { spans: Span[]; height?: number }) {
  const { colors } = useTheme();
  const t = useMemo(() => createTimelineStyles(colors), [colors]);
  const { from, to, blocks, marks } = useMemo(() => {
    const DEFAULT_FROM = 7;
    const DEFAULT_TO = 19;

    let lo = DEFAULT_FROM;
    let hi = DEFAULT_TO;
    for (const sp of spans) {
      lo = Math.min(lo, Math.floor(hourOf(sp.start)));
      hi = Math.max(hi, Math.ceil(hourOf(sp.end)));
    }
    lo = Math.max(0, lo);
    hi = Math.min(24, Math.max(hi, lo + 1));

    const span = hi - lo;
    const placed = spans
      .map((sp) => {
        const a = Math.max(lo, hourOf(sp.start));
        const b = Math.min(hi, hourOf(sp.end));
        return { left: ((a - lo) / span) * 100, width: (Math.max(b - a, 0.06) / span) * 100 };
      })
      .filter((b) => b.width > 0);

    // At most five labels, on whole hours, so they never collide.
    const step = Math.max(1, Math.round(span / 4));
    const ticks: number[] = [];
    for (let h = lo; h <= hi; h += step) ticks.push(h);

    return { from: lo, to: hi, blocks: placed, marks: ticks };
  }, [spans]);

  return (
    <View style={{ gap: spacing.xs }}>
      <View style={[t.track, { height }]}>
        {blocks.map((b, i) => (
          <View key={i} style={[t.block, { left: `${b.left}%`, width: `${b.width}%` }]} />
        ))}
      </View>
      <View style={t.axis}>
        {marks.map((h) => (
          <Text key={h} style={t.axisLabel}>
            {label(h)}
          </Text>
        ))}
      </View>
      {/* Screen readers get the range as words; the bars alone say nothing. */}
      <View
        accessible
        accessibilityLabel={`Timeline from ${label(from)} to ${label(to)}, ${spans.length} ${
          spans.length === 1 ? "entry" : "entries"
        }`}
      />
    </View>
  );
}

function hourOf(ms: number): number {
  const d = new Date(ms);
  return d.getHours() + d.getMinutes() / 60;
}

function label(hour: number): string {
  const h = ((hour % 24) + 24) % 24;
  if (h === 0) return "12am";
  if (h === 12) return "12pm";
  return h < 12 ? `${h}am` : `${h - 12}pm`;
}

/* ───────────────────────────  Breakdown row  ──────────────────────────── */

/** Label, value and a proportional bar — the reference dashboards' list rows. */
export function MeterRow({
  label: rowLabel,
  value,
  fraction,
  color,
}: {
  label: string;
  value: string;
  /** 0–1, relative to the largest row in the list. */
  fraction: number;
  color?: string;
}) {
  const { colors } = useTheme();
  const m = useMemo(() => createMeterStyles(colors), [colors]);
  const fillColor = color ?? colors.brand;
  const pct = Number.isFinite(fraction) ? Math.max(0, Math.min(1, fraction)) : 0;
  return (
    <View style={m.row}>
      <View style={m.head}>
        <Text style={m.label} numberOfLines={1}>
          {rowLabel}
        </Text>
        <Text style={m.value}>{value}</Text>
      </View>
      <View style={m.track}>
        <View style={[m.fill, { width: `${pct * 100}%`, backgroundColor: fillColor }]} />
      </View>
    </View>
  );
}

function createTimelineStyles(colors: Colors) {
  return StyleSheet.create({
    track: {
      backgroundColor: colors.surfaceAlt,
      borderRadius: radius.sm,
      overflow: "hidden",
    },
    block: {
      position: "absolute",
      top: 0,
      bottom: 0,
      backgroundColor: colors.brand,
      borderRadius: radius.sm,
    },
    axis: { flexDirection: "row", justifyContent: "space-between" },
    axisLabel: { fontFamily: fonts.body, fontSize: 10, color: colors.faint },
  });
}

function createMeterStyles(colors: Colors) {
  return StyleSheet.create({
    row: { gap: 6, paddingVertical: spacing.sm },
    head: { flexDirection: "row", alignItems: "baseline", gap: spacing.sm },
    label: { flex: 1, fontFamily: fonts.bodyMedium, fontSize: 14, color: colors.text },
    value: { fontFamily: fonts.bodySemi, fontSize: 13, color: colors.textMuted },
    track: { height: 6, borderRadius: 3, backgroundColor: colors.surfaceAlt, overflow: "hidden" },
    fill: { height: "100%", borderRadius: 3 },
  });
}
