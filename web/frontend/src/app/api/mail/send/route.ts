import nodemailer from "nodemailer";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

/**
 * SMTP relay. Render's network blocks outbound connections on 465 and 587
 * (confirmed: the same nodemailer call that succeeds in under a second here
 * hangs on Render for ~120s and then fails) — so the backend cannot reach
 * Truehost directly. This route runs on Vercel, which has no such block, and
 * does the actual SMTP send on the backend's behalf over a plain HTTPS call.
 *
 * This is still "SMTP via nodemailer using the org's own webmail credentials" —
 * Truehost is still the literal transport, and no third-party email service
 * (SendGrid/Mailgun/etc.) is involved. Only where the SMTP connection is
 * physically opened from has changed.
 *
 * Gated by a shared secret rather than left open, since an unauthenticated
 * relay that sends arbitrary mail from this domain is a spam vector.
 */
const bodySchema = z.object({
  to: z.string().email(),
  subject: z.string().min(1).max(300),
  html: z.string().min(1),
  text: z.string().min(1),
});

const port = Number(process.env.SMTP_PORT || 465);
const transporter =
  process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASSWORD
    ? nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port,
        secure: port === 465,
        auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD },
        connectionTimeout: 15_000,
        greetingTimeout: 15_000,
      })
    : null;

/**
 * The `From` header, display name included.
 *
 * The bare `process.env.SMTP_USER` fallback this replaces is why sent mail
 * showed up as "info" in every inbox: with no display name, clients fall back to
 * the local part of the address. The brand name is defaulted in code rather than
 * left to `SMTP_FROM` alone so that a missing env var — which is exactly what
 * happened on this deployment — degrades to the right name instead of a wrong
 * one.
 */
function fromAddress(): string | undefined {
  if (process.env.SMTP_FROM) return process.env.SMTP_FROM;
  const user = process.env.SMTP_USER;
  return user ? `TraxStaff <${user}>` : undefined;
}

export async function POST(req: NextRequest) {
  const secret = process.env.MAIL_RELAY_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "Relay not configured" }, { status: 503 });
  }
  if (req.headers.get("x-relay-secret") !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!transporter) {
    return NextResponse.json({ error: "SMTP not configured" }, { status: 503 });
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body", details: parsed.error.issues }, { status: 400 });
  }
  const { to, subject, html, text } = parsed.data;

  try {
    await transporter.sendMail({ from: fromAddress(), to, subject, html, text });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Send failed" },
      { status: 502 }
    );
  }
}
