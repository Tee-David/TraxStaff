import { useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { API_URL } from "../src/api/client";
import { useAuth } from "../src/auth/AuthContext";
import { colors, fonts, spacing } from "../src/theme";
import { Banner, Button, Field } from "../src/ui";

export default function Login() {
  const { signIn, slow, error } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!email.trim() || !password) return;
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
    <SafeAreaView style={s.safe} edges={["top", "bottom"]}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
          <View style={s.brand}>
            <Text style={s.wordmark}>trax</Text>
            <Text style={s.tagline}>Time tracking without the surveillance.</Text>
          </View>

          <View style={s.form}>
            <Field
              label="Work email"
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              inputMode="email"
              placeholder="you@company.com"
              editable={!busy}
            />
            <Field
              label="Password"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoCapitalize="none"
              autoComplete="password"
              placeholder="••••••••"
              editable={!busy}
              onSubmitEditing={submit}
              returnKeyType="go"
            />

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

            <Button label="Sign in" onPress={submit} busy={busy} disabled={!email.trim() || !password} />
          </View>

          <Text style={s.footer}>{API_URL.replace(/^https?:\/\//, "")}</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.brand },
  scroll: { flexGrow: 1, padding: spacing.xl, justifyContent: "center", gap: spacing.xxl },
  brand: { gap: spacing.sm },
  wordmark: { fontFamily: fonts.heading, fontSize: 52, color: "#fff", letterSpacing: -2 },
  tagline: { fontFamily: fonts.body, fontSize: 16, color: "#c9cbe8", lineHeight: 22 },
  form: {
    backgroundColor: colors.surface,
    borderRadius: 22,
    padding: spacing.xl,
    gap: spacing.lg,
  },
  footer: { fontFamily: fonts.body, fontSize: 12, color: "#8a8db8", textAlign: "center" },
});
