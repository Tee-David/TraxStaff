import nodemailer from "nodemailer";
import { env, smtpConfigured } from "../env";

const relayConfigured = Boolean(env.MAIL_RELAY_URL && env.MAIL_RELAY_SECRET);

// Direct SMTP still works locally (verified: Truehost accepts it from this
// machine in under a second) — kept as the dev-time path so testing mail
// doesn't require the relay to be reachable. Render itself blocks outbound
// SMTP entirely (confirmed: the identical call hangs there for ~120s and then
// fails), which is what the relay exists to route around.
const transporter = smtpConfigured
  ? nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_PORT === 465,
      auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    })
  : null;

/** Send via the Vercel relay. Throws on failure — the caller decides what a
 *  failure means (send() below turns it into `false`, never an exception). */
async function sendViaRelay(to: string, subject: string, html: string, text: string): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(`${env.MAIL_RELAY_URL}/api/mail/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-relay-secret": env.MAIL_RELAY_SECRET! },
      body: JSON.stringify({ to, subject, html, text }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`relay responded ${res.status}: ${body.slice(0, 200)}`);
    }
  } finally {
    clearTimeout(timeout);
  }
}

/* ─────────────────────────────  Templating  ─────────────────────────────

   Email HTML is its own world: table layout (flex/grid unsupported), inline
   styles (most clients strip <style>), 600px cap. Light/dark is best-effort —
   we declare `color-scheme`, default to light inline, and override via a
   prefers-color-scheme block for the clients that honour it (Apple Mail, iOS).
   Colours are the TraxStaff brand tokens: navy #000065, orange #FF6600.           */

const C = {
  navy: "#000065",
  brand: "#2a2ac4", // lifted navy — #000065 is near-black and unreadable as a link
  accent: "#FF6600",
  ink: "#0b0b1a",
  body: "#454a5c",
  muted: "#8a8fa6",
  hair: "#e6e7f0",
  tint: "#eeeef9",
  page: "#f4f5fb",
  card: "#ffffff",
};

// Email clients need absolute URLs and mostly can't render inline SVG, so the
// header uses a PNG served from the dashboard's public folder.
const ASSETS = (env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");

/**
 * Brand pill button. Deliberately a padded anchor with a unicode glyph, not an
 * image: Gmail strips inline SVG and most clients block remote images by default.
 */
function emailButton(href: string, label: string, icon: string): string {
  return `<a href="${href}" class="btn" style="display:inline-block;background:${C.navy};color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:13px 26px;border-radius:9999px;"><span style="display:inline-block;padding-right:8px;font-size:15px;line-height:1;">${icon}</span>${label}</a>`;
}

/** Full branded email document. `preheader` is the inbox preview snippet. */
function emailLayout(bodyHtml: string, preheader: string): string {
  const year = new Date().getFullYear();
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<style>
  a:not(.btn) { color:${C.brand}; }
  @media (prefers-color-scheme: dark) {
    .bg-page { background:#0a0a14 !important; }
    /* Footer must be the SAME surface as the card — a darker footer reads as a
       detached panel floating under the email. */
    .card, .foot { background:#15152a !important; }
    .card { border-color:#282844 !important; }
    .ink { color:#f0f1fa !important; }
    .body { color:#b8bad0 !important; }
    .muted { color:#8d90ab !important; }
    .hair { border-color:#282844 !important; }
    /* The unfilled half of a progress bar is a light hairline — on a dark card
       it reads as the *filled* portion unless it's darkened too. */
    .bar-track { background:#282844 !important; }
    /* Navy-on-navy is invisible: lift the detail card off the surface. */
    .tint { background:#1d1d3c !important; }
    /* The navy pill all but disappears on a dark card (and clients then
       auto-invert it to a washed-out lilac). Brighten it instead. */
    .btn { background:#4a4af0 !important; color:#ffffff !important; }
    /* Brand blue is unreadable on dark — lift links too, but never the button. */
    a:not(.btn) { color:#9a9aff !important; }
    /* The navy lockup vanishes on a dark card — swap to the white one. */
    .logo-light { display:none !important; }
    .logo-dark { display:block !important; }
  }
  @media (max-width:600px){ .card{ border-radius:0 !important; } .pad{ padding-left:24px !important; padding-right:24px !important; } }
</style>
</head>
<body class="bg-page" style="margin:0;padding:0;background:${C.page};">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${preheader}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="bg-page" style="background:${C.page};padding:28px 12px;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" class="card" style="width:600px;max-width:100%;background:${C.card};border:1px solid ${C.hair};border-radius:18px;overflow:hidden;">
        <!-- header: the real brand lockup, left-aligned. Two variants because a
             navy logo is invisible on a dark card. -->
        <tr><td align="left" class="pad" style="padding:34px 40px 16px;">
          <img src="${ASSETS}/brand/email-logo-navy.png" width="160" height="41" alt="TraxStaff" class="logo-light" style="display:block;border:0;outline:none;">
          <img src="${ASSETS}/brand/email-logo-white.png" width="160" height="41" alt="TraxStaff" class="logo-dark" style="display:none;border:0;outline:none;mso-hide:all;">
        </td></tr>
        <!-- body -->
        <tr><td class="ink pad" style="padding:22px 40px 36px;font-family:'Segoe UI',Arial,Helvetica,sans-serif;font-size:15px;line-height:1.65;color:${C.ink};">
          ${bodyHtml}
        </td></tr>
        <!-- footer: quiet, centred, generous -->
        <tr><td class="foot hair pad" align="center" style="padding:24px 40px 30px;border-top:1px solid ${C.hair};background:${C.card};">
          <p class="muted" style="margin:0 0 12px;font-size:12px;line-height:1.7;color:${C.muted};">
            TraxStaff · Time tracking &amp; productivity for your team
          </p>
          <p class="muted" style="margin:0;font-size:11px;line-height:1.6;color:${C.muted};">
            You received this because you have a TraxStaff account.<br>
            © ${year} TraxStaff. All rights reserved.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

/**
 * Returns whether the message actually went out. Sending never throws: callers
 * are HTTP handlers, and a dead SMTP host must not turn into a 500 — that would
 * both lose the work already committed and, on the reset route, reveal which
 * addresses have accounts. The link is logged on failure so it can be relayed
 * by hand.
 */
async function send(
  to: string,
  subject: string,
  html: string,
  text: string,
  logLabel: string
): Promise<boolean> {
  if (relayConfigured) {
    try {
      await sendViaRelay(to, subject, html, text);
      return true;
    } catch (err) {
      console.error(
        `[mailer] ${logLabel} to ${to} FAILED via relay: ${err instanceof Error ? err.message : err}. ${text}`
      );
      return false;
    }
  }

  if (!transporter) {
    // Neither the relay nor direct SMTP is configured — log the link so
    // development/testing isn't blocked.
    console.warn(`[mailer] mail not configured — ${logLabel} NOT sent to ${to}. ${text}`);
    return false;
  }
  try {
    await transporter.sendMail({ from: env.SMTP_FROM ?? env.SMTP_USER, to, subject, html, text });
    return true;
  } catch (err) {
    console.error(
      `[mailer] ${logLabel} to ${to} FAILED: ${err instanceof Error ? err.message : err}. ${text}`
    );
    return false;
  }
}

export async function sendInviteEmail(to: string, inviteUrl: string, orgName: string) {
  const html = emailLayout(
    `
    <p style="margin:0 0 6px;font-size:20px;font-weight:700;">You've been invited to ${orgName} 👋</p>
    <p class="body" style="margin:0 0 22px;color:${C.body};">Set your password to join the workspace on TraxStaff — track your time, see your activity, and keep your projects moving.</p>
    <p style="margin:0 0 24px;">${emailButton(inviteUrl, "Accept invite", "→")}</p>
    <p class="muted" style="margin:0 0 6px;font-size:13px;color:${C.muted};">Or paste this link into your browser:</p>
    <p style="margin:0 0 18px;font-size:12px;word-break:break-all;"><a href="${inviteUrl}" style="color:${C.brand};">${inviteUrl}</a></p>
    <p class="muted" style="margin:0;font-size:13px;color:${C.muted};">This link expires in 24 hours. If you weren't expecting this, you can ignore this email.</p>
  `,
    `Set your password to join ${orgName} on TraxStaff.`
  );

  return send(
    to,
    `You've been invited to join ${orgName} on TraxStaff`,
    html,
    `You've been invited to join ${orgName} on TraxStaff.\n\nAccept your invite: ${inviteUrl}\n\nThis link expires in 24 hours.`,
    "invite email"
  );
}

/* ──────────────────────  Work-target shortfall digests  ──────────────────────

   One digest per period, not one mail per person: at ten-ish staff a per-user
   mail turns a quiet week into twenty notifications and admins filter the lot.
   Tone is deliberately neutral — "below target", never "failed" — because the
   same number can mean annual leave, and an admin reading a shaming email about
   someone on holiday stops trusting the whole feature.                          */

export type ShortfallRow = {
  /** Display name if the member has set one, otherwise their email. */
  name: string;
  trackedHours: number;
  targetHours: number;
  /** Weekly digest only: how many working days they met the daily target on. */
  daysMet?: number;
  daysExpected?: number;
};

/** `6.4` → `"6h 24m"`. Whole hours drop the minutes: `8` → `"8h"`. */
function fmtHours(hours: number): string {
  const total = Math.max(0, Math.round(hours * 60));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/**
 * Per-member rows. A table, not divs: flex/grid don't exist in Outlook, and the
 * `width="N%"` *attribute* (not the CSS property) is the only bar-chart trick
 * that survives Word's rendering engine.
 */
function shortfallRows(rows: ShortfallRow[]): string {
  return rows
    .map((r) => {
      const short = Math.max(0, r.targetHours - r.trackedHours);
      const pct = r.targetHours > 0
        ? Math.min(100, Math.round((r.trackedHours / r.targetHours) * 100))
        : 0;
      const days =
        r.daysMet !== undefined && r.daysExpected !== undefined
          ? `<div class="muted" style="font-size:12px;line-height:1.5;color:${C.muted};padding-top:2px;">Met the daily target on ${r.daysMet} of ${r.daysExpected} days</div>`
          : "";
      // Zero-width bars collapse and the border-radius renders as a dot, so the
      // filled cell is omitted entirely at 0%.
      const bar = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:8px;"><tr>
        ${pct > 0 ? `<td width="${pct}%" class="bar-fill" style="background:${C.accent};height:4px;line-height:4px;font-size:0;border-radius:2px;">&nbsp;</td>` : ""}
        ${pct < 100 ? `<td width="${100 - pct}%" class="bar-track" style="background:${C.hair};height:4px;line-height:4px;font-size:0;border-radius:2px;">&nbsp;</td>` : ""}
      </tr></table>`;

      return `<tr>
        <td class="hair" style="padding:14px 0 12px;border-bottom:1px solid ${C.hair};">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
            <td style="font-family:'Segoe UI',Arial,Helvetica,sans-serif;font-size:15px;line-height:1.4;">
              <span class="ink" style="font-weight:600;color:${C.ink};">${r.name}</span>
              ${days}
            </td>
            <td align="right" style="font-family:'Segoe UI',Arial,Helvetica,sans-serif;font-size:15px;line-height:1.4;white-space:nowrap;padding-left:16px;">
              <span class="ink" style="font-weight:600;color:${C.ink};">${fmtHours(r.trackedHours)}</span><span class="muted" style="color:${C.muted};"> / ${fmtHours(r.targetHours)}</span>
              <div class="muted" style="font-size:12px;line-height:1.5;color:${C.muted};padding-top:2px;">${fmtHours(short)} short</div>
            </td>
          </tr></table>
          ${bar}
        </td>
      </tr>`;
    })
    .join("");
}

/** The "everyone hit target" case. Worth sending: silence is indistinguishable
 *  from a broken cron job, and admins asked to be told either way. */
function allClearBlock(scopeLabel: string, totalMembers: number): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="tint" style="background:${C.tint};border-radius:12px;margin:0 0 26px;">
    <tr><td class="pad-tint" style="padding:20px 24px;font-family:'Segoe UI',Arial,Helvetica,sans-serif;">
      <p class="ink" style="margin:0;font-size:15px;font-weight:600;color:${C.ink};">Everyone met their target ${scopeLabel}.</p>
      <p class="body" style="margin:6px 0 0;font-size:14px;color:${C.body};">All ${totalMembers} tracked members reached the work target. Nothing needs your attention.</p>
    </td></tr>
  </table>`;
}

type DigestInput = {
  orgName: string;
  rows: ShortfallRow[];
  /** Members counted, i.e. the denominator — excludes disabled/removed users. */
  totalMembers: number;
  dashboardUrl: string;
  targetHours: number;
};

export async function sendDailyShortfallEmail(
  to: string,
  input: DigestInput & { /** e.g. "Monday, 17 August" */ dateLabel: string }
) {
  const { orgName, rows, totalMembers, dashboardUrl, dateLabel, targetHours } = input;
  const n = rows.length;
  const subject =
    n === 0
      ? `All targets met — ${dateLabel}`
      : `${n} of ${totalMembers} below target — ${dateLabel}`;

  const html = emailLayout(
    `
    <p class="muted" style="margin:0 0 4px;font-size:13px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:${C.muted};">Daily summary · ${orgName}</p>
    <p style="margin:0 0 6px;font-size:20px;font-weight:700;">${dateLabel}</p>
    <p class="body" style="margin:0 0 24px;color:${C.body};">${
      n === 0
        ? `Daily target is ${fmtHours(targetHours)}.`
        : `${n} of ${totalMembers} tracked members finished below the ${fmtHours(targetHours)} daily target.`
    }</p>
    ${
      n === 0
        ? allClearBlock("yesterday", totalMembers)
        : `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 26px;border-collapse:collapse;">${shortfallRows(rows)}</table>`
    }
    <p style="margin:0 0 24px;">${emailButton(dashboardUrl, "Open dashboard", "→")}</p>
    <p class="muted" style="margin:0;font-size:13px;color:${C.muted};">Hours below target can mean leave, a public holiday, or approved time off — this is a prompt to look, not a verdict. Turn these off under Settings → Work targets.</p>
  `,
    n === 0
      ? `Everyone met the ${fmtHours(targetHours)} daily target on ${dateLabel}.`
      : `${rows.map((r) => r.name).join(", ")} finished below target on ${dateLabel}.`
  );

  const text =
    n === 0
      ? `${orgName} — ${dateLabel}\n\nAll ${totalMembers} tracked members met the ${fmtHours(targetHours)} daily target.\n\n${dashboardUrl}`
      : `${orgName} — ${dateLabel}\n\n${n} of ${totalMembers} tracked members were below the ${fmtHours(targetHours)} daily target:\n\n` +
        rows
          .map(
            (r) =>
              `  ${r.name}: ${fmtHours(r.trackedHours)} of ${fmtHours(r.targetHours)} (${fmtHours(Math.max(0, r.targetHours - r.trackedHours))} short)`
          )
          .join("\n") +
        `\n\nOpen dashboard: ${dashboardUrl}\n\nHours below target can mean leave or approved time off. Turn these off under Settings > Work targets.`;

  return send(to, subject, html, text, "daily shortfall digest");
}

export async function sendWeeklyShortfallEmail(
  to: string,
  input: DigestInput & { /** e.g. "11–17 August 2026" */ rangeLabel: string }
) {
  const { orgName, rows, totalMembers, dashboardUrl, rangeLabel, targetHours } = input;
  const n = rows.length;
  const subject =
    n === 0
      ? `All weekly targets met — week of ${rangeLabel}`
      : `${n} of ${totalMembers} below the weekly target — ${rangeLabel}`;

  const html = emailLayout(
    `
    <p class="muted" style="margin:0 0 4px;font-size:13px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:${C.muted};">Weekly summary · ${orgName}</p>
    <p style="margin:0 0 6px;font-size:20px;font-weight:700;">${rangeLabel}</p>
    <p class="body" style="margin:0 0 24px;color:${C.body};">${
      n === 0
        ? `Weekly target is ${fmtHours(targetHours)}.`
        : `${n} of ${totalMembers} tracked members finished the week below the ${fmtHours(targetHours)} target.`
    }</p>
    ${
      n === 0
        ? allClearBlock("last week", totalMembers)
        : `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 26px;border-collapse:collapse;">${shortfallRows(rows)}</table>`
    }
    <p style="margin:0 0 24px;">${emailButton(dashboardUrl, "Open reports", "→")}</p>
    <p class="muted" style="margin:0;font-size:13px;color:${C.muted};">A short week can mean leave, a public holiday, or approved time off. Turn these off under Settings → Work targets.</p>
  `,
    n === 0
      ? `Everyone met the ${fmtHours(targetHours)} weekly target for ${rangeLabel}.`
      : `${rows.map((r) => r.name).join(", ")} finished the week below target.`
  );

  const text =
    n === 0
      ? `${orgName} — week of ${rangeLabel}\n\nAll ${totalMembers} tracked members met the ${fmtHours(targetHours)} weekly target.\n\n${dashboardUrl}`
      : `${orgName} — week of ${rangeLabel}\n\n${n} of ${totalMembers} tracked members were below the ${fmtHours(targetHours)} weekly target:\n\n` +
        rows
          .map(
            (r) =>
              `  ${r.name}: ${fmtHours(r.trackedHours)} of ${fmtHours(r.targetHours)} (${fmtHours(Math.max(0, r.targetHours - r.trackedHours))} short)` +
              (r.daysMet !== undefined ? `, daily target met ${r.daysMet}/${r.daysExpected} days` : "")
          )
          .join("\n") +
        `\n\nOpen reports: ${dashboardUrl}\n\nA short week can mean leave or approved time off. Turn these off under Settings > Work targets.`;

  return send(to, subject, html, text, "weekly shortfall digest");
}

/* ────────────────────  Unusual-activity digest (admins)  ────────────────────

   These flags already existed as in-app notification rows, written by sync.ts
   behind `upsertFlag()`'s dedupe. Email is a second delivery of the same rows,
   batched over a period — never one mail per flag, which an offline backlog
   would turn into dozens at once.                                             */

/** Mirrors the frontend's FLAG_LABELS so both surfaces name a flag identically. */
const FLAG_LABELS: Record<string, string> = {
  sustained_high_activity: "Sustained high activity",
  low_variance_robotic: "Robotic / low-variance input",
  input_channel_imbalance: "Input channel imbalance",
  jiggler_process_detected: "Mouse-jiggler detected",
  clock_skew_detected: "System clock changed",
  exceeds_elapsed_cap: "Claimed more time than elapsed",
  block_outside_session_window: "Activity outside session window",
};

export type FlagRow = { member: string; type: string };

export async function sendUnusualActivityEmail(
  to: string,
  input: { orgName: string; rangeLabel: string; flags: FlagRow[]; dashboardUrl: string }
) {
  const { orgName, rangeLabel, flags, dashboardUrl } = input;
  const n = flags.length;
  const label = (type: string) => FLAG_LABELS[type] ?? type.replace(/_/g, " ");

  const rows = flags
    .map(
      (f) => `<tr>
        <td class="hair" style="padding:13px 0;border-bottom:1px solid ${C.hair};font-family:'Segoe UI',Arial,Helvetica,sans-serif;font-size:15px;line-height:1.45;">
          <span class="ink" style="font-weight:600;color:${C.ink};">${f.member}</span>
          <div class="muted" style="font-size:13px;line-height:1.5;color:${C.muted};padding-top:2px;">${label(f.type)}</div>
        </td>
      </tr>`
    )
    .join("");

  const html = emailLayout(
    `
    <p class="muted" style="margin:0 0 4px;font-size:13px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:${C.muted};">Unusual activity · ${orgName}</p>
    <p style="margin:0 0 6px;font-size:20px;font-weight:700;">${rangeLabel}</p>
    <p class="body" style="margin:0 0 24px;color:${C.body};">${n} ${n === 1 ? "session was" : "sessions were"} flagged for review.</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 26px;border-collapse:collapse;">${rows}</table>
    <p style="margin:0 0 24px;">${emailButton(dashboardUrl, "Review flags", "→")}</p>
    <p class="muted" style="margin:0;font-size:13px;color:${C.muted};">A flag is a signal to look, not proof of anything — several have innocent causes, such as a laptop resuming from sleep. Turn these off under Settings → Emails.</p>
  `,
    `${n} flagged ${n === 1 ? "session" : "sessions"} for ${rangeLabel}.`
  );

  const text =
    `${orgName} — ${rangeLabel}\n\n${n} flagged ${n === 1 ? "session" : "sessions"}:\n\n` +
    flags.map((f) => `  ${f.member}: ${label(f.type)}`).join("\n") +
    `\n\nReview: ${dashboardUrl}\n\nA flag is a signal to look, not proof. Turn these off under Settings > Emails.`;

  return send(
    to,
    `${n} flagged ${n === 1 ? "session" : "sessions"} — ${rangeLabel}`,
    html,
    text,
    "unusual activity digest"
  );
}

/* ──────────────────  Member's own weekly summary (staff)  ──────────────────

   The reciprocal of the admin digest: the same numbers, sent to the person they
   are about. Nobody in this category ships it, and it is what turns the
   shortfall digest from surveillance into something the member can act on
   before an admin ever raises it.                                             */

export async function sendMemberWeeklySummaryEmail(
  to: string,
  input: {
    orgName: string;
    rangeLabel: string;
    name: string;
    trackedHours: number;
    targetHours: number;
    dashboardUrl: string;
  }
) {
  const { orgName, rangeLabel, name, trackedHours, targetHours, dashboardUrl } = input;
  const met = targetHours <= 0 || trackedHours >= targetHours;
  const short = Math.max(0, targetHours - trackedHours);
  const pct = targetHours > 0 ? Math.min(100, Math.round((trackedHours / targetHours) * 100)) : 100;

  const html = emailLayout(
    `
    <p class="muted" style="margin:0 0 4px;font-size:13px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:${C.muted};">Your week · ${orgName}</p>
    <p style="margin:0 0 6px;font-size:20px;font-weight:700;">${rangeLabel}</p>
    <p class="body" style="margin:0 0 22px;color:${C.body};">Hi ${name} — here is what TraxStaff recorded for you last week.</p>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="tint" style="background:${C.tint};border-radius:12px;margin:0 0 26px;">
      <tr><td style="padding:22px 24px;font-family:'Segoe UI',Arial,Helvetica,sans-serif;">
        <p class="ink" style="margin:0;font-size:28px;font-weight:700;line-height:1.2;color:${C.ink};">${fmtHours(trackedHours)}</p>
        <p class="muted" style="margin:4px 0 0;font-size:14px;color:${C.muted};">tracked of a ${fmtHours(targetHours)} target${met ? "" : ` · ${fmtHours(short)} short`}</p>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:14px;"><tr>
          ${pct > 0 ? `<td width="${pct}%" class="bar-fill" style="background:${C.accent};height:6px;line-height:6px;font-size:0;border-radius:3px;">&nbsp;</td>` : ""}
          ${pct < 100 ? `<td width="${100 - pct}%" class="bar-track" style="background:${C.hair};height:6px;line-height:6px;font-size:0;border-radius:3px;">&nbsp;</td>` : ""}
        </tr></table>
      </td></tr>
    </table>

    <p class="body" style="margin:0 0 24px;color:${C.body};">${
      met
        ? "You met your target — nothing to do."
        : "If that looks wrong, check for time that never synced, or add any missing entries from your timesheet."
    }</p>
    <p style="margin:0 0 24px;">${emailButton(dashboardUrl, "View your timesheet", "→")}</p>
    <p class="muted" style="margin:0;font-size:13px;color:${C.muted};">This is the same figure your admins see for you — no more, no less.</p>
  `,
    `${fmtHours(trackedHours)} tracked of a ${fmtHours(targetHours)} target for ${rangeLabel}.`
  );

  const text =
    `${orgName} — your week, ${rangeLabel}\n\n` +
    `Tracked: ${fmtHours(trackedHours)} of a ${fmtHours(targetHours)} target` +
    (met ? " — target met.\n" : ` (${fmtHours(short)} short).\n`) +
    `\nView your timesheet: ${dashboardUrl}\n\nThis is the same figure your admins see for you.`;

  return send(to, `Your week at ${orgName} — ${rangeLabel}`, html, text, "member weekly summary");
}

export async function sendPasswordResetEmail(to: string, resetUrl: string) {
  const html = emailLayout(
    `
    <p style="margin:0 0 6px;font-size:20px;font-weight:700;">Reset your password</p>
    <p class="body" style="margin:0 0 22px;color:${C.body};">We received a request to reset your TraxStaff password. Choose a new one below — the link expires in 1 hour.</p>
    <p style="margin:0 0 24px;">${emailButton(resetUrl, "Reset password", "→")}</p>
    <p class="muted" style="margin:0 0 6px;font-size:13px;color:${C.muted};">Or paste this link into your browser:</p>
    <p style="margin:0 0 18px;font-size:12px;word-break:break-all;"><a href="${resetUrl}" style="color:${C.brand};">${resetUrl}</a></p>
    <p class="muted" style="margin:0;font-size:13px;color:${C.muted};">If you didn't request this, you can safely ignore this email — your password won't change.</p>
  `,
    "Reset your TraxStaff password (link expires in 1 hour)."
  );

  return send(
    to,
    "Reset your TraxStaff password",
    html,
    `Someone asked to reset the password for your TraxStaff account.\n\nReset it here: ${resetUrl}\n\nThis link expires in 1 hour. If this wasn't you, ignore this email — your password stays unchanged.`,
    "reset email"
  );
}

/* ───────────────────────  Manual-time approval mail  ───────────────────────

   Three templates, all reusing `emailLayout` so they inherit the dark-mode and
   client-compatibility work above. Each one leads with the fact and the
   numbers, because the decision they support is "does this look right?" and the
   answer is in the who/when/how-long — not in the prose.

   Every one of these is opt-out per recipient (lib/email-prefs.ts), so the
   footer says which setting produced it and where to change it.                */

const TIMESHEETS_URL = `${ASSETS}/app/timesheets`;
const SETTINGS_URL = `${ASSETS}/app/settings`;

/** Shared "why am I getting this" line — every preference-governed email ends with it. */
function prefsFooter(what: string): string {
  return `<p class="muted" style="margin:22px 0 0;font-size:12px;color:${C.muted};">You're getting this because ${what} is on for your account. <a href="${SETTINGS_URL}" style="color:${C.brand};">Change your email preferences</a>.</p>`;
}

/** Detail card — the facts of the entry, laid out as rows an eye can scan. */
function detailRows(rows: [string, string][]): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="tint" style="background:${C.tint};border-radius:12px;padding:4px 0;margin:0 0 24px;">
    ${rows
      .map(
        ([label, value]) =>
          `<tr><td class="muted" style="padding:8px 18px;font-size:13px;color:${C.muted};width:38%;">${label}</td><td class="ink" style="padding:8px 18px;font-size:14px;font-weight:600;color:${C.ink};">${value}</td></tr>`
      )
      .join("")}
  </table>`;
}

export interface ManualEntryFacts {
  memberLabel: string;
  projectName: string;
  taskTitle?: string | null;
  when: string;
  duration: string;
  reason: string;
}

/** To the admins who review time: someone added an entry the tracker didn't see. */
export async function sendManualTimeSubmittedEmail(to: string, facts: ManualEntryFacts) {
  const rows: [string, string][] = [
    ["Member", facts.memberLabel],
    ["Project", facts.taskTitle ? `${facts.projectName} — ${facts.taskTitle}` : facts.projectName],
    ["When", facts.when],
    ["Duration", facts.duration],
    ["Reason", facts.reason],
  ];
  const html = emailLayout(
    `
    <p style="margin:0 0 6px;font-size:20px;font-weight:700;">Manual time needs your approval</p>
    <p class="body" style="margin:0 0 22px;color:${C.body};">${facts.memberLabel} added ${facts.duration} the tracker didn't record. It won't count as approved time until an admin reviews it.</p>
    ${detailRows(rows)}
    <p style="margin:0 0 8px;">${emailButton(TIMESHEETS_URL, "Review this entry", "→")}</p>
    ${prefsFooter("&ldquo;Manual time awaiting approval&rdquo;")}
  `,
    `${facts.memberLabel} added ${facts.duration} of manual time — awaiting approval.`
  );

  return send(
    to,
    `${facts.memberLabel} added ${facts.duration} of manual time`,
    html,
    `${facts.memberLabel} added manual time awaiting approval.\n\nProject: ${facts.projectName}\nWhen: ${facts.when}\nDuration: ${facts.duration}\nReason: ${facts.reason}\n\nReview it: ${TIMESHEETS_URL}`,
    "manual time submitted email"
  );
}

/** To the member: an admin has decided. A rejection always carries its reason. */
export async function sendManualTimeDecisionEmail(
  to: string,
  decision: "approved" | "rejected",
  facts: ManualEntryFacts & { decidedBy: string; note?: string | null }
) {
  const approved = decision === "approved";
  const rows: [string, string][] = [
    ["Project", facts.taskTitle ? `${facts.projectName} — ${facts.taskTitle}` : facts.projectName],
    ["When", facts.when],
    ["Duration", facts.duration],
    ["Reviewed by", facts.decidedBy],
  ];
  if (facts.note) rows.push([approved ? "Note" : "Reason", facts.note]);

  const lead = approved
    ? `Your ${facts.duration} entry has been approved and counts toward your timesheet.`
    : `Your ${facts.duration} entry was rejected, so it won't count toward your timesheet. The entry stays on your timesheet marked as rejected — nothing was deleted.`;

  const html = emailLayout(
    `
    <p style="margin:0 0 6px;font-size:20px;font-weight:700;">Manual time ${approved ? "approved" : "rejected"}</p>
    <p class="body" style="margin:0 0 22px;color:${C.body};">${lead}</p>
    ${detailRows(rows)}
    <p style="margin:0 0 8px;">${emailButton(TIMESHEETS_URL, "Open your timesheet", "→")}</p>
    ${prefsFooter("&ldquo;Your manual time was reviewed&rdquo;")}
  `,
    lead
  );

  return send(
    to,
    `Your manual time was ${approved ? "approved" : "rejected"}`,
    html,
    `${lead}\n\nProject: ${facts.projectName}\nWhen: ${facts.when}\nDuration: ${facts.duration}\nReviewed by: ${facts.decidedBy}${facts.note ? `\nNote: ${facts.note}` : ""}\n\n${TIMESHEETS_URL}`,
    "manual time decision email"
  );
}

/**
 * To the member: an admin put time on their timesheet for them.
 *
 * A separate template from the decision one on purpose. "Your entry has been
 * approved" is the wrong sentence for time the member never submitted, and
 * getting that wrong in an email about someone's paid hours is not a small
 * thing — the point of telling them at all is that they can dispute it.
 */
export async function sendManualTimeAddedEmail(
  to: string,
  facts: ManualEntryFacts & { addedBy: string }
) {
  const rows: [string, string][] = [
    ["Project", facts.taskTitle ? `${facts.projectName} — ${facts.taskTitle}` : facts.projectName],
    ["When", facts.when],
    ["Duration", facts.duration],
    ["Added by", facts.addedBy],
    ["Reason", facts.reason],
  ];
  const lead = `${facts.addedBy} added ${facts.duration} to your timesheet. It counts as approved time. If that doesn't look right, take it up with them — nothing here is hidden from you.`;

  const html = emailLayout(
    `
    <p style="margin:0 0 6px;font-size:20px;font-weight:700;">Time was added to your timesheet</p>
    <p class="body" style="margin:0 0 22px;color:${C.body};">${lead}</p>
    ${detailRows(rows)}
    <p style="margin:0 0 8px;">${emailButton(TIMESHEETS_URL, "Open your timesheet", "→")}</p>
    ${prefsFooter("&ldquo;Your manual time was reviewed&rdquo;")}
  `,
    lead
  );

  return send(
    to,
    `${facts.addedBy} added ${facts.duration} to your timesheet`,
    html,
    `${lead}\n\nProject: ${facts.projectName}\nWhen: ${facts.when}\nDuration: ${facts.duration}\nReason: ${facts.reason}\n\n${TIMESHEETS_URL}`,
    "manual time added email"
  );
}

