/**
 * Borrowing somebody else's session, and getting back out again.
 *
 * The org switcher answers "what is in this organization". This answers a
 * different question the switcher structurally cannot: "what does THIS PERSON
 * actually see". Acting on an org makes you an owner of it, so every admin-only
 * panel is visible and every `privileged` branch is taken — which is precisely
 * the opposite of what you need when a member reports that a page is empty or a
 * button is missing.
 *
 * ─── Why sessionStorage, and why a stash at all ──────────────────────────
 *
 * `POST /admin/impersonate/:userId` returns a real token for that account, and
 * the app is driven entirely by whichever token is in the cookie. So
 * impersonating means overwriting the cookie — and without somewhere to put the
 * original, the only way back would be signing in again. Hence the stash.
 *
 * `sessionStorage`, not `localStorage`: an impersonation is a thing you are
 * doing right now, in this tab, and it should not survive the browser being
 * closed and reopened tomorrow. If the stash is ever lost the consequence is
 * mild and recoverable — you are signed in as the other user and have to sign in
 * again — which is the right failure for the safer of the two options.
 *
 * The banner does NOT key off `user.isSuperAdmin`. While impersonating, /auth/me
 * reports the impersonated account, so that flag is false and the platform nav
 * disappears — correctly, because you are seeing what they see. The only thing
 * that knows an impersonation is happening is this stash, which is why the way
 * out has to be driven from here.
 */

const STASH_KEY = "trax_impersonation";

export interface Impersonation {
  /** The super admin's own token, to be restored on the way out. */
  token: string;
  /** Who is being viewed, for the banner. */
  email: string;
  /** Their org, so the banner can say where they are. */
  orgId: string;
  startedAt: number;
}

export function getImpersonation(): Impersonation | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(STASH_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Impersonation;
    // A stash with no token cannot get anybody back out, so it is worse than
    // none — it would render a banner whose only button does nothing.
    return parsed?.token ? parsed : null;
  } catch {
    return null;
  }
}

export function stashImpersonation(entry: Impersonation): boolean {
  try {
    window.sessionStorage.setItem(STASH_KEY, JSON.stringify(entry));
    return true;
  } catch {
    // Private mode, or site data blocked. Reported rather than swallowed: the
    // caller must NOT go on to overwrite the cookie, because there would be no
    // way back to the platform account.
    return false;
  }
}

export function clearImpersonation() {
  try {
    window.sessionStorage.removeItem(STASH_KEY);
  } catch {
    /* nothing to do — see stashImpersonation */
  }
}
