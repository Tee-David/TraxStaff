import type { ExpoConfig } from "expo/config";

// Trax mobile — manual timer + review + tasks. Deliberately NOT the desktop
// tracker: no screenshots, no activity %, no accessibility service, no GPS.
// See plans/checklist.md §5.0 for the platform facts behind that decision.

// The API base is baked in at build time so a release APK never points at a dev
// machine. Overridable for local work via EXPO_PUBLIC_API_URL.
const API_URL = process.env.EXPO_PUBLIC_API_URL ?? "https://trax-backend-ocaq.onrender.com";

const config: ExpoConfig = {
  name: "Trax",
  slug: "trax",
  version: "0.1.0",
  scheme: "trax",
  orientation: "portrait",
  userInterfaceStyle: "automatic",
  newArchEnabled: true,
  icon: "./assets/images/icon.png",

  splash: {
    image: "./assets/images/splash-icon.png",
    resizeMode: "contain",
    backgroundColor: "#000065",
  },

  android: {
    package: "com.trax.mobile",
    // Play requires a monotonically increasing versionCode; CI does not bump it
    // yet, so bump this by hand for every store upload.
    versionCode: 1,
    adaptiveIcon: {
      foregroundImage: "./assets/images/android-icon-foreground.png",
      backgroundImage: "./assets/images/android-icon-background.png",
      monochromeImage: "./assets/images/android-icon-monochrome.png",
      backgroundColor: "#000065",
    },
    edgeToEdgeEnabled: true,
    // The tracker module's own AndroidManifest declares the foreground service,
    // its specialUse subtype property, the clock/boot receivers and the
    // isMonitoringTool meta-data; the manifest merger folds them in. Listing the
    // permissions here too keeps them visible from the JS side of the repo.
    permissions: [
      "android.permission.FOREGROUND_SERVICE",
      "android.permission.FOREGROUND_SERVICE_SPECIAL_USE",
      "android.permission.POST_NOTIFICATIONS",
      "android.permission.RECEIVE_BOOT_COMPLETED",
    ],
    // Explicitly NOT requested, and it should stay that way:
    //   QUERY_ALL_PACKAGES        — Play's permitted-use list excludes employee
    //                               monitoring; we never read installed apps.
    //   ACCESS_*_LOCATION         — no GPS in Trax mobile.
    //   BIND_ACCESSIBILITY_SERVICE — restricted to genuine accessibility apps
    //                               since 28 Jan 2026; using it risks the account.
    //   REQUEST_IGNORE_BATTERY_OPTIMIZATIONS — deep-link to Settings instead.
    blockedPermissions: ["android.permission.QUERY_ALL_PACKAGES"],
  },

  ios: {
    // Placeholder only — iOS is review-only and comes later (§5.5). No
    // background execution is possible there, so the timer would silently stop.
    bundleIdentifier: "com.trax.mobile",
    supportsTablet: false,
  },

  plugins: [
    "expo-router",
    "expo-secure-store",
    "expo-font",
    [
      "expo-build-properties",
      {
        android: {
          // API 36 from day one — mandatory for Play uploads from 31 Aug 2026.
          compileSdkVersion: 36,
          targetSdkVersion: 36,
          minSdkVersion: 26,
          buildToolsVersion: "36.0.0",
        },
      },
    ],
    [
      "expo-splash-screen",
      {
        image: "./assets/images/splash-icon.png",
        imageWidth: 180,
        resizeMode: "contain",
        backgroundColor: "#000065",
      },
    ],
  ],

  experiments: {
    typedRoutes: true,
  },

  extra: {
    apiUrl: API_URL,
  },
};

export default config;
