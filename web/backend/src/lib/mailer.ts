import nodemailer from "nodemailer";
import { env, smtpConfigured } from "../env";

const transporter = smtpConfigured
  ? nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_PORT === 465,
      auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD },
    })
  : null;

export async function sendInviteEmail(to: string, inviteUrl: string, orgName: string) {
  const subject = `You've been invited to join ${orgName} on Trax`;
  const text = `You've been invited to join ${orgName} on Trax.\n\nAccept your invite: ${inviteUrl}\n\nThis link expires in 7 days.`;

  if (!transporter) {
    // SMTP not configured yet — log the invite link so development/testing isn't blocked.
    console.warn(
      `[mailer] SMTP not configured — invite email NOT sent. Link for ${to}: ${inviteUrl}`
    );
    return;
  }

  await transporter.sendMail({
    from: env.SMTP_FROM ?? env.SMTP_USER,
    to,
    subject,
    text,
  });
}
