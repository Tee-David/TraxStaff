import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { Dimensions, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { AnimatedPressable } from "../src/motion";
import { useTheme } from "../src/ThemeProvider";
import { Colors, fonts, radius, spacing } from "../src/theme";

/**
 * First screen an unauthenticated person sees.
 *
 * The hero is the artwork only — the headline, buttons and pager baked into the
 * source mock were cropped off, because rendering them as real text keeps them
 * crisp at every density, themeable, and translatable. A screenshot of a button
 * is not a button.
 */
const HERO = require("../assets/images/welcome-hero.jpg");

// The card overlaps the artwork rather than butting against it, so the image
// reads as continuing behind the sheet.
const CARD_OVERLAP = 28;

export default function Welcome() {
  const router = useRouter();
  const { colors } = useTheme();
  const s = useMemo(() => createStyles(colors), [colors]);
  const [notice, setNotice] = useState(false);
  const { height } = Dimensions.get("window");

  return (
    <View style={s.root}>
      <Image
        source={HERO}
        style={[s.hero, { height: Math.round(height * 0.56) }]}
        contentFit="cover"
        contentPosition="top center"
        transition={200}
        accessibilityIgnoresInvertColors
      />

      <SafeAreaView style={s.sheetWrap} edges={["bottom"]}>
        <View style={s.sheet}>
          <View style={s.badge}>
            <Image
              source={require("../assets/images/icon.png")}
              style={{ width: 34, height: 34 }}
              contentFit="contain"
            />
          </View>

          <Text style={s.headline}>Work smarter.{"\n"}Achieve more.</Text>
          <Text style={s.sub}>
            Track time, boost productivity, and grow together — without the surveillance.
          </Text>

          <AnimatedPressable
            accessibilityRole="button"
            onPress={() => router.push("/login")}
            style={s.primary}
          >
            <Text style={s.primaryLabel}>Login</Text>
          </AnimatedPressable>

          {/* Trax accounts are created by an admin invitation, never self-serve —
              a staff tracker that let anyone sign themselves in would be a hole,
              not a feature. So this explains the route in rather than pretending
              to offer a signup form. It must NOT navigate: every other route is
              behind the auth gate, which would bounce straight back here. */}
          <Pressable
            accessibilityRole="button"
            onPress={() => setNotice(true)}
            style={({ pressed }) => [s.secondary, pressed && { opacity: 0.6 }]}
          >
            <Text style={s.secondaryLabel}>Create an account</Text>
          </Pressable>

          {notice ? (
            <Text style={s.notice}>
              Trax accounts are created by your workspace admin. Ask them to invite your work
              email, then sign in above.
            </Text>
          ) : null}
        </View>
      </SafeAreaView>
    </View>
  );
}

function createStyles(colors: Colors) {
  return StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.brand },
  hero: { width: "100%" },

  sheetWrap: { flex: 1, marginTop: -CARD_OVERLAP },
  sheet: {
    flex: 1,
    backgroundColor: colors.surface,
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xl,
    alignItems: "center",
    gap: spacing.md,
  },

  badge: {
    width: 60,
    height: 60,
    borderRadius: 18,
    backgroundColor: colors.accentSoft,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.xs,
  },

  headline: {
    fontFamily: fonts.heading,
    fontSize: 30,
    lineHeight: 36,
    letterSpacing: -0.8,
    color: colors.text,
    textAlign: "center",
  },
  sub: {
    fontFamily: fonts.body,
    fontSize: 15,
    lineHeight: 22,
    color: colors.textMuted,
    textAlign: "center",
    paddingHorizontal: spacing.sm,
  },

  primary: {
    width: "100%",
    backgroundColor: colors.brand,
    borderRadius: radius.lg,
    paddingVertical: 16,
    alignItems: "center",
    marginTop: spacing.md,
  },
  primaryLabel: { fontFamily: fonts.bodySemi, fontSize: 16, color: "#fff" },

  secondary: { paddingVertical: spacing.md },
  secondaryLabel: { fontFamily: fonts.bodySemi, fontSize: 15, color: colors.brand },
  notice: {
    fontFamily: fonts.body,
    fontSize: 13,
    lineHeight: 19,
    color: colors.textMuted,
    textAlign: "center",
    paddingHorizontal: spacing.sm,
  },
  });
}
