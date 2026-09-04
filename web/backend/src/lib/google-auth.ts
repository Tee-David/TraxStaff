/**
 * Verification for the ID token a Google sign-in hands us.
 *
 * The credential arrives from the browser, so every claim in it is attacker-
 * controlled until Google has vouched for the signature. Verification goes
 * through Google's own tokeninfo endpoint rather than a local JWKS check: it is
 * the smaller surface (no key cache to go stale, no algorithm confusion to get
 * wrong) and this runs once per sign-in, not per request.
 *
 * Endorsing the signature is not the same as endorsing the token. `aud` pins it
 * to *our* client — an ID token minted for any other Google app is a valid
 * Google token and must still be refused — and `email_verified` keeps someone
 * from claiming a colleague's address on a domain they never proved they own.
 */

const TOKENINFO_URL = "https://oauth2.googleapis.com/tokeninfo";

// Google mints both spellings, and has for years. Both are legitimate.
const ISSUERS = new Set(["accounts.google.com", "https://accounts.google.com"]);

export interface GoogleIdentity {
  /** Google's stable account id (`sub`). */
  googleId: string;
  email: string;
  name: string | null;
}

export class GoogleAuthError extends Error {}

/** Shape tokeninfo returns. Every field is a string, including the numeric ones. */
interface TokenInfo {
  aud?: string;
  iss?: string;
  sub?: string;
  exp?: string;
  email?: string;
  email_verified?: string | boolean;
  name?: string;
  error?: string;
  error_description?: string;
}

export interface VerifyOptions {
  clientId: string;
  /** Injectable for tests; defaults to the platform `fetch`. */
  fetchImpl?: typeof fetch;
  now?: number;
}

export async function verifyGoogleIdToken(
  credential: string,
  { clientId, fetchImpl = fetch, now = Date.now() }: VerifyOptions
): Promise<GoogleIdentity> {
  if (!credential.trim()) throw new GoogleAuthError("Missing Google credential");

  let res: Response;
  try {
    res = await fetchImpl(`${TOKENINFO_URL}?id_token=${encodeURIComponent(credential)}`);
  } catch (err) {
    throw new GoogleAuthError(
      `Could not reach Google to verify the sign-in: ${err instanceof Error ? err.message : String(err)}`
    );
  }
  if (!res.ok) throw new GoogleAuthError("Google rejected the sign-in token");

  let info: TokenInfo;
  try {
    info = (await res.json()) as TokenInfo;
  } catch {
    throw new GoogleAuthError("Google returned an unreadable response");
  }
  if (info.error) throw new GoogleAuthError("Google rejected the sign-in token");

  // A token issued for a different Google client is signed just as validly as
  // ours. Without this check anyone with any Google app could sign in as any
  // TraxStaff member whose email they know.
  if (info.aud !== clientId) throw new GoogleAuthError("Sign-in token was issued for a different app");
  if (!info.iss || !ISSUERS.has(info.iss)) throw new GoogleAuthError("Sign-in token came from an unexpected issuer");

  const expSeconds = Number(info.exp);
  if (!Number.isFinite(expSeconds) || expSeconds * 1000 <= now) {
    throw new GoogleAuthError("Sign-in token has expired");
  }

  // tokeninfo reports booleans as the strings "true"/"false".
  const verified = info.email_verified === true || info.email_verified === "true";
  if (!info.email || !verified) throw new GoogleAuthError("Google account has no verified email address");
  if (!info.sub) throw new GoogleAuthError("Sign-in token carries no account id");

  return { googleId: info.sub, email: info.email, name: info.name?.trim() || null };
}

/**
 * Why this account may not be signed into with Google — `null` if it may.
 *
 * Split out from the route because these four cases are the whole policy: only
 * an existing, active member gets a token — a Google login never creates an
 * account, never accepts a pending invite on the member's behalf, and never
 * revives a disabled one.
 *
 * Naming the address back is deliberate. The caller has just proved to Google
 * that they own that mailbox, so this leaks nothing they don't already know,
 * and it is the difference between "sign-in failed" and "you're signed in with
 * the wrong one of your two Google accounts".
 */
export function refuseGoogleSignIn(user: { status: string } | null, email: string): string | null {
  if (!user) {
    return `No TraxStaff account for ${email}. Sign in with the address you registered with, or ask an admin to invite this one.`;
  }
  if (user.status === "invited") {
    return `${email} still has an invite waiting — open the invite link in your email to finish setting up the account.`;
  }
  if (user.status !== "active") {
    return "This account has been disabled. Ask an owner or admin to re-enable it.";
  }
  return null;
}
