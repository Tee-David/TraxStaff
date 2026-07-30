import { ReactNode, useMemo } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  TextStyle,
  View,
  ViewStyle,
} from "react-native";
import { useTheme } from "./ThemeProvider";
import { Colors, fonts, radius, shadow, spacing } from "./theme";

export function Title({ children, style }: { children: ReactNode; style?: TextStyle }) {
  const s = useUiStyles();
  return <Text style={[s.title, style]}>{children}</Text>;
}

export function Heading({ children }: { children: ReactNode }) {
  const s = useUiStyles();
  return <Text style={s.heading}>{children}</Text>;
}

export function Body({ children, muted }: { children: ReactNode; muted?: boolean }) {
  const s = useUiStyles();
  return <Text style={[s.body, muted && s.bodyMuted]}>{children}</Text>;
}

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  const s = useUiStyles();
  return <View style={[s.card, style]}>{children}</View>;
}

export function Button({
  label,
  onPress,
  variant = "primary",
  disabled,
  busy,
}: {
  label: string;
  onPress: () => void;
  variant?: "primary" | "accent" | "ghost" | "danger";
  disabled?: boolean;
  busy?: boolean;
}) {
  const { colors } = useTheme();
  const s = useUiStyles();
  const bg =
    variant === "primary"
      ? colors.brand
      : variant === "accent"
        ? colors.accent
        : variant === "danger"
          ? colors.danger
          : "transparent";
  const fg = variant === "ghost" ? colors.brand : colors.onDark;
  const off = disabled || busy;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!off, busy: !!busy }}
      onPress={onPress}
      disabled={off}
      style={({ pressed }) => [
        s.btn,
        { backgroundColor: bg, opacity: off ? 0.5 : pressed ? 0.85 : 1 },
        variant === "ghost" && s.btnGhost,
      ]}
    >
      {busy ? <ActivityIndicator color={fg} /> : <Text style={[s.btnLabel, { color: fg }]}>{label}</Text>}
    </Pressable>
  );
}

export function Field({ label, ...props }: { label: string } & TextInputProps) {
  const { colors } = useTheme();
  const s = useUiStyles();
  return (
    <View style={{ gap: spacing.xs }}>
      <Text style={s.fieldLabel}>{label}</Text>
      <TextInput
        placeholderTextColor={colors.faint}
        {...props}
        style={[s.input, props.style as never]}
      />
    </View>
  );
}

export function Banner({ tone = "info", children }: { tone?: "info" | "error" | "warn"; children: ReactNode }) {
  const { colors } = useTheme();
  const s = useUiStyles();
  const map = {
    info: { bg: colors.surfaceAlt, fg: colors.textMuted },
    error: { bg: colors.dangerSoft, fg: colors.danger },
    warn: { bg: colors.accentSoft, fg: colors.warning },
  } as const;
  return (
    <View style={[s.banner, { backgroundColor: map[tone].bg }]}>
      <Text style={[s.bannerText, { color: map[tone].fg }]}>{children}</Text>
    </View>
  );
}

export function Empty({ text }: { text: string }) {
  const s = useUiStyles();
  return (
    <View style={s.empty}>
      <Text style={s.emptyText}>{text}</Text>
    </View>
  );
}

/** Loading state that names what it is waiting on — a Render free-tier cold
 *  start takes 30s+, and a blank screen for that long reads as a crash. */
export function Loading({ text }: { text: string }) {
  const { colors } = useTheme();
  const s = useUiStyles();
  return (
    <View style={s.loading}>
      <ActivityIndicator color={colors.brand} size="large" />
      <Text style={s.loadingText}>{text}</Text>
    </View>
  );
}

function createStyles(colors: Colors) {
  return StyleSheet.create({
    // Matches the per-screen `title` styles the tab screens each declare, so a
    // screen using <Title> is indistinguishable from one that rolled its own.
    title: { fontFamily: fonts.heading, fontSize: 28, color: colors.text, letterSpacing: -0.8 },
    heading: { fontFamily: fonts.headingMedium, fontSize: 17, color: colors.text },
    body: { fontFamily: fonts.body, fontSize: 15, color: colors.text, lineHeight: 22 },
    bodyMuted: { color: colors.textMuted },
    card: {
      backgroundColor: colors.surface,
      borderRadius: radius.lg,
      padding: spacing.lg,
      borderWidth: 1,
      borderColor: colors.border,
      ...shadow,
    },
    btn: {
      height: 52,
      borderRadius: radius.md,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: spacing.lg,
    },
    btnGhost: { borderWidth: 1, borderColor: colors.borderStrong },
    btnLabel: { fontFamily: fonts.bodySemi, fontSize: 16 },
    fieldLabel: { fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.textMuted },
    input: {
      height: 50,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      paddingHorizontal: spacing.md,
      fontFamily: fonts.body,
      fontSize: 16,
      color: colors.text,
    },
    banner: { borderRadius: radius.md, padding: spacing.md },
    bannerText: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20 },
    empty: { padding: spacing.xl, alignItems: "center" },
    emptyText: { fontFamily: fonts.body, fontSize: 15, color: colors.faint, textAlign: "center" },
    loading: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.lg, padding: spacing.xl },
    loadingText: { fontFamily: fonts.body, fontSize: 15, color: colors.textMuted, textAlign: "center" },
  });
}

function useUiStyles() {
  const { colors } = useTheme();
  return useMemo(() => createStyles(colors), [colors]);
}
