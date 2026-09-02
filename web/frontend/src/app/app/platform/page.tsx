"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, ApiError, asArray } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useActingOrg } from "@/lib/acting-org";
import type { PlatformOrgRow } from "@/lib/platform";
import { Badge, Button, Card, EmptyState, Input, Label, PageHeader, Skeleton } from "@/components/ui";
import { formatDate } from "@/lib/format";

/**
 * Platform home — every organization on the deployment.
 *
 * The "Operate as" action is the one that matters: it sets the acting org and
 * reloads, after which every ordinary page in the app (Reports, Members,
 * Screenshots, Projects) is showing that org. There is no second implementation
 * of those views here, and deliberately so.
 */
export default function PlatformOrgsPage() {
  const { user } = useAuth();
  const { switchTo, orgId: actingOrgId, refreshOrgs } = useActingOrg();

  const [orgs, setOrgs] = useState<PlatformOrgRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setOrgs(asArray<PlatformOrgRow>(await api("/admin/orgs")));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load organizations");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Rendered rather than redirected: a redirect would briefly flash the console
  // to someone who cannot use it, and the API refuses them regardless.
  if (user && !user.isSuperAdmin) {
    return (
      <EmptyState icon="🔒" title="Not available" hint="This area is for platform staff." />
    );
  }

  async function createOrg(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setInviteUrl(null);
    try {
      const res = await api<{ owner: { inviteUrl: string } | null }>("/admin/orgs", {
        method: "POST",
        body: JSON.stringify({
          name: name.trim(),
          ...(ownerEmail.trim() ? { ownerEmail: ownerEmail.trim() } : {}),
        }),
      });
      // Surfaced rather than only emailed: platform staff seeding a customer
      // routinely have to hand the link over by another channel, and the mail
      // may not have gone out at all.
      if (res.owner?.inviteUrl) setInviteUrl(res.owner.inviteUrl);
      setName("");
      setOwnerEmail("");
      if (!res.owner?.inviteUrl) setCreating(false);
      await load();
      await refreshOrgs();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create the organization");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Organizations"
        subtitle="Every workspace on this deployment."
        actions={
          <Button onClick={() => setCreating((c) => !c)} variant={creating ? "ghost" : "primary"}>
            {creating ? "Cancel" : "New organization"}
          </Button>
        }
      />

      {error && (
        <Card className="border-[var(--color-negative)]/30 bg-[var(--color-negative-soft)] p-4 text-sm text-[var(--color-negative)]">
          {error}
        </Card>
      )}

      {creating && (
        <Card className="p-5">
          <form onSubmit={createOrg} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label>Organization name</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} required placeholder="Acme Ltd" />
              </div>
              <div>
                <Label>First owner&rsquo;s email (optional)</Label>
                <Input
                  type="email"
                  value={ownerEmail}
                  onChange={(e) => setOwnerEmail(e.target.value)}
                  placeholder="owner@acme.com"
                />
                <p className="mt-1.5 text-xs text-muted">
                  Sends an invite rather than creating a password — they set their own.
                </p>
              </div>
            </div>
            <Button type="submit" disabled={busy || !name.trim()}>
              {busy ? "Creating…" : "Create organization"}
            </Button>
          </form>

          {inviteUrl && (
            <div className="mt-4 rounded-lg border border-border bg-canvas p-3">
              <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-faint">
                Invite link
              </div>
              <code className="block break-all text-xs text-ink">{inviteUrl}</code>
              <p className="mt-2 text-xs text-muted">
                Valid for 24 hours. Hand this over directly if the email does not arrive.
              </p>
            </div>
          )}
        </Card>
      )}

      {loading ? (
        <div className="space-y-2">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : orgs.length === 0 ? (
        <EmptyState title="No organizations" hint="Nothing has been created on this deployment yet." />
      ) : (
        <div className="space-y-2">
          {orgs.map((org) => (
            <Card key={org.id} className="flex flex-wrap items-center gap-4 p-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <Link
                    href={`/app/platform/orgs/${org.id}`}
                    className="truncate font-semibold text-ink transition hover:text-brand"
                  >
                    {org.name}
                  </Link>
                  {org.status === "suspended" && <Badge tone="red">Suspended</Badge>}
                  {org.id === actingOrgId && <Badge tone="accent">Operating</Badge>}
                </div>
                <div className="mt-0.5 text-xs text-muted">
                  {org.memberCount} {org.memberCount === 1 ? "member" : "members"} ·{" "}
                  {org.projectCount} {org.projectCount === 1 ? "project" : "projects"} · created{" "}
                  {formatDate(org.createdAt)}
                </div>
              </div>
              <div className="flex shrink-0 gap-2">
                <Button
                  variant="ghost"
                  onClick={() => switchTo(org.id === actingOrgId ? null : org.id)}
                >
                  {org.id === actingOrgId ? "Stop operating" : "Operate as"}
                </Button>
                <Link href={`/app/platform/orgs/${org.id}`}>
                  <Button variant="subtle">Manage</Button>
                </Link>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
