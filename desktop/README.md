# TraxStaff Desktop

![Tauri](https://img.shields.io/badge/Tauri-2-24C8DB?logo=tauri&style=flat-square)
![Rust](https://img.shields.io/badge/Rust-2021-000000?logo=rust&style=flat-square)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&style=flat-square)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&style=flat-square)
![Vite](https://img.shields.io/badge/Vite-6-646CFF?logo=vite&style=flat-square)
![Windows](https://img.shields.io/badge/Windows-supported-0078D6?logo=windows&style=flat-square)
![Linux](https://img.shields.io/badge/Linux-supported-FCC624?logo=linux&style=flat-square)

**The TraxStaff time-tracking tray app for Windows and Linux — visible, tamper-evident, never covert.**

TraxStaff Desktop is a small always-on-top tray application that a staff member runs locally. It tracks time against a project/task, samples input activity and the foreground app/URL, takes periodic screenshots, and syncs everything to the TraxStaff backend — offline-first, so a flaky connection never loses tracked time. A persistent OS notification is shown any time tracking is active; there is no hidden or silent mode.

---

## Architecture

```
                    +-----------------------------+
                    |     React 19 UI (Vite)       |
                    |  App.tsx / CircularTimer /    |
                    |  DatePicker / Consent / ...   |
                    +---------------+---------------+
                                    | Tauri IPC (invoke/emit)
                    +---------------v---------------+
                    |        Rust core (src-tauri)   |
                    |  capture · clock · os_idle ·    |
                    |  url_capture · notify · sync    |
                    +---------------+---------------+
                                    | HTTPS (reqwest)
                    +---------------v---------------+
                    |   TraxStaff backend (Fastify)  |
                    |   trax-backend-ocaq.onrender.com|
                    +---------------------------------+
```

### Components

| Piece | Technology | Notes |
| --- | --- | --- |
| UI | React 19, TypeScript, Vite | `desktop/src` — the tray window's frontend |
| Native shell | Tauri 2 | window chrome, tray icon, single-instance guard, auto-updater |
| Timing | `clock.rs` | Windows: `QueryUnbiasedInterruptTimePrecise` + QPC. Linux: `CLOCK_MONOTONIC` + `CLOCK_BOOTTIME` via `libc`. Both pairs separate "awake" time from "elapsed wall-clock" time, so sleep/suspend is never credited as work and a changed system clock is detectable, not exploitable. |
| Activity sampling | `rdev`, `active-win-pos-rs` | Input **intensity** (counts/timing only, never keystrokes/content) plus the foreground app; Windows also samples the active browser tab's URL via UI Automation (`url_capture.rs`, Windows-only today). |
| Screenshots | `xcap`, `webp` | All-monitor capture, encoded to WebP (smaller than PNG/JPEG) before upload. |
| Idle detection | `os_idle.rs` | Windows: `GetLastInputInfo`. Linux: `org.freedesktop.ScreenSaver`, falling back to `org.gnome.Mutter.IdleMonitor` over `gdbus`. |
| Integrity | `sha2` (`hashchain.ts`-compatible) | Activity blocks are hash-chained with the exact same byte layout the backend verifies — tamper-evident, not just self-reported. |
| Anti-cheat | `sysinfo` | Blocklists known mouse-jiggler processes; combined with the server-side anomaly flags in `web/backend/src/lib/anomaly.ts`. |
| Sync | `sync.rs` | Offline-first queue: activity blocks and screenshots queue locally and flush when a connection is available; a session whose registration never reached the server is treated as permanently unsendable rather than retried forever. |
| Notifications | `tauri-plugin-notification` | Real OS notifications for tracking start/stop and idle prompts — never just an in-app toast, which is invisible when the window is minimized. |
| Auto-update | `tauri-plugin-updater` | Polls `latest.json` from the newest GitHub Release; refuses to "upgrade" to anything not strictly newer than the running build (see the versioning note below). |

> **Positioning, kept honest:** on a machine where the user has local admin, nothing client-side is unbeatable. TraxStaff is **tamper-evident and hard-capped**, not tamper-proof — credited time comes from a hardware counter the OS clock can't influence, and is capped against the server's own clock, which the client can neither see nor influence.

---

## Project structure

```
desktop/
├── src/                    # React UI
│   ├── App.tsx              # Main window: timer, stats, sync status, updater prompt
│   ├── CircularTimer.tsx     # The tracking ring
│   ├── Consent.tsx           # First-run monitoring disclosure
│   ├── DatePicker.tsx        # Branded date picker (timesheet review)
│   ├── Select.tsx            # Branded select
│   ├── LightRays.tsx/.css    # Background effect
│   ├── api.ts                # Backend API base URL + fetch helpers
│   └── useInfinite.ts        # Infinite-scroll hook for history views
├── src-tauri/
│   ├── src/
│   │   ├── main.rs           # Entry point
│   │   ├── lib.rs             # Tauri command registration, app setup, tray
│   │   ├── clock.rs            # Tamper-resistant timing (see above)
│   │   ├── capture.rs          # Activity sampling + screenshot capture + hash-chain
│   │   ├── os_idle.rs          # Cross-platform idle detection
│   │   ├── url_capture.rs      # Windows browser URL sampling (UI Automation)
│   │   ├── notify.rs           # OS notification wrappers
│   │   └── sync.rs             # Offline queue + backend sync
│   ├── icons/                # App icons (all platforms/sizes)
│   ├── installer/            # NSIS header/sidebar images
│   ├── installer-hooks.nsh   # Custom NSIS install hooks
│   ├── Cargo.toml
│   └── tauri.conf.json        # Bundle targets, updater endpoint, CSP, window config
└── public/brand/              # Shared brand SVGs (icon-color, icon-white, icon-badge)
```

---

## Quick start

### Prerequisites

- Node.js 18+
- Rust (stable, `rust-version = "1.77"` minimum) via [rustup](https://rustup.rs)
- Platform build tools Tauri needs:
  - **Windows:** the MSVC C++ build tools (Visual Studio Build Tools, "Desktop development with C++")
  - **Linux:** `libwebkit2gtk-4.1-dev`, `libgtk-3-dev`, `libayatana-appindicator3-dev`, plus the usual `build-essential`

### Install

```bash
cd desktop
npm install
```

### Environment

The API base URL is picked up at build time via `VITE_BACKEND_URL`; if unset it falls back to `http://localhost:3099` in dev and `https://trax-backend-ocaq.onrender.com` in a production build. Point it at a local `web/backend` instance for local development:

```bash
# desktop/.env (optional — only needed to override the default)
VITE_BACKEND_URL=http://localhost:3099
```

### Run

```bash
npm run tauri dev     # dev window, hot-reloading UI, live Rust rebuild on change
```

### Build an installer

```bash
npm run tauri build    # produces the platform's bundle targets (see below)
```

Bundle targets: `nsis` (Windows `.exe` installer), `appimage` (portable Linux), `deb` (Debian/Ubuntu package) — configured in `tauri.conf.json`.

---

## Feature map

| Area | Status |
| --- | --- |
| Tamper-resistant timing (sleep-excluded hardware counters, both platforms) | ✅ |
| Server-side reconciliation (clock skew, elapsed-time cap, session-window checks) | ✅ |
| Periodic multi-monitor screenshots (WebP, admin-configurable frequency + blur) | ✅ |
| Activity sampling (input intensity + foreground app; URL capture on Windows) | ✅ (Linux URL capture not yet implemented) |
| Offline-first sync queue with permanent-failure handling | ✅ |
| Mouse-jiggler process blocklist | ✅ (Windows-process-name shaped; Linux equivalents pending) |
| OS-level notifications (tracking start/stop, idle prompts) | ✅ |
| Auto-update via GitHub Releases | ✅ |
| System tray icon, single-instance guard | ✅ |
| Branded date picker / select / consent screen | ✅ |
| Linux AppImage/deb parity with Windows | ✅ build config, ⏸ pending a real-device verification pass |

---

## Releases & versioning

Built by [`.github/workflows/desktop-build.yml`](../.github/workflows/desktop-build.yml) — see [`.github/workflows/README.md`](../.github/workflows/README.md) for the full CI contract shared with the mobile build.

- **Tag `vX.Y.Z`** → the installer is stamped and released as `X.Y.Z`.
- **Untagged push** (`dev`/`staging`/`main`) → last tag with the patch bumped, plus `-dev.<run_number>` (e.g. `0.1.19-dev.42`) — always sorts above the last real release, so the updater never "downgrades" a dev build back to stale code.
- The updater (`tauri-plugin-updater`) checks `latest.json` once per launch and only ever moves to a strictly newer version.
- Release assets: `TraxStaff_<version>_x64-setup.exe` (Windows), `TraxStaff_<version>_amd64.AppImage` + `TraxStaff_<version>_amd64.deb` (Linux).

Branch flow is shared across the whole repo: `dev` → `staging` → `main`, never pushed to `main` directly.

## Scripts

```bash
npm run dev            # Vite dev server (UI only, no Tauri shell)
npm run build           # tsc + vite build (UI production bundle)
npm run tauri dev       # full app, dev mode
npm run tauri build      # full app, production installer(s)
npx tsc --noEmit         # type-check the UI
```

## License

© 2026 Wendiloveee Media. All rights reserved. Developed by WDC Solutions.
