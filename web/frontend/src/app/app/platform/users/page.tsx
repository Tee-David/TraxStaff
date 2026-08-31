"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError, asArray } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { PlatformUserRow } from "@/lib/platform";
import { Badge, Button, Card, EmptyState, Input, Label, PageHeader, Skeleton } from "@/components/ui";
import { Select } from "@/components/Select";
import { beginImpersonation } from "@/components/ImpersonationBanner";

/**
 * Every user on the deployment, and what can be done to them.
 *
 * The one thing this page does that no org-facing surface can: act on an
 * `owner`, and grant or revoke platform access itself. routes/members.ts
 * refuses both — correctly, because an org admin quietly demoting the person
 * who owns the account is not a thing that should be possible from inside.
 */
export default function PlatformUsersPage() {
  const { user: me } = useAuth();

  const [rows, setRows] = useState<PlatformUserRow[]>([]);
  const [orgs, setOrgs] = useState<{ id: string; name: string }[]>([]);
  const [q, setQ] = useState("");
  const [orgFilter, setOrgFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<PlatformUserRow | null>(null);
  const [viewingAs, setViewingAs] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (q.trim()) params.set("q", q.trim());
      if (orgFilter) params.set("orgId", orgFilter);
      setRows(asArray<PlatformUserRow>(await api(`/admin/users?${params}`)));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load users");
    } finally {
      setLoading(false);
    }
  }, [q, orgFilter]);

  useEffect(() => {
    // Debounced so typing in the search box does not fire a request per keystroke
    // against a cross-tenant query.
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  useEffect(() => {
    api<{ id: string; name: string }[]>("/admin/orgs")
      .then((r) => setOrgs(asArray(r)))
      .catch(() => setOrgs([]));
  }, []);

  if (me && !me.isSuperAdmin) {
    return <EmptyState icon="🔒" title="Not available" hint="This area is for platform staff." />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="All users"
        subtitle="Every account, in every organization."
      />

      <Card className="p-4 text-sm text-muted">
        <strong className="text-ink">Operate as</strong> an organization (top bar) to manage it as an
        owner. <strong className="text-ink">View as</strong> a person to see exactly what they see,
        with their permissions — which is the only way to reproduce a member reporting an empty page.
      </Card>

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

      <Card className="p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[16rem] flex-1">
            <Label>Search</Label>
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Email or name…" />
          </div>
          <div className="min-w-[14rem]">
            <Label>Organization</Label>
            <Select
              value={orgFilter}
              onChange={setOrgFilter}
              options={[{ value: "", label: "All organizations" }, ...orgs.map((o) => ({ value: o.id, label: o.name }))]}
            />
          </div>
        </div>
      </Card>

      {loading ? (
        <Skeleton className="h-48 w-full" />
      ) : rows.length === 0 ? (
        <EmptyState title="No users" hint="Nothing matched that search." />
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-faint">
                <th className="px-4 py-3 font-semibold">User</th>
                <th className="px-4 py-3 font-semibold">Organization</th>
                <th className="px-4 py-3 font-semibold">Role</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {rows.map((u) => (
                <tr key={u.id} className="border-b border-border/60 last:border-0">
                  <td className="px-4 py-3">
                    <div className="font-medium text-ink">{u.email}</div>
                    {u.name && <div className="text-xs text-muted">{u.name}</div>}
                  </td>
                  <td className="px-4 py-3 text-muted">{u.orgName}</td>
                  <td className="px-4 py-3">
                    <span className="capitalize text-muted">{u.role}</span>
                    {u.isSuperAdmin && (
                      <span className="ml-2">
                        <Badge tone="accent">Platform</Badge>
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={u.status === "active" ? "green" : u.status === "invited" ? "accent" : "muted"}>
                      {u.status}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex justify-end gap-2">
                      {/* Only an active account has a session worth borrowing;
                          the API refuses the rest, so the button is hidden
                          rather than left to fail. */}
                      {u.status === "active" && !u.isSuperAdmin && (
                        <Button
                          variant="subtle"
                          disabled={viewingAs === u.id}
                          onClick={async () => {
                            setViewingAs(u.id);
                            const problem = await beginImpersonation(u.id);
                            if (problem) {
                              setError(problem);
                              setViewingAs(null);
                            }
                            // On success the page navigates away, so there is
                            // deliberately nothing to reset here.
                          }}
                        >
                          {viewingAs === u.id ? "Switching…" : "View as"}
                        </Button>
                      )}
                      <Button variant="ghost" onClick={() => setEditing(u)}>
                        Manage
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {editing && (
        <EditUser
          user={editing}
          isSelf={editing.id === me?.id}
          onClose={() => setEditing(null)}
          onDone={(message) => {
            setEditing(null);
            setNotice(message);
            load();
          }}
          onError={setError}
        />
      )}
    </div>
  );
}

function EditUser({
  user,
  isSelf,
  onClose,
  onDone,
  onError,
}: {
  user: PlatformUserRow;
  isSelf: boolean;
  onClose: () => void;
  onDone: (message: string) => void;
  onError: (message: string) => void;
}) {
  const [role, setRole] = useState(user.role);
  const [status, setStatus] = useState(user.status);
  const [password, setPassword] = useState("");
  const [superAdmin, setSuperAdmin] = useState(user.isSuperAdmin);
  const [confirmDelete, setConfirmDelete] = useState("");
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      const body: Record<string, unknown> = {};
      if (role !== user.role) body.role = role;
      if (status !== user.status) body.status = status;
      if (superAdmin !== user.isSuperAdmin) body.isSuperAdmin = superAdmin;
      if (password) body.password = password;

      if (Object.keys(body).length === 0) {
        onClose();
        return;
      }
      await api(`/admin/users/${user.id}`, { method: "PATCH", body: JSON.stringify(body) });
      onDone(`${user.email} updated.`);
    } catch (err) {
      onError(err instanceof ApiError ? err.message : "Could not update this user");
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await api(`/admin/users/${user.id}`, { method: "DELETE" });
      onDone(`${user.email} deleted. Their tracked work was kept.`);
    } catch (err) {
      onError(err instanceof ApiError ? err.message : "Could not delete this user");
      setBusy(false);
    }
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40" onClick={onClose} />
      <div className="fixed inset-x-0 bottom-0 z-50 mx-auto max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-t-2xl border border-border bg-surface p-6 shadow-lift sm:inset-y-0 sm:right-0 sm:left-auto sm:my-auto sm:h-fit sm:rounded-2xl sm:mr-6">
        <div className="mb-4">
          <h2 className="font-heading text-lg font-semibold">{user.email}</h2>
          <p className="text-sm text-muted">{user.orgName}</p>
        </div>

        <div className="space-y-4">
          <div>
            <Label>Role</Label>
            <Select
              value={role}
              onChange={(v) => setRole(v as PlatformUserRow["role"])}
              options={[
                { value: "owner", label: "Owner" },
                { value: "admin", label: "Admin" },
                { value: "member", label: "Member" },
              ]}
            />
            <p className="mt-1.5 text-xs text-muted">
              Owner can be set from here — the org&rsquo;s own Members page refuses it.
            </p>
          </div>

          <div>
            <Label>Status</Label>
            <Select
              value={status}
              onChange={(v) => setStatus(v as PlatformUserRow["status"])}
              options={[
                { value: "active", label: "Active" },
                { value: "invited", label: "Invited" },
                { value: "disabled", label: "Disabled" },
              ]}
            />
          </div>

          <div>
            <Label>Set a new password</Label>
            <Input
              type="text"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Leave blank to keep the current one"
              autoComplete="new-password"
            />
            <p className="mt-1.5 text-xs text-muted">
              No current-password check, and every outstanding reset link for this account is
              invalidated.
            </p>
          </div>

          <label className="flex items-start gap-3 rounded-lg border border-border p-3">
            <input
              type="checkbox"
              checked={superAdmin}
              disabled={isSelf}
              onChange={(e) => setSuperAdmin(e.target.checked)}
              className="mt-0.5"
            />
            <span className="text-sm">
              <span className="font-medium">Platform super admin</span>
              <span className="mt-0.5 block text-xs text-muted">
                {isSelf
                  ? "You cannot revoke your own access — that would be a locked door with the key inside."
                  : "Full cross-organization access, invisible to org admins."}
              </span>
            </span>
          </label>

          <div className="flex gap-2 pt-1">
            <Button onClick={save} disabled={busy}>
              {busy ? "Saving…" : "Save changes"}
            </Button>
            <Button variant="ghost" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
          </div>

          {!isSelf && (
            <div className="mt-2 rounded-lg border border-[var(--color-negative)]/30 p-3">
              <div className="text-sm font-medium text-[var(--color-negative)]">Delete account</div>
              <p className="mt-0.5 text-xs text-muted">
                Everything they tracked survives and stays visible in their org&rsquo;s reports; only
                the account goes.
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Input
                  value={confirmDelete}
                  onChange={(e) => setConfirmDelete(e.target.value)}
                  placeholder={`Type "${user.email}" to confirm`}
                  className="max-w-[18rem]"
                />
                <Button
                  variant="danger"
                  disabled={busy || confirmDelete !== user.email}
                  onClick={remove}
                >
                  Delete
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
