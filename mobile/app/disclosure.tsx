import * as Notifications from "expo-notifications";
import { useMemo, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "../src/auth/AuthContext";
import { ScreenFade } from "../src/motion";
import { useTheme } from "../src/ThemeProvider";
import { Colors, fonts, radius, spacing } from "../src/theme";
import { Banner, Button } from "../src/ui";

/**
 * First-run monitoring disclosure with affirmative consent.
 *
 * Play policy for a monitoring tool requires this to be in the app and
 * encountered during normal use — not buried behind a settings menu, and not
 * satisfied by a privacy policy URL. Consent is recorded server-side against a
 * version, so changing the text below (and bumping CONSENT_VERSION) re-prompts
 * everyone rather than silently grandfathering them.
 */

const DOES = [
  "Records the time you spend on a timer you started yourself, with the project and task you picked.",
  "Keeps a persistent notification on screen for as long as a timer is running.",
  "Notes when the device clock, timezone or boot state changes while a timer is running, so an unexplained jump can be reviewed.",
  "Sends those time entries to your organisation's TraxStaff workspace, where your admins can see them.",
];

const DOES_NOT = [
  "No screenshots. Android will not allow periodic screen capture without asking you every single time, so TraxStaff mobile does not attempt it at all.",
  "No activity percentage. There is no keyboard or mouse activity API on Android — the only route was an accessibility service, and TraxStaff will not use one.",
  "No location or GPS, ever.",
  "No reading of the apps or websites you use.",
  "No microphone, no camera, no keystroke content.",
  "No hidden or silent mode. If a timer is running, the notification is showing.",
];

export default function Disclosure() {
  const { acceptConsent, signOut, me } = useAuth();
  const { colors } = useTheme();
  const s = useMemo(() => createStyles(colors), [colors]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const accept = async () => {
    setBusy(true);
    setError(null);
    try {
      await acceptConsent();
      // Asked only after consent, and only because tracking without a visible
      // notification is exactly what Trax promises not to do.
      await Notifications.requestPermissionsAsync().catch(() => null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't record your consent. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={s.safe} edges={["top", "bottom"]}>
      <ScreenFade style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={s.scroll}>
        <Text style={s.kicker}>Before you start</Text>
        <Text style={s.title}>What TraxStaff records on this phone</Text>
        <Text style={s.lede}>
          TraxStaff is a work time tracker. On Android it records only the timers you start.
          {me ? ` You are signed in as ${me.email}.` : ""}
        </Text>

        <View style={s.block}>
          <Text style={s.blockTitle}>It does</Text>
          {DOES.map((line) => (
            <Row key={line} bullet="•" text={line} />
          ))}
        </View>

        <View style={[s.block, s.blockAccent]}>
          <Text style={s.blockTitle}>It does not</Text>
          {DOES_NOT.map((line) => (
            <Row key={line} bullet="×" text={line} tone="strong" />
          ))}
        </View>

        <Text style={s.fine}>
          Your admins can see your time entries, the projects and tasks you chose, and whether an
          entry was interrupted. They cannot see anything else from this device.
        </Text>

        {error ? <Banner tone="error">{error}</Banner> : null}

        <View style={s.actions}>
          <Button label="I understand — continue" onPress={accept} busy={busy} />
          <Button label="Sign out instead" variant="ghost" onPress={() => void signOut()} disabled={busy} />
        </View>
      </ScrollView>
      </ScreenFade>
    </SafeAreaView>
  );
}

function Row({ bullet, text, tone }: { bullet: string; text: string; tone?: "strong" }) {
  const { colors } = useTheme();
  const s = useMemo(() => createStyles(colors), [colors]);
  return (
    <View style={s.row}>
      <Text style={[s.bullet, tone === "strong" && { color: colors.accent }]}>{bullet}</Text>
      <Text style={s.rowText}>{text}</Text>
    </View>
  );
}

function createStyles(colors: Colors) {
  return StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: spacing.xl, gap: spacing.lg, paddingBottom: spacing.xxl },
  kicker: { fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.accent, letterSpacing: 1.2 },
  title: { fontFamily: fonts.heading, fontSize: 30, color: colors.text, letterSpacing: -0.8, lineHeight: 36 },
  lede: { fontFamily: fonts.body, fontSize: 16, color: colors.textMuted, lineHeight: 24 },
  block: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.md,
  },
  blockAccent: { borderColor: colors.accent },
  blockTitle: { fontFamily: fonts.headingMedium, fontSize: 18, color: colors.text },
  row: { flexDirection: "row", gap: spacing.md },
  bullet: { fontFamily: fonts.bodySemi, fontSize: 16, color: colors.brand, width: 14 },
  rowText: { flex: 1, fontFamily: fonts.body, fontSize: 15, color: colors.text, lineHeight: 22 },
  fine: { fontFamily: fonts.body, fontSize: 14, color: colors.faint, lineHeight: 21 },
  actions: { gap: spacing.md, marginTop: spacing.sm },
  });
}
