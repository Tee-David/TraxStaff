import nodemailer from "nodemailer";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { SUPPORT_EMAIL } from "@/lib/site";

/**
 * Newsletter sign-ups from the footer.
 *
 * There is no mailing-list service wired up, so rather than pretend one exists
 * (a form that quietly drops the address is worse than no form), this mails the
 * address to the support inbox over the same SMTP credentials the rest of the
 * app sends with. Someone has to move it onto a real list by hand — that's the
 * honest state of it today, and the swap later is this file only.
 *
 * The address is never stored here, and nothing is sent *to* the subscriber:
 * a confirmation mail from an unauthenticated endpoint is a way to have this
 * server send mail to strangers on request.
 */
const bodySchema = z.object({
  email: z.string().trim().email().max(320),
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

export async function POST(req: NextRequest) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "That doesn't look like an email address." }, { status: 400 });
  }
  const { email } = parsed.data;

  if (!transporter) {
    // Say so rather than returning a cheerful 200 the visitor can't act on.
    return NextResponse.json(
      { error: "Sign-up isn't available right now — please email us instead." },
      { status: 503 }
    );
  }

  try {
    await transporter.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: SUPPORT_EMAIL,
      replyTo: email,
      subject: `Newsletter sign-up: ${email}`,
      text: `${email} asked for product updates from the traxstaff.com footer.`,
      html: `<p><strong>${email}</strong> asked for product updates from the traxstaff.com footer.</p>`,
    });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json(
      { error: "Something went wrong sending that — please email us instead." },
      { status: 502 }
    );
  }
}
