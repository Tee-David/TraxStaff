import Ionicons from "@expo/vector-icons/Ionicons";
import * as Notifications from "expo-notifications";
import { Link } from "expo-router";
import { useEffect, useState } from "react";
import {
  Alert,
  AppState,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Tracker from "../../modules/trax-tracker";
import { API_URL } from "../../src/api/client";
import { useAuth } from "../../src/auth/AuthContext";
import { fmtShort } from "../../src/format";
import { colors, fonts, radius, spacing } from "../../src/theme";
import { useTracker } from "../../src/tracker/TrackerContext";
import { Banner, Button } from "../../src/ui";

export default function ProfileScreen() {
  const { me, signOut, deviceId } = useAuth();
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

  const askForNotifications = async () => {
    const res = await Notifications.requestPermissionsAsync().catch(() => null);
    const enabled = Tracker.hasNotificationPermission();
    setNotificationsOk(enabled);
    // Settings is the only remaining route when the prompt can't help: it has
    // been refused too often to show again, or the permission is held but the
    // user switched notifications off anyway. Someone who has just declined a
    // prompt that can still be re-shown is left alone rather than yanked out of
    // the app.
    const promptIsSpent = res === null || res.granted || res.canAskAgain === false;
    if (!enabled && promptIsSpent) await Linking.openSettings().catch(() => {});
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

        <Link href="/disclosure" asChild>
          <Pressable style={({ pressed }) => [s.linkRow, pressed && { backgroundColor: colors.surfaceAlt }]}>
            <Ionicons name="shield-checkmark-outline" size={22} color={colors.brand} />
            <View style={{ flex: 1 }}>
              <Text style={s.linkTitle}>What Trax records about me</Text>
              <Text style={s.linkSub}>The full list, and what it will never do.</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.faint} />
          </Pressable>
        </Link>

        <View style={s.section}>
          <Text style={s.sectionTitle}>This device</Text>
          <Row label="Tracking now" value={state.tracking ? fmtShort(state.creditedSeconds) : "No"} />
          <Row label="Unsynced entries" value={String(pendingCount)} />
          <Row label="Tracker module" value={available ? "Installed" : "Missing (dev build needed)"} />
          <Row label="Boot id" value={String(Tracker.bootId())} />
          <Row label="Notifications" value={notificationsOk ? "Allowed" : "Blocked"} />
          <Row label="Device id" value={deviceId ? `${deviceId.slice(0, 8)}…` : "—"} />
          <Row label="Server" value={API_URL.replace(/^https?:\/\//, "")} />
        </View>

        {!notificationsOk && available ? (
          <View style={{ gap: spacing.md }}>
            <Banner tone="warn">
              Notifications are blocked. Trax will not track without a visible notification, so the
              timer may be stopped by Android.
            </Banner>
            <Button label="Allow notifications" onPress={() => void askForNotifications()} />
          </View>
        ) : null}

        <View style={s.section}>
          <Text style={s.sectionTitle}>Background limits</Text>
          <Text style={s.note}>
            Some phones (Xiaomi, Huawei, OnePlus, Samsung and others) kill background apps aggressively
            and there is no API that fixes it. If your timer keeps stopping, allow Trax to run in the
            background in your phone&apos;s battery settings. Trax will always tell you when a timer was
            stopped rather than quietly losing the time.
          </Text>
          <Button
            label="Open app settings"
            variant="ghost"
            onPress={() => void Linking.openSettings().catch(() => {})}
          />
        </View>

        <Button label="Sign out" variant="ghost" onPress={confirmSignOut} busy={busy} />
      </ScrollView>
    </SafeAreaView>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={s.row}>
      <Text style={s.rowLabel}>{label}</Text>
      <Text style={s.rowValue} numberOfLines={1}>
        {value}
      </Text>
    </View>
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
  linkRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
  },
  linkTitle: { fontFamily: fonts.bodySemi, fontSize: 15, color: colors.text },
  linkSub: { fontFamily: fonts.body, fontSize: 12, color: colors.faint },
  section: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  sectionTitle: { fontFamily: fonts.headingMedium, fontSize: 16, color: colors.text, marginBottom: spacing.xs },
  row: { flexDirection: "row", justifyContent: "space-between", gap: spacing.md },
  rowLabel: { fontFamily: fonts.body, fontSize: 14, color: colors.textMuted },
  rowValue: { fontFamily: fonts.bodyMedium, fontSize: 14, color: colors.text, flexShrink: 1 },
  note: { fontFamily: fonts.body, fontSize: 14, color: colors.textMuted, lineHeight: 21 },
});
