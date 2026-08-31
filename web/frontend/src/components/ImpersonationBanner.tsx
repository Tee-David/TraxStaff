"use client";

import { useEffect, useState } from "react";
import { api, getToken, setActingOrg, setToken } from "@/lib/api";
import {
  clearImpersonation,
  getImpersonation,
  stashImpersonation,
  type Impersonation,
} from "@/lib/impersonation";

/**
 * The way into and out of somebody else's session.
 *
 * See lib/impersonation.ts for why the stash exists and why it is
 * sessionStorage. The important structural point for this file: while
 * impersonating, `/auth/me` reports the impersonated account, so
 * `user.isSuperAdmin` is false and the platform nav is gone. The banner
 * therefore cannot key off auth state at all — it reads the stash directly,
 * because the stash is the only thing that knows.
 */

/**
 * Swap the current session for the target user's.
 *
 * Order matters and is the whole safety story: stash first, and abort if the
 * stash fails. Overwriting the cookie before securing the original would leave
 * the operator signed in as somebody else with no way back short of signing in
 * again — which on a shared support machine is a genuinely bad afternoon.
 */
export async function beginImpersonation(userId: string): Promise<string | null> {
  const mine = getToken();
  if (!mine) return "You are not signed in.";

  let res: { token: string; user: { email: string; orgId: string } };
  try {
    res = await api(`/admin/impersonate/${userId}`, { method: "POST" });
  } catch (err) {
    return err instanceof Error ? err.message : "Could not start impersonation";
  }

  const stashed = stashImpersonation({
    token: mine,
    email: res.user.email,
    orgId: res.user.orgId,
    startedAt: Date.now(),
  });
  if (!stashed) {
    return "This browser will not let the page store your own session, so impersonation was cancelled. Nothing changed.";
  }

  // Only now is it safe to become somebody else.
  //
  // The acting org is cleared as well: it is a super admin's tool, the
  // impersonated account is not one, and the backend would ignore the header
  // anyway — leaving it set would only produce a banner claiming an org switch
  // that is not happening.
  setActingOrg(null);
  setToken(res.token);
  window.location.href = "/app";
  return null;
}

export function ImpersonationBanner() {
  // Read in an effect rather than during render: sessionStorage does not exist
  // on the server, and touching it during the first render is a hydration
  // mismatch waiting to happen.
  const [session, setSession] = useState<Impersonation | null>(null);

  useEffect(() => {
    setSession(getImpersonation());
  }, []);

  if (!session) return null;

  function stop() {
    // Restore before clearing, so a failure at either step leaves the operator
    // holding their own token rather than nothing.
    setToken(session!.token);
    clearImpersonation();
    setActingOrg(null);
    window.location.href = "/app/platform/users";
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-negative)]/30 bg-[var(--color-negative)]/10 px-4 py-2 text-sm lg:px-8">
      <div className="flex min-w-0 items-center gap-2">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className="h-4 w-4 shrink-0 text-[var(--color-negative)]"
        >
          <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="12" cy="12" r="3" />
        </svg>
        <span className="min-w-0 truncate text-[var(--color-negative)]">
          Viewing as <strong className="font-semibold">{session.email}</strong> — you are seeing
          exactly what they see, with their permissions.
        </span>
      </div>
      <button
        onClick={stop}
        className="shrink-0 rounded-lg border border-[var(--color-negative)]/40 px-3 py-1 text-xs font-semibold text-[var(--color-negative)] transition hover:bg-[var(--color-negative)]/10"
      >
        Return to platform
      </button>
    </div>
  );
}
