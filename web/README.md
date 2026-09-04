# TraxStaff Web

![Next.js](https://img.shields.io/badge/Next.js-15-black?logo=nextdotjs&style=flat-square)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&style=flat-square)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&style=flat-square)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-v4-06B6D4?logo=tailwindcss&style=flat-square)
![Fastify](https://img.shields.io/badge/Fastify-5-000000?logo=fastify&style=flat-square)
![Prisma](https://img.shields.io/badge/Prisma-6-2D3748?logo=prisma&style=flat-square)
![CockroachDB](https://img.shields.io/badge/CockroachDB-PostgreSQL-6933FF?logo=cockroachlabs&style=flat-square)
![Vercel](https://img.shields.io/badge/Vercel-deploy-000000?logo=vercel&style=flat-square)
![Render](https://img.shields.io/badge/Render-deploy-46E3B7?logo=render&style=flat-square)

**The TraxStaff web dashboard and API — the org-wide view onto time tracked by the desktop and mobile clients.**

`web/` is two deployables: a Next.js dashboard (marketing landing page at the apex domain, the authenticated app at a subdomain) and a Fastify + Prisma API against CockroachDB. Every ordinary page (Dashboard, Timesheets, Reports, Screenshots) is scoped to "just me" for every role, admins included — org-wide visibility is deliberately reserved for the admin-only management surfaces (Insights, Projects, Members) and an explicit `?scope=team` opt-in.

🌐 **Live:** dashboard at `app.traxstaff.com` · marketing site at `traxstaff.com` (same deployment, split by hostname via `middleware.ts`)

---

## Architecture

```
                    +--------------------------------+
                    |   traxstaff.com  (marketing)     |
                    |   app.traxstaff.com  (dashboard)  |
                    |   Next.js 15 · Vercel             |
                    +---------------+-------------------+
                                    | REST (fetch, JWT bearer)
                    +---------------v-------------------+
                    |      Fastify + Prisma API           |
                    |      Render (trax-backend-ocaq)      |
                    +---------------+-------------------+
                                    |
               +--------------------+---------------------+
               |                                          |
        +------v------+                          +---------v---------+
        | CockroachDB  |                          | Cloudflare R2      |
        | (PostgreSQL) |                          | (screenshot storage)|
        +-------------+                          +---------------------+
```

**Why the mail relay is a separate hop:** Render blocks outbound SMTP (confirmed empirically — both 465 and 587 hang and fail). Password-reset and invite emails are physically sent from a Vercel serverless route (`src/app/api/mail/send/route.ts`) using the org's own webmail SMTP credentials — still no third-party email provider — gated by a shared secret header; the backend's `mailer.ts` calls this relay when configured and falls back to direct SMTP otherwise (for local dev, where outbound SMTP isn't blocked).

### Components

| Piece | Technology | Deployment |
| --- | --- | --- |
| Frontend | Next.js 15 (App Router), React 19, TypeScript, Tailwind CSS v4, Framer Motion (`motion`), `recharts`, `react-joyride` | Vercel |
| Backend | Fastify 5, Zod validation, Prisma 6 ORM, JWT auth (`@fastify/jwt`) | Render |
| Database | CockroachDB (PostgreSQL-compatible) | CockroachDB Cloud |
| Object storage | Cloudflare R2 (screenshots), via `@aws-sdk/client-s3` (R2 is S3-compatible) | Cloudflare |
| Mail | Nodemailer over the org's own SMTP, relayed through a Vercel route when the backend can't reach it directly | Vercel + Render |
| Release feed | `/api/releases/latest` — proxies the newest GitHub Release (desktop installers + Android APK) with an in-memory + Next fetch cache, stale-on-error fallback | Vercel |

---

## Key capabilities

**Role-scoped everywhere, by default.** Every ordinary staff-facing page defaults a privileged caller (owner/admin) to their own data — the same "just me" view a regular member gets. Org-wide visibility is opt-in per request (`?scope=team`) and is only ever sent by the pages that are genuinely admin-management surfaces (Insights, Projects' management view). This applies to the desktop and mobile clients automatically too, since neither ever sends the opt-in param.

**Tamper-evident time, reconciled server-side.** The client's claimed session start is honoured only within a bounded window of server time; credited duration is capped against server-observed elapsed time; clock-skew and jiggler-process signals are recorded as flags, never used to silently drop data.

**Screenshots, admin-gated at the API, not just the UI.** Staff never receive a viewable URL for a screenshot in the API response — the row is still visible to them (so capture is never covert), but the presigned image URL is only ever generated for a privileged caller.

**Members, projects, tasks, reporting.** Invite/remove members (a "removed" status distinct from "disabled" — no history-destroying delete, since sessions/screenshots/timesheets/assignments all reference the user), assign projects and tasks per member, per-project and per-day reporting with CSV export, an activity-percentage calculation weighted by credited seconds (not an unweighted mean of blocks).

**A Settings page for every role.** Display name and password change are self-service for every member; screenshot policy, idle handling, work targets, and organisation details stay admin-only sections on the same page.

**A resumable onboarding tour.** `react-joyride`-based, covering every page, re-launchable at any time (not just on first login), gentle enough to skip a step whose target isn't on screen rather than stalling.

**A platform-aware download experience.** The dashboard header and the marketing site's closing CTA both surface the latest GitHub Release, auto-detecting the visitor's OS to lead with the right installer.

---

## Project structure

```
web/
├── frontend/
│   ├── src/app/
│   │   ├── page.tsx              # Marketing landing page (traxstaff.com only — see middleware.ts)
│   │   ├── login/, forgot-password/, reset-password/, accept-invite/
│   │   ├── app/                   # The authenticated dashboard (app.traxstaff.com)
│   │   │   ├── layout.tsx           # Shared shell: sidebar, top bar, download button
│   │   │   ├── page.tsx              # Dashboard (self-only for every role)
│   │   │   ├── timesheets/            # Personal timesheet + workload-style summary cards
│   │   │   ├── reports/               # Per-project / app / URL reporting, CSV export
│   │   │   ├── screenshots/            # Screenshot review (admin-viewable only)
│   │   │   ├── insights/               # Admin-only: org-wide leaderboard/activity
│   │   │   ├── projects/               # Admin-only: project + task management, member assignment
│   │   │   ├── members/                # Admin-only: invite, assign, disable/remove
│   │   │   └── settings/               # Every role: account; admin-only: screenshots/tracking/targets/org
│   │   └── api/
│   │       ├── mail/send/               # SMTP relay (Render can't send mail directly)
│   │       └── releases/latest/          # GitHub Releases proxy for the download widgets
│   ├── src/components/
│   │   ├── marketing/                  # Landing-page sections (Nav, Hero, Features, DownloadCta, ...)
│   │   ├── tour/                        # Onboarding tour (react-joyride provider/registry/tooltip)
│   │   ├── ui.tsx, icons.tsx, filters.tsx, DataTable.tsx, ...
│   │   └── WorkloadCard.tsx, TimesheetCard.tsx   # Reusable summary-chart cards
│   ├── src/lib/
│   │   ├── api.ts                    # Typed fetch wrapper + auth header
│   │   ├── auth.tsx                   # useAuth() context
│   │   ├── theme.ts / theme-transition.ts
│   │   ├── releases.ts                 # Shared OS-detection + release-fetch logic
│   │   └── site.ts                     # traxstaff.com / app.traxstaff.com constants
│   └── middleware.ts                    # Splits traxstaff.com (marketing) from every other host (dashboard)
└── backend/
    ├── src/
    │   ├── index.ts                    # Fastify bootstrap, route registration, error handling
    │   ├── env.ts                       # Zod-validated environment schema
    │   ├── plugins/auth.ts               # JWT auth decorator
    │   ├── lib/
    │   │   ├── hashchain.ts                # Canonical activity-block hash (mirrored in desktop's capture.rs)
    │   │   ├── anomaly.ts                   # Server-side tamper/anomaly flag logic
    │   │   ├── r2.ts                         # Presigned upload/download URLs
    │   │   ├── mailer.ts                      # Direct SMTP or the Vercel relay, depending on env
    │   │   └── password.ts, prisma.ts
    │   └── routes/
    │       ├── auth.ts                    # login, register, invite accept, password reset/change, /me
    │       ├── members.ts                  # invite, status changes (active/disabled/removed), role
    │       ├── projects.ts, tasks.ts         # project + task CRUD, member assignment
    │       ├── sessions.ts                   # start/stop/heartbeat, manual entries, listing
    │       ├── reports.ts, insights.ts        # summary/timesheet/by-project/app/url reporting
    │       ├── screenshots.ts                 # presign/confirm/list/delete
    │       ├── sync.ts                        # activity-block ingestion + reconciliation flags
    │       └── orgs.ts                        # org-wide settings (screenshot policy, idle, targets)
    └── prisma/
        ├── schema.prisma                  # CockroachDB schema
        ├── migrations/
        └── seed.ts
```

---

## Quick start

### Prerequisites

- Node.js 18+
- A CockroachDB (or PostgreSQL-compatible) database
- A Cloudflare R2 bucket (optional locally — screenshot upload is disabled gracefully without it)

### Install

```bash
cd web/frontend && npm install
cd ../backend && npm install
```

### Environment

Backend (`web/backend`, loads a repo-root `.env` in dev — see `src/env.ts` for the full Zod schema):

```bash
DATABASE_URL=postgresql://...            # CockroachDB connection string
JWT_SECRET=<32+ char random string>
PORT=3099                                 # matches the desktop/mobile dev default

# Screenshot storage (optional locally)
R2_ENDPOINT=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET_NAME=trax

# Mail (optional locally — falls back gracefully if unset)
SMTP_HOST=... SMTP_PORT=... SMTP_USER=... SMTP_PASSWORD=... SMTP_FROM=...
# Production only — Render can't send SMTP directly:
MAIL_RELAY_URL=https://app.traxstaff.com/api/mail/send
MAIL_RELAY_SECRET=<shared secret, also set on the frontend>

# Google sign-in (optional — the button falls back to email/password without it)
GOOGLE_CLIENT_ID=<same OAuth client id as the frontend>
```

Frontend (`web/frontend/.env.local`):

```bash
NEXT_PUBLIC_API_URL=http://localhost:3099
MAIL_RELAY_SECRET=<same shared secret as the backend>
NEXT_PUBLIC_GOOGLE_CLIENT_ID=<same OAuth client id as the backend>
```

### Google sign-in

"Continue with Google" signs **existing** members in; it never creates an
account or an organization. An address Google verifies has to already belong to
an active user — an unknown address, a pending invite, or a disabled account is
turned away with a message saying which.

Setup is one OAuth 2.0 **Web application** client in the Google Cloud console:

1. Add every origin the login page is served from to *Authorized JavaScript
   origins* (`http://localhost:3000`, `https://app.traxstaff.com`, and any
   preview domain). No redirect URI is needed — the browser gets an ID token,
   not a code.
2. Put that client id in **both** `GOOGLE_CLIENT_ID` (backend) and
   `NEXT_PUBLIC_GOOGLE_CLIENT_ID` (frontend). They are two halves of one check:
   the backend refuses any ID token whose `aud` isn't this client, which is what
   stops a token minted for some other Google app from signing anyone in.

Leave either unset and the page shows a plain "Continue with Google" button that
explains sign-in isn't configured, rather than a control that silently fails.
The button label is pinned to English (`?hl=en` on the Google script plus
`locale: "en"` on the button) — left to itself Google localises it to the
visitor's account language.

### CockroachDB migrations — read this before running any

This database uses CockroachDB's `schema_locked` table lock and the dev database has known drift from `schema.prisma` in a couple of places. **Do not run `prisma db push --accept-data-loss` blind.** The safe path:

```bash
cd web/backend
npx prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --script > /tmp/diff.sql
# inspect the script — confirm it touches only what you intend
npx prisma db execute --file /tmp/diff.sql --url "$DATABASE_URL"
```

Wrap the actual `ALTER TABLE` in `ALTER TABLE "<table>" SET (schema_locked = false);` / `... SET (schema_locked = true);` if CockroachDB rejects the DDL otherwise (it reports this explicitly).

### Run locally

```bash
cd web/backend && npm run dev      # http://localhost:3099
cd web/frontend && npm run dev     # http://localhost:3000
```

---

## Feature map

| Area | Status |
| --- | --- |
| Auth (login, invite/accept, forgot/reset password, self-service change-password) | ✅ |
| Self-only data scoping for every ordinary page, every role | ✅ |
| Members: invite, assign role, disable, remove (non-destructive), seat-unlimited | ✅ |
| Projects + tasks: create, assign members, per-task priority/status, progress rollup | ✅ |
| Reports: summary, timesheet, by-project, app usage, URL usage, CSV export | ✅ |
| Screenshots: capture policy config, admin-only viewable URLs, soft delete | ✅ |
| Insights: org-wide leaderboard/activity (admin-only) | ✅ |
| Settings: account (every role) + screenshots/tracking/targets/organisation (admin) | ✅ |
| Onboarding tour (resumable, every page) | 🔧 in progress |
| Marketing landing page (traxstaff.com apex, honest content, platform-aware download CTA) | ✅ |
| Download-app widget (GitHub Releases, OS-aware) | ✅ |
| Trax → TraxStaff rename (display copy only) | ✅ |

---

## Branching & release workflow

`main` is production, never pushed to directly:

```
dev ──▶ staging ──▶ main
```

- Desktop/mobile installers are built by [`.github/workflows/`](../.github/workflows/) (see that folder's own README) and published as GitHub Releases, which this app's download widgets read via `/api/releases/latest`.
- Vercel auto-deploys the frontend on every push (previews on non-`main`, production on `main`).
- Render auto-deploys the backend on push, and does not run outbound SMTP — see the mail-relay note above if you're touching `mailer.ts`.

## Scripts

**Frontend:**
```bash
npm run dev          # dev server
npm run build         # production build
npm run typecheck      # tsc --noEmit
```

**Backend:**
```bash
npm run dev              # tsx watch, local dev server
npm run build             # prisma generate + tsc
npm run prisma:migrate     # dev migration (local only — see the CockroachDB note above for prod)
npm run seed                # prisma/seed.ts
```

## License

© 2026 Wendiloveee Media. All rights reserved. Developed by WDC Solutions.
