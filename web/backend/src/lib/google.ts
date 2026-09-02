import { OAuth2Client } from "google-auth-library";
import type { UserStatus } from "@prisma/client";
import { env } from "../env";

/**
 * Sign in with Google, using the *ID token* flow rather than an OAuth
 * authorization-code redirect.
 *
 * Google Identity Services hands the browser a signed ID token (a JWT) the
 * moment the user picks an account. We post that one string to the backend,
 * verify its signature against Google's public keys, and mint an ordinary Trax
 * JWT from it. That means:
 *
 *   - no client *secret* anywhere — the ID token is verified with Google's
 *     published keys, so there is no confidential credential to leak or rotate;
 *   - no redirect/callback route, no `state` cookie, no server-side session
 *     store to hold a half-finished login;
 *   - the result is the same token every other client already carries, so the
 *     desktop app, the sliding renewal in /auth/me and the acting-org header all
 *     keep working untouched.
 *
 * The audience list is what binds a token to *us*: Google will happily sign an
 * ID token for any application, and one issued to somebody else's client is not
 * a login here. `verifyIdToken` rejects a mismatched `aud`, which is the whole
 * reason GOOGLE_CLIENT_ID has to be set server-side and not just in the browser.
 */

/**
 * Every OAuth client id allowed to produce a token we accept — comma-separated
 * so the desktop and mobile apps can be added later without a code change; each
 * platform gets its own client id in the Google console but signs into the same
 * accounts.
 */
export const GOOGLE_AUDIENCES: string[] = (env.GOOGLE_CLIENT_ID ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

export const googleAuthConfigured = GOOGLE_AUDIENCES.length > 0;

// Google rotates its signing keys; the client caches the key set internally and
// refetches on a `kid` it has not seen, so one long-lived instance is correct.
const client = new OAuth2Client();

export interface GoogleIdentity {
  /** Google's stable account id. Not a Trax user id. */
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string | null;
}

/**
 * Verify a Google ID token and pull out the identity it asserts.
 *
 * Returns null for anything that does not verify — a forged or expired token, a
 * token minted for a different application, or one carrying no email claim.
 * Callers must treat null as "not signed in" and say nothing more specific than
 * that to the browser.
 */
export async function verifyGoogleIdToken(credential: string): Promise<GoogleIdentity | null> {
  if (!googleAuthConfigured) return null;

  let payload;
  try {
    const ticket = await client.verifyIdToken({ idToken: credential, audience: GOOGLE_AUDIENCES });
    payload = ticket.getPayload();
  } catch {
    // Bad signature, expired, wrong audience, unreachable key set — all of them
    // mean the same thing to the caller, and none of them are worth telling a
    // caller apart from one another.
    return null;
  }

  if (!payload?.sub || !payload.email) return null;

  return {
    sub: payload.sub,
    email: payload.email.toLowerCase(),
    emailVerified: payload.email_verified === true,
    name: payload.name ?? null,
  };
}

/**
 * What signing in with a verified Google address should do to a given account.
 *
 * Split out from the route so the rule is testable without a database, and so
 * the one genuinely subtle case — an invited member who has never set a
 * password — is written down in one place rather than inferred from control
 * flow.
 */
export type GoogleSignInVerdict =
  | { kind: "sign-in" }
  | { kind: "accept-invite" }
  | { kind: "suspended" }
  | { kind: "no-account" };

export function resolveGoogleSignIn(input: {
  /** The matching User row, or null when no account holds this address. */
  user: { status: UserStatus; isSuperAdmin: boolean; orgStatus: string } | null;
  /** Whether an unexpired, unaccepted invite exists for this address. */
  hasLiveInvite: boolean;
}): GoogleSignInVerdict {
  const { user, hasLiveInvite } = input;

  // Google sign-in never *creates* an account. Trax is invite-only on the web —
  // there is no self-serve signup page — so an address nobody has invited has no
  // org to belong to, and silently minting one would let anyone with a Google
  // account manufacture a workspace from the login screen.
  if (!user) return { kind: "no-account" };

  if (user.status === "invited") {
    // An invited member has a row but no password, and their invite link is the
    // only thing that has ever proved they own the mailbox. Google proves
    // exactly the same fact — better, in fact, since the link can be forwarded
    // and a Google session cannot. So we let it complete the invite, but only
    // while the invite is still live: the 24-hour TTL exists so a stale invite
    // in a breached inbox stops working, and honouring an expired one through
    // this door would quietly repeal that.
    return hasLiveInvite ? { kind: "accept-invite" } : { kind: "no-account" };
  }

  // Disabled or removed. Deliberately indistinguishable from "no account" to the
  // browser — see the route.
  if (user.status !== "active") return { kind: "no-account" };

  // Same carve-out as password login: someone has to be able to un-suspend it.
  if (user.orgStatus === "suspended" && !user.isSuperAdmin) return { kind: "suspended" };

  return { kind: "sign-in" };
}
