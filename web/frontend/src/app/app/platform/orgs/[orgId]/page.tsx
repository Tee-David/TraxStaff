"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { useActingOrg } from "@/lib/acting-org";
import { Badge, Button, Card, Input, Label, PageHeader, Skeleton } from "@/components/ui";
import { formatDate } from "@/lib/format";

interface OrgDetail {
  org: {
    id: string;
    name: string;
    status?: string;
    dailyTargetMinutes: number;
    weeklyTargetMinutes: number;
    timezone?: string;
    screenshotsPerBlock?: number;
    blurScreenshots?: boolean;
    idleTimeoutMinutes?: number;
    emailsEnabled?: boolean;
  };
  members: {
    id: string;
    email: string;
    name: string | null;
    role: string;
    status: string;
    isSuperAdmin: boolean;
    createdAt: string;
  }[];
  projects: { id: string; name: string; clientTag: string | null; archivedAt: string | null }[];
}

/**
 * One organization, managed from outside it.
 *
 * Everything destructive here is deliberately harder to reach than everything
 * else: suspension is offered first and framed as the reversible option, and
 * deletion demands the org's name typed out. The name is the only field that
 * proves the operator looked at which org they were on — a UUID in the URL does
 * not.
 */
export default function PlatformOrgDetailPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const router = useRouter();
  const { switchTo, orgId: actingOrgId, refreshOrgs } = useActingOrg();

  const [data, setData] = useState<OrgDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [name, setName] = useState("");
  const [daily, setDaily] = useState("");
  const [weekly, setWeekly] = useState("");
  const [confirmName, setConfirmName] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api<OrgDetail>(`/admin/orgs/${orgId}`);
      setData(res);
      setName(res.org.name);
      setDaily(String(res.org.dailyTargetMinutes ?? ""));
      setWeekly(String(res.org.weeklyTargetMinutes ?? ""));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load this organization");
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    load();
  }, [load]);

  async function saveSettings(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await api(`/admin/orgs/${orgId}/settings`, {
        method: "PATCH",
        body: JSON.stringify({
          name: name.trim(),
          ...(daily ? { dailyTargetMinutes: Number(daily) } : {}),
          ...(weekly ? { weeklyTargetMinutes: Number(weekly) } : {}),
        }),
      });
      setNotice("Settings saved.");
      await load();
      await refreshOrgs();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(status: "active" | "suspended") {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await api(`/admin/orgs/${orgId}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      setNotice(
        status === "suspended"
          ? "Suspended. Nobody in this workspace can sign in until it is resumed."
          : "Resumed. Members can sign in again."
      );
      await load();
      await refreshOrgs();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not change the status");
    } finally {
      setBusy(false);
    }
  }

  async function deleteOrg() {
    setBusy(true);
    setError(null);
    try {
      await api(`/admin/orgs/${orgId}`, {
        method: "DELETE",
        body: JSON.stringify({ confirm: confirmName }),
      });
      // If we were operating on the org we just deleted, stop — every
      // subsequent request would carry a header naming nothing.
      if (actingOrgId === orgId) switchTo(null);
      await refreshOrgs();
      router.push("/app/platform");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not delete");
      setBusy(false);
    }
  }

  if (loading) return <Skeleton className="h-64 w-full" />;
  if (!data) {
    return (
      <Card className="border-[var(--color-negative)]/30 bg-[var(--color-negative)]/5 p-4 text-sm text-[var(--color-negative)]">
        {error ?? "Not found"}
      </Card>
    );
  }

  const suspended = data.org.status === "suspended";
  const activeProjects = data.projects.filter((p) => !p.archivedAt);

  return (
    <div className="space-y-6">
      <PageHeader
        title={data.org.name}
        subtitle={`${data.members.length} members · ${activeProjects.length} active projects`}
        actions={
          <>
            <Link href="/app/platform">
              <Button variant="ghost">All organizations</Button>
            </Link>
            <Button onClick={() => switchTo(orgId === actingOrgId ? null : orgId)}>
              {orgId === actingOrgId ? "Stop operating" : "Operate as"}
            </Button>
          </>
        }
      />

      {suspended && (
        <Card className="border-[var(--color-negative)]/30 bg-[var(--color-negative)]/5 p-4">
          <div className="text-sm font-semibold text-[var(--color-negative)]">
            This workspace is suspended
          </div>
          <p className="mt-1 text-sm text-muted">
            Members cannot sign in and trackers cannot sync. No data has been removed.
          </p>
        </Card>
      )}
      {error && (
        <Card className="border-[var(--color-negative)]/30 bg-[var(--color-negative)]/5 p-4 text-sm text-[var(--color-negative)]">
          {error}
        </Card>
      )}
      {notice && (
        <Card className="border-[var(--color-positive)]/30 bg-[var(--color-positive)]/5 p-4 text-sm text-[var(--color-positive)]">
          {notice}
        </Card>
      )}

      <Card className="p-5">
        <h2 className="mb-4 font-heading text-base font-semibold">Settings</h2>
        <form onSubmit={saveSettings} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="sm:col-span-3">
              <Label>Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <div>
              <Label>Daily target (minutes)</Label>
              <Input type="number" min={0} max={1440} value={daily} onChange={(e) => setDaily(e.target.value)} />
            </div>
            <div>
              <Label>Weekly target (minutes)</Label>
              <Input type="number" min={0} max={10080} value={weekly} onChange={(e) => setWeekly(e.target.value)} />
            </div>
            <div className="flex items-end">
              <div className="text-xs text-muted">
                Timezone: <strong className="text-ink">{data.org.timezone ?? "—"}</strong>
                <div className="mt-0.5">Change the rest from this org&rsquo;s own Settings page while operating as it.</div>
              </div>
            </div>
          </div>
          <Button type="submit" disabled={busy}>
            {busy ? "Saving…" : "Save settings"}
          </Button>
        </form>
      </Card>

      <Card className="p-5">
        <h2 className="mb-4 font-heading text-base font-semibold">Members</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-faint">
                <th className="pb-2 pr-4 font-semibold">Email</th>
                <th className="pb-2 pr-4 font-semibold">Role</th>
                <th className="pb-2 pr-4 font-semibold">Status</th>
                <th className="pb-2 font-semibold">Joined</th>
              </tr>
            </thead>
            <tbody>
              {data.members.map((m) => (
                <tr key={m.id} className="border-b border-border/60 last:border-0">
                  <td className="py-2.5 pr-4">
                    <span className="font-medium text-ink">{m.email}</span>
                    {m.isSuperAdmin && (
                      <Badge tone="accent">
                        <span className="ml-2">Platform</span>
                      </Badge>
                    )}
                  </td>
                  <td className="py-2.5 pr-4 capitalize text-muted">{m.role}</td>
                  <td className="py-2.5 pr-4">
                    <Badge tone={m.status === "active" ? "green" : m.status === "invited" ? "accent" : "muted"}>
                      {m.status}
                    </Badge>
                  </td>
                  <td className="py-2.5 text-muted">{formatDate(m.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-muted">
          Edit roles, reset passwords and remove accounts from{" "}
          <Link href="/app/platform/users" className="text-brand underline">
            All users
          </Link>
          .
        </p>
      </Card>

      <Card className="border-[var(--color-negative)]/25 p-5">
        <h2 className="font-heading text-base font-semibold text-[var(--color-negative)]">
          Danger zone
        </h2>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-4">
          <div className="min-w-0">
            <div className="text-sm font-medium">{suspended ? "Resume workspace" : "Suspend workspace"}</div>
            <p className="mt-0.5 text-xs text-muted">
              {suspended
                ? "Members can sign in again immediately."
                : "Freezes logins and tracking. Nothing is deleted, and it can be undone at any time."}
            </p>
          </div>
          <Button
            variant={suspended ? "primary" : "ghost"}
            disabled={busy}
            onClick={() => setStatus(suspended ? "active" : "suspended")}
          >
            {suspended ? "Resume" : "Suspend"}
          </Button>
        </div>

        <div className="mt-3 rounded-lg border border-[var(--color-negative)]/30 p-4">
          <div className="text-sm font-medium text-[var(--color-negative)]">Delete permanently</div>
          <p className="mt-0.5 text-xs text-muted">
            Removes the organization and everything in it — members, projects, every tracked session
            and screenshot. This cannot be undone. Suspend instead unless you are certain.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Input
              value={confirmName}
              onChange={(e) => setConfirmName(e.target.value)}
              placeholder={`Type "${data.org.name}" to confirm`}
              className="max-w-xs"
            />
            <Button
              variant="danger"
              disabled={busy || confirmName !== data.org.name}
              onClick={deleteOrg}
            >
              Delete organization
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
