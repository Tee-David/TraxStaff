# TraxStaff Mobile

![Expo](https://img.shields.io/badge/Expo-54-000020?logo=expo&style=flat-square)
![React Native](https://img.shields.io/badge/React_Native-0.81-61DAFB?logo=react&style=flat-square)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&style=flat-square)
![Kotlin](https://img.shields.io/badge/Kotlin-native%20module-7F52FF?logo=kotlin&style=flat-square)
![Android](https://img.shields.io/badge/Android-supported-3DDC84?logo=android&style=flat-square)
![iOS](https://img.shields.io/badge/iOS-manual%20only-000000?logo=apple&style=flat-square)

**The TraxStaff companion app for Android (full tracking) and iOS (manual timer + review) — deliberately not the desktop tracker.**

TraxStaff Mobile is a manual-first time-tracking client: start/stop a timer against a project/task, review your timesheet, manage tasks, and see exactly what TraxStaff records about you. On Android it also runs a real foreground-service tracker (survives app kill, reboot, and clock changes) via a custom native Expo module. There is **no screenshot capture, no activity-percentage scoring, no location, and no reading of installed apps or websites** on mobile — that's a deliberate product boundary, not a missing feature (see [Positioning](#positioning), below).

---

## Architecture

```
                 +----------------------------------+
                 |     Expo Router app (app/)         |
                 |  welcome → login → (tabs)           |
                 +------------------+------------------+
                                    |
        +---------------------------+---------------------------+
        |                                                       |
+-------v--------+                                    +---------v---------+
| TrackerContext  |  JS timer state, manual start/stop  |  trax-tracker      |
| (src/tracker)   |  optimistic sync                    |  (native module)   |
+-------+---------+                                    +---------+---------+
        |                                                        |
        | HTTPS (fetch)                              Kotlin: TrackingService (foreground
        |                                              service), Ledger, BootReceiver,
+-------v---------------------------+                  ClockChangeReceiver, Notifications
| TraxStaff backend (Fastify)        |
|   trax-backend-ocaq.onrender.com   |
+-------------------------------------+
```

### Components

| Piece | Technology | Notes |
| --- | --- | --- |
| Navigation | `expo-router` | File-based routing: `app/welcome.tsx` → `app/login.tsx` → `app/(tabs)/*` |
| Timer state | `src/tracker/TrackerContext.tsx` | Client-claimed `startedAt` is only ever a *claim* — the backend reconciles it against its own clock, same contract as desktop |
| Auth | `src/auth/AuthContext.tsx` + `secureStorage.ts` | JWT held in `expo-secure-store`, with a web-fallback (`localStorage`) shim for Expo web builds |
| Native Android tracker | `modules/trax-tracker` (custom Expo module, Kotlin) | `TrackingService.kt` (foreground service, survives app kill), `Ledger.kt` (durable local time record), `BootReceiver.kt` / `ClockChangeReceiver.kt` (tamper-relevant device events), `TraxNotifications.kt` (the always-visible tracking notification) |
| Theming | `src/ThemeProvider.tsx` + `src/theme.ts` | Light/dark palettes, resolved from an explicit choice or `useColorScheme()` on "System", persisted locally |
| Update check | `src/updateCheck.ts` | Compares the installed build (`expo-application`'s `Application.nativeApplicationVersion` — **not** the static, CI-unstamped `app.config.ts` version field) against the latest GitHub Release, and surfaces a banner with a direct APK download link when newer |
| Charts / lists | `src/charts.tsx`, `src/picker.tsx`, `src/ui.tsx` | Shared presentation components |

### Why not full background tracking on iOS

iOS gives a backgrounded app no reliable way to keep a timer or foreground-service equivalent alive — anything that tried would silently stop. TraxStaff Mobile's iOS scope is **deliberately manual timer + review only**; there is no attempt to fake background tracking there. Android's `trax-tracker` module exists precisely because Android *does* offer a real foreground-service primitive Apple doesn't.

---

## Project structure

```
mobile/
├── app/
│   ├── welcome.tsx           # First-run screen
│   ├── login.tsx              # Auth
│   ├── disclosure.tsx          # Full monitoring-consent copy (the one authoritative source)
│   ├── session/[id].tsx        # Single time-entry detail
│   ├── (tabs)/
│   │   ├── index.tsx            # Timer — start/stop, today/week totals, sync status, update banner
│   │   ├── timesheets.tsx        # Timesheet review
│   │   ├── tasks.tsx             # Task list
│   │   └── profile.tsx           # Disclosure teaser cards, permissions, theme picker
│   └── _layout.tsx / (tabs)/_layout.tsx
├── src/
│   ├── auth/                  # AuthContext, secure token storage
│   ├── tracker/                # TrackerContext — JS-side timer state + sync
│   ├── api/                    # client.ts (typed fetch wrappers), types.ts
│   ├── theme.ts / ThemeProvider.tsx
│   ├── updateCheck.ts
│   ├── charts.tsx / picker.tsx / ui.tsx
│   └── format.ts / useAsync.ts
├── modules/trax-tracker/       # Custom Expo native module (Android foreground tracking)
│   ├── index.ts                 # JS bridge
│   └── android/src/main/java/expo/modules/traxtracker/
│       ├── TrackingService.kt     # Foreground service
│       ├── Ledger.kt               # Durable local time ledger
│       ├── BootReceiver.kt          # Resumes tracking state after a reboot
│       ├── ClockChangeReceiver.kt    # Flags a device clock change mid-session
│       └── TraxNotifications.kt      # The always-visible tracking notification
├── assets/images/               # App icon, splash, adaptive-icon set, iOS icon
└── app.config.ts                 # Expo config: permissions, plugins, bundle identifiers
```

---

## Quick start

### Prerequisites

- Node.js 18+
- [Expo CLI](https://docs.expo.dev/get-started/installation/) (`npx expo` — no global install needed)
- Android: Android Studio + an emulator or a device with USB debugging, since `trax-tracker` is a custom native module — **Expo Go cannot run this app**, only a development build or a real prebuild.
- iOS: Xcode (macOS only) — review/manual-timer scope only, no native module needed there.

### Install

```bash
cd mobile
npm install
```

### Environment

The backend URL is baked in at build time so a release APK never points at a dev machine:

```bash
# mobile/.env (optional — only to override the default)
EXPO_PUBLIC_API_URL=http://localhost:3099
```

Falls back to `https://trax-backend-ocaq.onrender.com` if unset.

### Run (development build required — not Expo Go)

```bash
npx expo prebuild          # generates android/ (gitignored) with the native module wired in
npx expo run:android        # build + install + launch on a device/emulator
```

### Type-check / bundle-check

```bash
npx tsc --noEmit
npx expo export --platform android   # verifies the JS bundle without a full native build
```

---

## Feature map

| Area | Status |
| --- | --- |
| Manual timer (start/stop, project/task selection) | ✅ |
| Android foreground-service tracking (survives kill/reboot, boot + clock-change receivers) | ✅ |
| Timesheet review, task list | ✅ |
| Screenshots, activity %, location tracking | ⛔ never — deliberate scope boundary, not a gap |
| Disclosure / consent (full text + a 6-card compact teaser on Profile) | ✅ |
| Light / dark / system theming | ✅ |
| Safe-area / notch / gesture-nav handling | ✅ audited |
| Update-available banner (compares real installed version, not the static config one) | ✅ |
| Entrance/press animation pass (`react-native-reanimated`) | 🔧 in progress |
| iOS build pipeline (EAS-triggered from the same Actions pipeline) | ⏸ planned, not yet wired |
| Play Store listing / Play App Signing enrolment | ⏸ deferred |

## Positioning

Mirrors the desktop app's own honesty rule: TraxStaff is **tamper-evident**, not tamper-proof, and **never covert** — a persistent OS notification is shown any time tracking is active, and consent is explicit and recorded server-side against a version. `app/disclosure.tsx` is the single authoritative copy of what is and isn't recorded; every other screen that mentions it (the Profile card grid, the first-run consent flow) is a compact pointer to that one source, not a second copy that can drift out of sync with it.

---

## Releases & versioning

Built by [`.github/workflows/mobile-android.yml`](../.github/workflows/mobile-android.yml) — not EAS Build, since `trax-tracker` is a custom native module and EAS is a paid, account-gated service out of scope for this repo's free-tier constraints. See [`.github/workflows/README.md`](../.github/workflows/README.md) for the full CI contract (keystore/signing setup, versioning rule, why the Android build can't use Expo Go or EAS).

- **Tag `vX.Y.Z`** → the APK is stamped and released as `X.Y.Z`.
- **Untagged push** → last tag with the patch bumped, plus `-dev.<run_number>`.
- Release asset: `trax-<version>-android.apk`.
- The in-app update banner reads the same GitHub Release via the web dashboard's `/api/releases/latest` proxy and compares against `expo-application`'s `Application.nativeApplicationVersion` — never the static, CI-unstamped `version` field in `app.config.ts`.

Branch flow is shared across the whole repo: `dev` → `staging` → `main`, never pushed to `main` directly.

## Scripts

```bash
npx expo start                        # dev server (requires a dev-client build, not Expo Go)
npx expo prebuild                     # regenerate the native android/ project
npx expo run:android                  # build + install + launch
npx expo export --platform android    # bundle-check without a full native build
npx tsc --noEmit                       # type-check
npx expo lint                          # lint
```

## License

© 2026 Wendiloveee Media. All rights reserved. Developed by WDC Solutions.
