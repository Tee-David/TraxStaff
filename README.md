# TraxStaff

![Tauri](https://img.shields.io/badge/Tauri-2-24C8DB?logo=tauri&style=flat-square)
![Expo](https://img.shields.io/badge/Expo-54-000020?logo=expo&style=flat-square)
![Next.js](https://img.shields.io/badge/Next.js-15-black?logo=nextdotjs&style=flat-square)
![Fastify](https://img.shields.io/badge/Fastify-5-000000?logo=fastify&style=flat-square)
![Prisma](https://img.shields.io/badge/Prisma-6-2D3748?logo=prisma&style=flat-square)
![CockroachDB](https://img.shields.io/badge/CockroachDB-PostgreSQL-6933FF?logo=cockroachlabs&style=flat-square)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&style=flat-square)

**Time tracking your team can actually see — visible, tamper-evident, never covert.**

TraxStaff is three clients (a Windows/Linux desktop tray app, an Android/iOS mobile app, and a web dashboard) talking to one Fastify + CockroachDB backend. A staff member tracks time against a project/task; the org sees reports, screenshots, and activity through the dashboard. Every ordinary page defaults every role — admins included — to seeing only their own data; org-wide visibility is opt-in and reserved for the actual admin-management pages.

🌐 **Live:** dashboard at [app.traxstaff.com](https://app.traxstaff.com) · marketing site at [traxstaff.com](https://traxstaff.com)
📦 **Downloads:** [latest GitHub Release](https://github.com/Tee-David/trax/releases/latest) (Windows, Linux, Android)

---

## The three clients, in one repo

| | Docs | What it is |
| --- | --- | --- |
| 🖥️ **Desktop** | [`desktop/README.md`](desktop/README.md) | Tauri 2 + Rust tray app for Windows and Linux. Tamper-resistant timing off a hardware counter, periodic screenshots, activity sampling, offline-first sync, auto-update. |
| 📱 **Mobile** | [`mobile/README.md`](mobile/README.md) | Expo/React Native app. Manual timer + review on iOS; a real foreground-service tracker on Android via a custom native Kotlin module. Deliberately **no** screenshots, activity %, or location on mobile — a stated product boundary, not a gap. |
| 🌐 **Web** | [`web/README.md`](web/README.md) | Next.js 15 dashboard (+ the public marketing site, split by hostname) and a Fastify + Prisma API against CockroachDB. Reports, members, projects, screenshots, an onboarding tour, and the self-only scoping model every client relies on. |

Each of those READMEs goes deep on its own architecture, project structure, local setup, and feature map — this one is the map of the whole repo.

---

## Architecture

```
   +-------------+   +-------------+
   |   Desktop   |   |   Mobile    |
   |  (Tauri/Rust)|   | (Expo/RN)   |
   +------+------+   +------+------+
          |                 |
          |   HTTPS (JWT)   |
          +--------+--------+
                   |
          +--------v--------+          +--------------------+
          |  Fastify API    +----------+  Cloudflare R2      |
          |  (web/backend)  |          |  (screenshots)      |
          +--------+--------+          +--------------------+
                   |
          +--------v--------+
          |   CockroachDB    |
          +------------------+

          +------------------+
          | Next.js dashboard |  traxstaff.com (marketing) +
          | (web/frontend)     |  app.traxstaff.com (dashboard),
          +------------------+  same deployment, split by hostname
```

Desktop and mobile both talk to the same backend over the same authenticated REST API — neither client is treated as a first-class citizen over the other; the self-only data-scoping rule lives once, server-side, and both clients (and the web dashboard) automatically inherit it by simply never sending an org-wide opt-in parameter.

---

## Core product principles

**Never covert.** A visible, persistent notification is shown any time tracking is active, on every client. Consent is explicit and recorded server-side against a version. This is a design constraint, not a compliance afterthought — it shapes real engineering decisions (e.g. mobile's screen-capture research concluded the *design*, not the build, specifically because Android's `MediaProjection` consent dialog can't be made covert either).

**Tamper-evident, not tamper-proof.** On a machine where the user has local admin, nothing client-side is unbeatable. Credited duration comes from a hardware counter the OS clock can't influence (Windows: `QueryUnbiasedInterruptTimePrecise` + QPC; Linux: `CLOCK_MONOTONIC` + `CLOCK_BOOTTIME`), and is capped against the server's own clock, which the client can neither see nor influence. Clock-skew and anomaly signals are recorded as flags for a human to review — never silently used to drop data.

**Self-only by default, everywhere.** Every ordinary page or endpoint (Dashboard, Timesheets, Reports, Screenshots) defaults a privileged caller (owner/admin) to their own data — the exact same view a regular member gets. Org-wide visibility is an explicit, deliberate opt-in (`?scope=team`) sent only by the genuinely admin-only management surfaces (Insights, the Projects/Members management views). Desktop and mobile inherit this automatically since neither ever sends that opt-in.

**No fabricated content, anywhere.** The marketing site has no fake client logos, invented testimonials, or made-up traction numbers — every claim on it is either a real, verifiable fact about the product or an honest non-numeric statement.

---

## Quick start

Each client has its own prerequisites and setup — see the linked README for the one you're working on. The short version:

```bash
# Backend (Fastify + Prisma + CockroachDB)
cd web/backend && npm install && npm run dev        # http://localhost:3099

# Web dashboard (Next.js)
cd web/frontend && npm install && npm run dev        # http://localhost:3000

# Desktop (Tauri)
cd desktop && npm install && npm run tauri dev

# Mobile (Expo — needs a dev build, not Expo Go, since it ships a custom native module)
cd mobile && npm install && npx expo prebuild && npx expo run:android
```

---

## Branching & release workflow

`main` is production — never pushed to directly:

```
dev ──▶ staging ──▶ main
```

- **CI**: [`.github/workflows/desktop-build.yml`](.github/workflows/desktop-build.yml) and [`mobile-android.yml`](.github/workflows/mobile-android.yml) build every push touching their respective trees; a version tag (`vX.Y.Z`) triggers a full GitHub Release with signed installers (Windows `.exe`, Linux `.AppImage`/`.deb`, Android `.apk`) and a merged `latest.json` for the desktop auto-updater. See [`.github/workflows/README.md`](.github/workflows/README.md) for the full CI contract, including why the Android build runs on GitHub Actions directly rather than EAS.
- **Versioning**: a `vX.Y.Z` tag ships as `X.Y.Z`; an untagged push gets the last tag's patch bumped plus `-dev.<run_number>`, so a dev build always sorts above the last real release and the updater never "downgrades" anyone back to stale code.
- **Deployment**: the web dashboard/marketing site deploys to Vercel on every push (previews on `dev`/`staging`, production on `main`); the backend deploys to Render. Desktop and mobile installers are GitHub Releases, downloaded directly or fetched by the dashboard's own "Download app" widget via `/api/releases/latest`.

## Living plan

`plans/checklist.md` (gitignored, not part of the repo) is the running build checklist — what's shipped, what's in flight, and what's deliberately deferred with its reasoning written down (e.g. mobile screenshot capture: fully designed, not yet built, because shipping it means rewriting the app's own "no screenshots" consent copy first).

## License

© 2026 Wendiloveee Media. All rights reserved. Developed by WDC Solutions.
