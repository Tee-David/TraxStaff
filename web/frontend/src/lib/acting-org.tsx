"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api, asArray, getActingOrg, setActingOrg } from "./api";
import { useAuth } from "./auth";

/**
 * Which organization a super admin is currently operating on.
 *
 * The whole cross-org story rests on one header (see `api()` in lib/api.ts and
 * lib/acting-org.ts on the backend), so this context is deliberately thin: it
 * owns the selection, exposes the list to choose from, and forces a reload when
 * the selection changes.
 *
 * The reload is not laziness. Every page in this app holds fetched rows in its
 * own `useState`, and switching org changes the meaning of all of them at once.
 * Without a hard reload the member list of one org would sit on screen beside
 * the reports of another until each page happened to refetch — and the whole
 * danger of this feature is acting on the wrong tenant because the screen said
 * something stale.
 */

export interface PlatformOrg {
  id: string;
  name: string;
  status?: string;
  memberCount: number;
  projectCount: number;
  createdAt: string;
}

interface ActingOrgValue {
  /** Null when the super admin is in their own org, or when they are not one. */
  orgId: string | null;
  org: PlatformOrg | null;
  orgs: PlatformOrg[];
  loading: boolean;
  /** Pass null to return to your own organization. */
  switchTo: (orgId: string | null) => void;
  refreshOrgs: () => Promise<void>;
}

const ActingOrgContext = createContext<ActingOrgValue>({
  orgId: null,
  org: null,
  orgs: [],
  loading: false,
  switchTo: () => {},
  refreshOrgs: async () => {},
});

export function ActingOrgProvider({ children }: { children: React.ReactNode }) {
  // `authLoading` is load-bearing, not decoration. See the effect below.
  const { user, loading: authLoading } = useAuth();
  const isSuper = Boolean(user?.isSuperAdmin);

  const [orgId, setOrgId] = useState<string | null>(null);
  const [orgs, setOrgs] = useState<PlatformOrg[]>([]);
  const [loading, setLoading] = useState(false);

  /**
   * Read the persisted selection once the user is actually known.
   *
   * The `authLoading` guard is the whole correctness of this effect. `useAuth`
   * starts with `user === null` and resolves it asynchronously from /auth/me,
   * so on every page load there is a window where a real super admin looks
   * exactly like a non-super-admin. Without the guard the branch below fired in
   * that window and cleared the stored org — meaning the switcher silently
   * reset itself on every navigation and reload, and the header was never sent
   * again after the first page.
   *
   * "We do not know yet" and "they are not a super admin" are different states,
   * and only the second one should clear anything.
   */
  useEffect(() => {
    if (authLoading) return;

    if (!isSuper) {
      // Now genuinely known not to be a super admin — including after the flag
      // is revoked on a session that is still open.
      setActingOrg(null);
      setOrgId(null);
      return;
    }
    setOrgId(getActingOrg());
  }, [authLoading, isSuper]);

  const refreshOrgs = useCallback(async () => {
    // Same window as above: calling /admin/orgs before auth resolves would
    // either 401 or be wasted, and its failure would empty the switcher.
    if (authLoading || !isSuper) return;
    setLoading(true);
    try {
      setOrgs(asArray<PlatformOrg>(await api("/admin/orgs")));
    } catch {
      // A failed list is not worth blowing up the shell for — the switcher just
      // renders empty and the rest of the app carries on.
      setOrgs([]);
    } finally {
      setLoading(false);
    }
  }, [authLoading, isSuper]);

  useEffect(() => {
    refreshOrgs();
  }, [refreshOrgs]);

  const switchTo = useCallback((next: string | null) => {
    setActingOrg(next);
    setOrgId(next);
    // See the note at the top of this file on why this is a full reload.
    if (typeof window !== "undefined") window.location.reload();
  }, []);

  const org = orgs.find((o) => o.id === orgId) ?? null;

  return (
    <ActingOrgContext.Provider value={{ orgId, org, orgs, loading, switchTo, refreshOrgs }}>
      {children}
    </ActingOrgContext.Provider>
  );
}

export function useActingOrg() {
  return useContext(ActingOrgContext);
}
