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
