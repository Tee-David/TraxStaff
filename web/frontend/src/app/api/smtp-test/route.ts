import nodemailer from "nodemailer";
import { NextResponse } from "next/server";

// Temporary probe: confirms whether Vercel's serverless runtime can open an
// outbound SMTP connection at all, before betting the real mail relay on it.
// Removed once the answer is known either way.
export async function GET() {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 465);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASSWORD;

  if (!host || !user || !pass) {
    return NextResponse.json({ ok: false, error: "SMTP env vars not set on Vercel" }, { status: 500 });
  }

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
    connectionTimeout: 15000,
    greetingTimeout: 15000,
  });

  const started = Date.now();
  try {
    await transporter.verify();
    return NextResponse.json({ ok: true, ms: Date.now() - started });
  } catch (err) {
    return NextResponse.json(
      { ok: false, ms: Date.now() - started, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
