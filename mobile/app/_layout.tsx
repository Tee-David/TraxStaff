import { Outfit_400Regular, Outfit_500Medium, Outfit_600SemiBold } from "@expo-google-fonts/outfit";
import { SpaceGrotesk_500Medium, SpaceGrotesk_700Bold } from "@expo-google-fonts/space-grotesk";
import { useFonts } from "expo-font";
import { Stack, useRouter, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AuthProvider, needsConsent, useAuth } from "../src/auth/AuthContext";
import { ThemeProvider, useTheme } from "../src/ThemeProvider";
import { TrackerProvider } from "../src/tracker/TrackerContext";
import { Loading } from "../src/ui";

SplashScreen.preventAutoHideAsync().catch(() => {});

// Screens a signed-out person is allowed to sit on. /welcome is the landing
// screen and pushes to /login; both have to be in this set or the gate would
// yank the user back the moment they tap "Login".
const AUTH_ROUTES: readonly string[] = ["welcome", "login"];

/**
 * Route gate. Three states, in priority order: signed out → /welcome, signed in
 * without a current consent → /disclosure, otherwise the tabs.
 *
 * The disclosure is a route rather than a modal behind a menu on purpose: Play
 * requires the monitoring disclosure to be *in* the app and encountered in
 * normal usage.
 */
function Gate() {
  const { status, me } = useAuth();
  const { colors } = useTheme();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (status === "loading") return;

    const group = segments[0];
    const onAuthScreen = AUTH_ROUTES.includes(group ?? "");
    const onDisclosure = group === "disclosure";

    if (status === "signedOut") {
      if (!onAuthScreen) router.replace("/welcome");
      return;
    }
    if (needsConsent(me)) {
      if (!onDisclosure) router.replace("/disclosure");
      return;
    }
    if (onAuthScreen || onDisclosure) router.replace("/");
  }, [status, me, segments, router]);

  useEffect(() => {
    if (status !== "loading") SplashScreen.hideAsync().catch(() => {});
  }, [status]);

  if (status === "loading") {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <Loading text="Signing you in…" />
      </View>
    );
  }

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.bg },
        animation: "fade",
      }}
    />
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    SpaceGrotesk_500Medium,
    SpaceGrotesk_700Bold,
    Outfit_400Regular,
    Outfit_500Medium,
    Outfit_600SemiBold,
  });

  // A font that fails to load must not hold the app hostage — render with the
  // platform default rather than showing a splash screen forever.
  if (!fontsLoaded && !fontError) return null;

  return (
    <ThemeProvider>
      <SafeAreaProvider>
        <AuthProvider>
          <TrackerProvider>
            <AppStatusBar />
            <Gate />
          </TrackerProvider>
        </AuthProvider>
      </SafeAreaProvider>
    </ThemeProvider>
  );
}

/** The Android status bar background always carries the brand colour (a thin
 *  branded strip above every screen), which is dark-toned in both palettes —
 *  navy in light mode, a lit navy-blue in dark mode — so white content stays
 *  legible in both and only the background needs to follow the resolved
 *  theme. */
function AppStatusBar() {
  const { colors } = useTheme();
  return <StatusBar style="light" backgroundColor={colors.brand} />;
}
