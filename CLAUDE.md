# CLAUDE.md — Trax

Guidance for Claude when working in this repository.

## What this is

**Trax** — an internal time-tracking / productivity tool for a team under 10
people. A trimmed-down Hubstaff: time tracking, screenshots, activity %,
app/URL usage, projects/tasks, reports, team management — with everything
billing-related (invoices, budgets, pay rates, expenses, payments)
deliberately cut. Ships as a Windows desktop executable (Tauri) plus admin +
staff web dashboards.

- Vercel project: frontend, both admin + staff dashboards (auto-deploys `main`)
- Backend deploys to **Render** (free Web Service tier — see cost guardrails below)
- Database: **CockroachDB** Serverless (free tier)
- Screenshot storage: **Cloudflare R2** (`trax-screenshots` bucket, 30-day retention)
- Secrets: **Doppler** project `trax` (dev/stg/prd configs, synced from root `.env`)
- Repo: GitHub `trax`
- Full product spec: `plans/PRD.md`
- Build checklist (living doc, check off / add to as you go): `plans/checklist.md`
- Approved architecture plan: `~/.claude/plans/alright-so-i-want-steady-donut.md`

## Monorepo layout

```
trax/
├── web/
│   ├── frontend/     Next.js App Router (TS, Tailwind, shadcn/ui) — admin + staff
│   │                 dashboards, role-gated route groups (admin)/ (staff)/ — Vercel
│   └── backend/      Node + TS API (Fastify, Prisma/CockroachDB) — Render
├── desktop/          Tauri v2 + React/TS tracker app — Windows exe (Linux later)
├── plans/            PRD.md, checklist.md, reference screenshots — GITIGNORED, never commit
└── .env              Root secrets (gitignored, synced to Doppler)
```

## Conventions

- **Backend stack:** Node + TypeScript, Fastify, Prisma against CockroachDB
  (UUID primary keys, not serial — needed for distributed writes). SMTP via
  `nodemailer` using the user's own webmail credentials for invite emails
  (no third-party email service). In-process `node-cron` for nightly 30-day
  screenshot retention cleanup — do not add a separate Render Cron/Worker
  service for this.
- **CockroachDB cert (ALWAYS use it):** the connection uses
  `sslmode=verify-full`, which requires the cluster CA cert at
  `web/backend/root.crt`. The runtime Prisma client auto-appends
  `sslrootcert=…/root.crt` (see `src/lib/prisma.ts`). For any Prisma **CLI**
  command (`db push`, `migrate`, `seed`) always ensure the cert is used — e.g.
  export `PGSSLROOTCERT=$PWD/root.crt` (run from `web/backend`) or append
  `&sslrootcert=./root.crt` to `DATABASE_URL`. Never switch to
  `sslmode=require`/`disable` to dodge the cert. (Transient P1001 "can't reach"
  errors from a dev box are usually network flakiness — retry.)
- **Frontend stack:** Next.js App Router, TypeScript, Tailwind, shadcn/ui,
  recharts for activity/timeline charts. **Brand:** primary deep royal blue
  `#000065`, secondary orange `#FF6600` (same palette as the `wdc` project).
  Fonts: **Space Grotesk** (headings/large text), **Outfit** (body/secondary
  text), both via `next/font/google`. Visual direction otherwise: clean
  minimal SaaS look, rounded cards with soft shadows, timer-centric hero UI,
  tooltip-rich charts with categorical breakdowns — pulled from
  `plans/trax-screenshots/` (Dipa Inhouse dashboard + timebite widget
  references). Confirm any major visual direction change with the user
  before committing to it — more UI references may still be supplied.
- **Desktop stack:** Tauri v2, Rust core + React/TS webview. XCap for
  all-monitor screenshot capture (X11/Wayland/Windows/macOS). rdev for
  global keyboard/mouse *timing* sampling — activity intensity only, never
  keystroke content; this is not a keylogger and must never be treated as
  one. SQLCipher-backed local queue for offline-first sync. Tauri's built-in
  updater plugin for auto-update. Always-visible system tray + running
  timer — no silent/stealth tracking mode, ever (explicit product decision).
- **Anti-tamper mechanics** (see `plans/PRD.md` §4.4 for full detail):
  server-anchored session start + monotonic local clock (never trust client
  wall-clock for duration), per-session sequence number + hash chain on
  locally-queued records, server-side Unusual Activity detection
  (sustained ≥95% activity for ≥30min, ≤4% variance over 90min, input-channel
  imbalance ≥50min), client-side mouse-jiggler process blocklist. Tamper
  signals flag a session for review — they never silently block ingestion.
- **Cost guardrails:** Render backend stays on the **free** Web Service tier
  — no extra paid services. It's expected to cold-start after ~15min
  idle; the offline-first sync design already tolerates this via retry with
  backoff, so don't add a keep-alive ping (it would just burn free-tier
  hours). Watch CockroachDB Serverless's free Request Unit budget and R2's
  free storage/egress tier as the other places usage could accrue cost.

## Working principles (from installed skills — apply on every change)

Distilled from the `karpathy-guidelines`, `rust-best-practices`, `tauri`/`tauri-v2`,
and `frontend-design` skills in `.claude/skills/`. Invoke the full skill when a task
lands squarely in its domain; these are the always-on essentials.

- **Simplicity first.** Minimum code that solves the problem — no speculative
  abstractions, config, or error handling for impossible cases. If 200 lines
  could be 50, rewrite it.
- **Surgical changes.** Touch only what the request needs; match existing style;
  don't refactor or reformat adjacent code. Remove only the orphans *your* change
  created; flag pre-existing dead code rather than deleting it.
- **Think before coding.** State assumptions; if multiple interpretations exist,
  surface them instead of silently picking; push back when a simpler path exists.
- **Goal-driven.** Turn each task into a verifiable success criterion and loop
  until it's met ("add validation" → "write tests for bad input, make them pass").
- **Rust (desktop core):** prefer borrowing over cloning; `Result` + `thiserror`
  for library errors, `anyhow` at the app edge; no `.unwrap()`/`.expect()` on
  paths that can fail at runtime; keep `cargo clippy` clean.
- **Tauri (HIGH-RISK surface):** scope capabilities/permissions as narrowly as
  possible in `capabilities/*.json`; every `#[tauri::command]` must be registered
  in `generate_handler!`; validate all IPC input; strict CSP; never expose the
  full filesystem/shell. The input sampler captures intensity/timings only —
  never keystroke content.
- **Frontend design:** deliberate, non-templated UI — the timer is the hero;
  typography (Space Grotesk / Outfit) and structure should carry meaning, not
  decorate. Animate only transform/opacity; respect `prefers-reduced-motion`.

## Seeded test accounts (dev DB only)

Org **"Trax Test Org"**, all password `password123`. Re-seed anytime with
`cd web/backend && npm run seed` (idempotent upsert). These are throwaway dev
credentials on the CockroachDB dev cluster — rotate/remove before any real
production use.

| Role   | Email             | Password      |
| ------ | ----------------- | ------------- |
| owner  | admin@trax.test   | password123   |
| member | staff1@trax.test  | password123   |
| member | staff2@trax.test  | password123   |

## Branching & deployment workflow (MANDATORY — check before every push)

```
dev ──▶ staging ──▶ main
(build)  (rehearse)  (production)
```

Three branches only — no feature branches.

- **`dev`** — default working branch; all day-to-day work and pushes happen here.
- **`staging`** — dress rehearsal, promoted from `dev`.
- **`main`** — production; auto-deploys via Vercel (frontend) and Render
  (backend). Never promote to `main` on your own initiative. But when the
  user explicitly asks to push/promote to `main` ("push", "make it live",
  "ship to prod"), that ask IS your authorization — do it (fast-forward
  `dev`→`staging`→`main`, push, tag `vX.Y.Z` patch-bump).

**Rules for Claude:**
1. **Check the current branch before every push** (`git branch --show-current`); default to `dev`.
2. Type-check before every push: `cd web/frontend && npx tsc --noEmit` and `cd web/backend && npx tsc --noEmit`.
3. Review URLs: `main` → production; `dev`/`staging` → per-push Vercel preview URLs. One Vercel project only — do not create extra projects for branches.

## Working style

- Push work to `dev` in stages after each part; the user reviews on the Vercel preview / Render logs. Production releases only via the workflow above.
- Tokens in `.env`: `GITHUB_PAT` (gh/git pushes + GitHub API), `VERCEL_TOKEN` (Vercel API/CLI), `RENDER_TOKEN` (Render API). Secrets live in **Doppler** (project `trax`, configs `dev`/`stg`/`prd`) and are synced from `.env`. Never commit `.env` or secrets.
- The `plans/` folder is gitignored and contains working docs + reference screenshots — never commit it, never remove it without checking with the user first (it holds source material this project's scope was derived from).

## Commands

```bash
cd web/frontend && npm run dev          # frontend dev server
cd web/frontend && npx tsc --noEmit     # frontend type-check (do before pushing)
cd web/backend && npm run dev           # backend dev server
cd web/backend && npx tsc --noEmit      # backend type-check (do before pushing)
cd desktop && npm run tauri dev         # desktop app dev
```

Never add "Co-Authored-By" lines (Claude, Anthropic, or any AI attribution) to git commits.
Always call me Tee-David in your responses.