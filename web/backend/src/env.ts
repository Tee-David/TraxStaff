import { config } from "dotenv";
import { resolve } from "node:path";
// Load from repo root .env in dev. On Render, env vars are injected directly
// so a missing file here is a silent no-op — which is exactly what we want.
config({ path: resolve(__dirname, "../../../.env") });
import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(16),
  PORT: z.coerce.number().default(3001),
  NEXT_PUBLIC_APP_URL: z.string().url().optional(),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_FROM: z.string().optional(),
  // HTTPS relay used in production: Render blocks outbound SMTP, so mail is
  // physically sent from the Vercel deployment instead (see lib/mailer.ts).
  MAIL_RELAY_URL: z.string().url().optional(),
  MAIL_RELAY_SECRET: z.string().optional(),
  // OAuth client id(s) accepted by "Sign in with Google". Comma-separated so
  // the desktop and mobile apps can be added alongside the web client later.
  // Only the *id* — the ID-token flow needs no client secret (see lib/google.ts).
  // Unset simply means Google sign-in is off; POST /auth/google then 503s and
  // the login page hides the button.
  GOOGLE_CLIENT_ID: z.string().optional(),
  // Comma-separated addresses that are platform super admins. Only the
  // bootstrap: the first super admin cannot be granted through an API that
  // requires one. See lib/superadmin.ts.
  SUPERADMIN_EMAILS: z.string().optional(),
});

export const env = envSchema.parse(process.env);

export const smtpConfigured = Boolean(
  env.SMTP_HOST && env.SMTP_PORT && env.SMTP_USER && env.SMTP_PASSWORD
);
