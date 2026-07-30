import AsyncStorage from "@react-native-async-storage/async-storage";
import Ionicons from "@expo/vector-icons/Ionicons";
import * as Notifications from "expo-notifications";
import { Link } from "expo-router";
import { useEffect, useState } from "react";
import { Alert, AppState, Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Tracker from "../../modules/trax-tracker";
import { useAuth } from "../../src/auth/AuthContext";
import { colors, fonts, radius, spacing } from "../../src/theme";
import { useTracker } from "../../src/tracker/TrackerContext";
import { Banner, Button } from "../../src/ui";

// Compact teaser only — the authoritative, legally-relevant copy lives in
// exactly one place: app/disclosure.tsx. These six cards are distilled from
// its DOES/DOES_NOT arrays and always tap through to the full page rather
// than expanding in place, so there is never a second place that text can
// drift out of sync.
const DISCLOSURE_CARDS: { icon: keyof typeof Ionicons.glyphMap; title: string; sub: string }[] = [
  { icon: "play-circle-outline", title: "Only timers you start", sub: "Nothing runs unless you press start." },
  { icon: "notifications-outline", title: "Notification always visible", sub: "Shown the whole time a timer runs." },
  { icon: "images-outline", title: "No screenshots", sub: "Never captured, on any schedule." },
  { icon: "eye-off-outline", title: "No activity data", sub: "No activity %, keystrokes, or mouse tracking." },
  { icon: "location-outline", title: "No location, ever", sub: "Trax never reads GPS or location." },
  { icon: "people-outline", title: "Admins see time only", sub: "Just entries, projects and tasks." },
];

// Preference-only key, not a secret — deliberately NOT in secureStorage.ts,
// which is reserved for credentials held in the Android Keystore.
const THEME_PREF_KEY = "trax.themePreference";
type ThemePreference = "light" | "dark" | "system";
const THEME_OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
];

export default function ProfileScreen() {
  const { me, signOut } = useAuth();
  const { state, pendingCount, sync, available } = useTracker();
  const [busy, setBusy] = useState(false);
  // Read once and refreshed on foreground: the only way this changes is the
  // user leaving for the system settings and coming back.
  const [notificationsOk, setNotificationsOk] = useState(() => Tracker.hasNotificationPermission());

  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "active") setNotificationsOk(Tracker.hasNotificationPermission());
    });
    return () => sub.remove();
  }, []);

  // No ThemeProvider/useTheme() exists yet anywhere in this codebase — "Mobile
  // theming" is its own not-yet-started checklist item. Picking an option here
  // only persists the preference to AsyncStorage for that future work to read;
  // it does not change any colors on screen today.
  const [themePref, setThemePref] = useState<ThemePreference>("system");
  useEffect(() => {
    void AsyncStorage.getItem(THEME_PREF_KEY).then((stored) => {
      if (stored === "light" || stored === "dark" || stored === "system") setThemePref(stored);
    });
  }, []);
  const selectTheme = (value: ThemePreference) => {
    setThemePref(value);
    void AsyncStorage.setItem(THEME_PREF_KEY, value);
  };

  // One action for both the notification prompt and the "open Settings" escape
  // hatch the Background-limits card used to have as a separate button.
  // Settings is where a permanently-denied permission has to be flipped back
  // on, and it's also where OEM battery/background restrictions live — so
  // when the request can't move the needle itself (already decided one way or
  // the other), the same tap takes the user there.
  const askForPermissions = async () => {
    const alreadyDecided = notificationsOk;
    await Notifications.requestPermissionsAsync().catch(() => null);
    const enabled = Tracker.hasNotificationPermission();
    setNotificationsOk(enabled);
    const freshlyGranted = !alreadyDecided && enabled;
    if (!freshlyGranted) await Linking.openSettings().catch(() => {});
  };

  const confirmSignOut = () => {
    if (state.tracking) {
      Alert.alert("Timer still running", "Stop your timer before signing out so the entry is saved.");
      return;
    }
    if (pendingCount > 0) {
      // Never allow a destructive action while the queue is non-empty — signing
      // out drops the token the queue needs to drain.
      Alert.alert(
        "Unsynced time",
        `${pendingCount} entr${pendingCount === 1 ? "y is" : "ies are"} still waiting to reach Trax. Sync first so nothing is lost.`,
        [
          { text: "Cancel", style: "cancel" },
          { text: "Sync now", onPress: () => void sync() },
        ]
      );
      return;
    }
    Alert.alert("Sign out?", "You'll need your password to sign back in.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Sign out",
        style: "destructive",
        onPress: async () => {
          setBusy(true);
          await signOut();
          setBusy(false);
        },
      },
    ]);
  };

  return (
    <SafeAreaView style={s.safe} edges={["top"]}>
      <ScrollView contentContainerStyle={s.scroll}>
        <Text style={s.title}>Profile</Text>

        <View style={s.card}>
          <View style={s.avatar}>
            <Text style={s.avatarText}>{(me?.email ?? "?").slice(0, 2).toUpperCase()}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.email} numberOfLines={1}>
              {me?.email ?? "—"}
            </Text>
            <Text style={s.role}>{me?.role ?? "member"}</Text>
          </View>
        </View>

        <View style={s.section}>
          <Text style={s.sectionTitle}>What Trax records about me</Text>
          <View style={s.grid}>
            {DISCLOSURE_CARDS.map((card) => (
              <DisclosureCard key={card.title} {...card} />
            ))}
          </View>
          <Link href="/disclosure" asChild>
            <Pressable style={({ pressed }) => [s.seeMore, pressed && { opacity: 0.6 }]}>
              <Text style={s.seeMoreText}>See full details</Text>
              <Ionicons name="chevron-forward" size={16} color={colors.brand} />
            </Pressable>
          </Link>
        </View>

        {!notificationsOk && available ? (
          <Banner tone="warn">
            Notifications are blocked. Trax will not track without a visible notification, so the
            timer may be stopped by Android.
          </Banner>
        ) : null}

        <View style={s.section}>
          <Text style={s.sectionTitle}>Background limits</Text>
          <Text style={s.note}>
            Some phones (Xiaomi, Huawei, OnePlus, Samsung and others) kill background apps aggressively
            and there is no API that fixes it. If your timer keeps stopping, allow Trax to run in the
            background in your phone&apos;s battery settings. Trax will always tell you when a timer was
            stopped rather than quietly losing the time.
          </Text>
          <Button label="Allow permissions" onPress={() => void askForPermissions()} />
        </View>

        <View style={s.section}>
          <Text style={s.sectionTitle}>Appearance</Text>
          <Text style={s.note}>Light, dark, or match your device.</Text>
          <View style={s.segmented}>
            {THEME_OPTIONS.map((opt) => {
              const active = opt.value === themePref;
              return (
                <Pressable
                  key={opt.value}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  onPress={() => selectTheme(opt.value)}
                  style={[s.segment, active && s.segmentActive]}
                >
                  <Text style={[s.segmentText, active && s.segmentTextActive]}>{opt.label}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <Button label="Sign out" variant="ghost" onPress={confirmSignOut} busy={busy} />
      </ScrollView>
    </SafeAreaView>
  );
}

function DisclosureCard({ icon, title, sub }: { icon: keyof typeof Ionicons.glyphMap; title: string; sub: string }) {
  return (
    <Link href="/disclosure" asChild>
      <Pressable
        style={({ pressed }) => [s.disclosureCard, pressed && { backgroundColor: colors.surfaceAlt }]}
        accessibilityRole="button"
        accessibilityLabel={`${title}. ${sub}. Opens full details.`}
      >
        <Ionicons name={icon} size={20} color={colors.brand} />
        <Text style={s.cardTitle} numberOfLines={2}>
          {title}
        </Text>
        <Text style={s.cardSub} numberOfLines={2}>
          {sub}
        </Text>
      </Pressable>
    </Link>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.xxl },
  title: { fontFamily: fonts.heading, fontSize: 28, color: colors.text, letterSpacing: -0.8 },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.brand,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { fontFamily: fonts.bodySemi, fontSize: 16, color: colors.onDark },
  email: { fontFamily: fonts.bodySemi, fontSize: 16, color: colors.text },
  role: { fontFamily: fonts.body, fontSize: 13, color: colors.textMuted, textTransform: "capitalize" },
  section: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  sectionTitle: { fontFamily: fonts.headingMedium, fontSize: 16, color: colors.text, marginBottom: spacing.xs },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  disclosureCard: {
    width: "47%",
    flexGrow: 1,
    gap: 4,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  cardTitle: { fontFamily: fonts.bodySemi, fontSize: 13, color: colors.text, marginTop: 2 },
  cardSub: { fontFamily: fonts.body, fontSize: 11, color: colors.faint, lineHeight: 15 },
  seeMore: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    paddingVertical: spacing.sm,
  },
  seeMoreText: { fontFamily: fonts.bodyMedium, fontSize: 14, color: colors.brand },
  note: { fontFamily: fonts.body, fontSize: 14, color: colors.textMuted, lineHeight: 21 },
  segmented: {
    flexDirection: "row",
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    padding: 4,
    gap: 4,
  },
  segment: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
  },
  segmentActive: { backgroundColor: colors.brand },
  segmentText: { fontFamily: fonts.bodyMedium, fontSize: 14, color: colors.textMuted },
  segmentTextActive: { color: colors.onDark },
});
