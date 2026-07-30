import Ionicons from "@expo/vector-icons/Ionicons";
import { Image } from "expo-image";
import { useMemo, useState } from "react";
import {
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { API_URL } from "../src/api/client";
import { useAuth } from "../src/auth/AuthContext";
import { useTheme } from "../src/ThemeProvider";
import { Colors, fonts, radius, spacing } from "../src/theme";
import { Banner } from "../src/ui";

// Password reset is a web flow; the app links out to it rather than
// reimplementing token handling on the phone.
const APP_WEB_URL = "https://app.traxstaff.com";

export default function Login() {
  const { signIn, slow, error } = useAuth();
  const { colors } = useTheme();
  const s = useMemo(() => createStyles(colors), [colors]);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const canSubmit = Boolean(email.trim() && password) && !busy;

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    try {
      await signIn(email, password);
    } catch {
      // The provider already put a readable message in `error`.
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={s.root}>
      <SafeAreaView style={{ flex: 1 }} edges={["top", "bottom"]}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
            <View style={s.header}>
              <Image
                source={require("../assets/images/icon.png")}
                style={{ width: 44, height: 44 }}
                contentFit="contain"
              />
              <Text style={s.title}>Sign in to your{"\n"}Account</Text>
              <Text style={s.subtitle}>Enter your email and password to log in</Text>
            </View>

            <View style={s.card}>
              <Pressable
                accessibilityRole="button"
                onPress={() =>
                  setNotice("Google sign-in isn't set up yet — use your email and password below.")
                }
                style={({ pressed }) => [s.google, pressed && { opacity: 0.85 }]}
              >
                <Text style={s.googleG}>G</Text>
                <Text style={s.googleLabel}>Continue with Google</Text>
              </Pressable>

              <View style={s.dividerRow}>
                <View style={s.rule} />
                <Text style={s.dividerText}>Or login with</Text>
                <View style={s.rule} />
              </View>

              <TextInput
                value={email}
                onChangeText={setEmail}
                placeholder="you@company.com"
                placeholderTextColor={colors.faint}
                autoCapitalize="none"
                autoComplete="email"
                keyboardType="email-address"
                inputMode="email"
                editable={!busy}
                style={s.input}
                accessibilityLabel="Work email"
              />

              <View style={s.pwWrap}>
                <TextInput
                  value={password}
                  onChangeText={setPassword}
                  placeholder="••••••••"
                  placeholderTextColor={colors.faint}
                  secureTextEntry={!showPw}
                  autoCapitalize="none"
                  autoComplete="password"
                  editable={!busy}
                  onSubmitEditing={submit}
                  returnKeyType="go"
                  style={[s.input, { paddingRight: 46 }]}
                  accessibilityLabel="Password"
                />
                <Pressable
                  onPress={() => setShowPw((v) => !v)}
                  hitSlop={10}
                  style={s.eye}
                  accessibilityRole="button"
                  accessibilityLabel={showPw ? "Hide password" : "Show password"}
                >
                  <Ionicons
                    name={showPw ? "eye-off-outline" : "eye-outline"}
                    size={20}
                    color={colors.faint}
                  />
                </Pressable>
              </View>

              <View style={s.row}>
                <Pressable
                  onPress={() => setRemember((v) => !v)}
                  style={s.remember}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: remember }}
                >
                  <View style={[s.box, remember && s.boxOn]}>
                    {remember ? <Ionicons name="checkmark" size={13} color="#fff" /> : null}
                  </View>
                  <Text style={s.rememberLabel}>Remember me</Text>
                </Pressable>

                <Pressable
                  onPress={() =>
                    // An unhandled rejection here (no browser, blocked intent)
                    // would surface as a red-box crash in a dev build.
                    void Linking.openURL(`${APP_WEB_URL}/forgot-password`).catch(() =>
                      setNotice("Couldn't open the browser. Reset your password on the Trax website.")
                    )
                  }
                  accessibilityRole="link"
                >
                  <Text style={s.link}>Forgot Password ?</Text>
                </Pressable>
              </View>

              {notice ? <Banner tone="info">{notice}</Banner> : null}
              {error ? <Banner tone="error">{error}</Banner> : null}

              {/* The backend sleeps on Render's free tier; the first request of the
                  day routinely takes 30-50s. Saying so beats a spinner that looks
                  like a hang. */}
              {slow ? (
                <Banner tone="warn">
                  Waking the Trax server — this can take up to a minute after a quiet
                  period. Leave this open.
                </Banner>
              ) : null}

              <Pressable
                accessibilityRole="button"
                onPress={submit}
                disabled={!canSubmit}
                style={({ pressed }) => [
                  s.submit,
                  !canSubmit && { opacity: 0.5 },
                  pressed && canSubmit && { opacity: 0.9 },
                ]}
              >
                <Text style={s.submitLabel}>{busy ? "Signing in…" : "Log In"}</Text>
              </Pressable>

              {/* Accounts are created by an admin invitation, never self-serve, so
                  this explains the route in rather than offering a signup form
                  that cannot exist. It must NOT navigate: every non-auth route is
                  behind the gate and would bounce a signed-out visitor straight
                  back to /welcome. */}
              <View style={s.signupRow}>
                <Text style={s.signupText}>Don&apos;t have an account? </Text>
                <Pressable
                  accessibilityRole="button"
                  onPress={() =>
                    setNotice(
                      "Trax accounts are created by your workspace admin. Ask them to invite your work email, then sign in here."
                    )
                  }
                >
                  <Text style={s.link}>Sign Up</Text>
                </Pressable>
              </View>
            </View>

            <Text style={s.footer}>{API_URL.replace(/^https?:\/\//, "")}</Text>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

function createStyles(colors: Colors) {
  return StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.brand },
  scroll: { flexGrow: 1, paddingHorizontal: spacing.lg, paddingBottom: spacing.xl },

  header: { alignItems: "center", gap: spacing.sm, paddingTop: spacing.xl, paddingBottom: spacing.xl },
  title: {
    fontFamily: fonts.heading,
    fontSize: 30,
    lineHeight: 36,
    color: "#fff",
    textAlign: "center",
    letterSpacing: -0.6,
  },
  subtitle: { fontFamily: fonts.body, fontSize: 14, color: "#c9cbe8", textAlign: "center" },

  card: {
    backgroundColor: colors.surface,
    borderRadius: 24,
    padding: spacing.xl,
    gap: spacing.md,
  },

  google: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingVertical: 13,
  },
  // A letterform rather than Google's mark: the real asset carries brand rules
  // and would need a licence review before shipping.
  googleG: { fontFamily: fonts.heading, fontSize: 17, color: "#4285F4" },
  googleLabel: { fontFamily: fonts.bodySemi, fontSize: 15, color: colors.text },

  dividerRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.xs },
  rule: { flex: 1, height: 1, backgroundColor: colors.border },
  dividerText: { fontFamily: fonts.body, fontSize: 12, color: colors.faint },

  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 13,
    fontFamily: fonts.body,
    fontSize: 15,
    color: colors.text,
    backgroundColor: colors.surface,
  },
  pwWrap: { position: "relative", justifyContent: "center" },
  eye: { position: "absolute", right: 12 },

  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  remember: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  box: {
    width: 18,
    height: 18,
    borderRadius: 5,
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
    alignItems: "center",
    justifyContent: "center",
  },
  boxOn: { backgroundColor: colors.brand, borderColor: colors.brand },
  rememberLabel: { fontFamily: fonts.body, fontSize: 13, color: colors.textMuted },
  link: { fontFamily: fonts.bodySemi, fontSize: 13, color: colors.brand },

  submit: {
    backgroundColor: colors.brand,
    borderRadius: radius.md,
    paddingVertical: 15,
    alignItems: "center",
    marginTop: spacing.xs,
  },
  submitLabel: { fontFamily: fonts.bodySemi, fontSize: 16, color: "#fff" },

  signupRow: { flexDirection: "row", justifyContent: "center", alignItems: "center" },
  signupText: { fontFamily: fonts.body, fontSize: 13, color: colors.textMuted },

  footer: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: "#8a8db8",
    textAlign: "center",
    marginTop: spacing.lg,
  },
  });
}
