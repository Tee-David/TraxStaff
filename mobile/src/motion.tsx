// Shared motion vocabulary for the mobile app — the Reanimated equivalent of
// `web/frontend/src/lib/motion.ts`'s `useMotionPresets()`. Two rules hold here
// too:
//
// 1. Only `transform` (translateY / scale) and `opacity` are ever animated —
//    nothing that forces layout.
// 2. The OS-level "reduce motion" preference collapses every movement to an
//    instant, final-state render. `AccessibilityInfo.isReduceMotionEnabled()`
//    is RN's version of the web hook's `prefers-reduced-motion` query.
//
// Durations stay short (150-220ms): fast enough to read as responsiveness,
// not decoration. Nothing here spins, bounces, or takes a perceptible
// cross-screen duration.

import { ReactNode, useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Pressable, PressableProps, StyleProp, ViewStyle } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
} from "react-native-reanimated";

export const EASE = Easing.bezier(0.22, 0.61, 0.36, 1);

/** Whole-screen / modal entrance: fade + slight rise. */
export const ENTRANCE_DURATION = 220;
export const ENTRANCE_RISE = 12;

/** Per-row entrance inside a stagger. */
const ITEM_STAGGER_MS = 40;
const ITEM_STAGGER_CAP_MS = 360;
const ITEM_RISE = 8;
const ITEM_DURATION = 180;

/** Press-feedback spring. */
const PRESS_SCALE = 0.96;
const PRESS_SPRING = { damping: 18, stiffness: 260, mass: 0.5 };

/**
 * Live read of the OS "reduce motion" preference, kept up to date if the user
 * flips it while the app is open (mirrors the web app's `useReducedMotion()`).
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (mounted) setReduced(value);
    });
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", (value) => {
      setReduced(value);
    });
    return () => {
      mounted = false;
      sub.remove();
    };
  }, []);

  return reduced;
}

/**
 * Fade + slight rise, played once per mount. Used for whole-screen and
 * modal/sheet entrances. With reduce-motion on, the content is simply present
 * at its final position from the first frame — no fade, no rise.
 */
export function useScreenEntrance() {
  const reduced = useReducedMotion();
  const progress = useSharedValue(reduced ? 1 : 0);

  useEffect(() => {
    if (reduced) {
      progress.value = 1;
      return;
    }
    progress.value = 0;
    progress.value = withTiming(1, { duration: ENTRANCE_DURATION, easing: EASE });
    // Deliberately re-runs only when `reduced` changes (a live toggle of the
    // OS setting), not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduced]);

  return useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: (1 - progress.value) * ENTRANCE_RISE }],
  }));
}

/**
 * Wraps a screen's content in the standard fade+rise entrance so screens don't
 * each hand-roll the same `useSharedValue`/`useAnimatedStyle` pair. Layout is
 * untouched — this only adds opacity/transform on top of whatever `style`
 * (typically `{ flex: 1 }`) the caller already used.
 */
export function ScreenFade({
  children,
  style,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const animatedStyle = useScreenEntrance();
  return <Animated.View style={[style, animatedStyle]}>{children}</Animated.View>;
}

/**
 * Tracks genuine content-load transitions (loading -> loaded), not every
 * re-render. Feed the returned `generation` to `<StaggerItem>` so a list's
 * rows stagger in once per real load — a pull-to-refresh replays it, a toggle
 * or a keystroke elsewhere on the same screen does not.
 */
export function useListEntrance(loading: boolean): number {
  const [generation, setGeneration] = useState(0);
  const wasLoading = useRef(loading);

  useEffect(() => {
    if (wasLoading.current && !loading) setGeneration((g) => g + 1);
    wasLoading.current = loading;
  }, [loading]);

  return generation;
}

/**
 * One row of a staggered list entrance. Plays once per `generation` value
 * (see `useListEntrance`), delayed by `index`, capped so a long list doesn't
 * visibly take long to finish appearing. Reduce-motion collapses this to an
 * instant, fully-visible row.
 */
export function StaggerItem({
  index,
  generation,
  style,
  children,
}: {
  index: number;
  generation: number;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  const reduced = useReducedMotion();
  const progress = useSharedValue(reduced ? 1 : 0);
  const seenGeneration = useRef<number | null>(null);

  useEffect(() => {
    if (seenGeneration.current === generation) return;
    seenGeneration.current = generation;
    if (reduced) {
      progress.value = 1;
      return;
    }
    progress.value = 0;
    const delay = Math.min(index * ITEM_STAGGER_MS, ITEM_STAGGER_CAP_MS);
    progress.value = withDelay(delay, withTiming(1, { duration: ITEM_DURATION, easing: EASE }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [generation, reduced]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: (1 - progress.value) * ITEM_RISE }],
  }));

  return <Animated.View style={[style, animatedStyle]}>{children}</Animated.View>;
}

const AnimatedPressableBase = Animated.createAnimatedComponent(Pressable);

/**
 * `Pressable` with a spring-based scale-down on press, replacing the manual
 * `pressed && { opacity }` pattern used across the app's primary buttons. One
 * shared implementation instead of the same three hooks on every button.
 *
 * `style` is a plain style (or array), not the `({ pressed }) => ...` render
 * prop — the scale animation is now what signals a press, so callers that
 * still need a disabled-state style pass it in directly.
 *
 * Reduce-motion keeps a tiny opacity nudge (not a growing/shrinking scale) —
 * that's feedback that a press registered, a different thing from the
 * decorative movement reduce-motion targets on the web side too.
 */
export function AnimatedPressable({
  style,
  disabled,
  onPressIn,
  onPressOut,
  scaleTo = PRESS_SCALE,
  children,
  ...rest
}: Omit<PressableProps, "style" | "children"> & {
  style?: StyleProp<ViewStyle>;
  scaleTo?: number;
  children?: ReactNode;
}) {
  const reduced = useReducedMotion();
  const scale = useSharedValue(1);
  const pressedOpacity = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: pressedOpacity.value,
    transform: [{ scale: scale.value }],
  }));

  return (
    <AnimatedPressableBase
      disabled={disabled}
      onPressIn={(e) => {
        if (reduced) {
          pressedOpacity.value = 0.85;
        } else {
          scale.value = withSpring(scaleTo, PRESS_SPRING);
        }
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        if (reduced) {
          pressedOpacity.value = 1;
        } else {
          scale.value = withSpring(1, PRESS_SPRING);
        }
        onPressOut?.(e);
      }}
      style={[style, animatedStyle]}
      {...rest}
    >
      {children}
    </AnimatedPressableBase>
  );
}
