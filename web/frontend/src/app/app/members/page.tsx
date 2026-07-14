"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { Member } from "@/lib/types";
import { Badge, Button, Card, EmptyState, Input, Label, PageHeader, Skeleton } from "@/components/ui";
import { FilterBar, SearchInput } from "@/components/filters";
import { DataTable, type Column } from "@/components/DataTable";
import { formatDate } from "@/lib/format";

export default function MembersPage() {
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"admin" | "member">("member");
  const [inviting, setInviting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("");

  async function load() {
    const data = await api<Member[]>("/members");
    setMembers(data);
    setLoading(false);
  }

  useEffect(() => {
    load().catch(() => setLoading(false));
  }, []);

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    setInviting(true);
    setNotice(null);
    try {
      await api("/auth/invite", { method: "POST", body: JSON.stringify({ email, role }) });
      setNotice(`Invite created for ${email}. They'll get an email once SMTP is configured.`);
      setEmail("");
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Invite failed");
    } finally {
      setInviting(false);
    }
  }

  async function disable(m: Member) {
    await api(`/members/${m.id}`, { method: "DELETE" });
    await load();
  }
  async function bulkDisable(ids: string[], clear: () => void) {
    const targets = members.filter((m) => ids.includes(m.id) && m.role !== "owner" && m.status !== "disabled");
    await Promise.all(targets.map((m) => api(`/members/${m.id}`, { method: "DELETE" }).catch(() => {})));
    clear();
    await load();
  }

  const roleTone = { owner: "accent", admin: "brand", member: "muted" } as const;
  const statusTone = { active: "green", invited: "muted", disabled: "red" } as const;

  const visible = members
    .filter((m) => m.email.toLowerCase().includes(search.toLowerCase()))
    .filter((m) => !roleFilter || m.role === roleFilter);

  const columns: Column<Member>[] = [
    { key: "email", header: "Member", sortValue: (m) => m.email, render: (m) => (
      <div className="flex items-center gap-2.5">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand/10 text-xs font-semibold uppercase text-brand">{m.email.slice(0, 1)}</span>
        <span className="font-medium">{m.email}</span>
      </div>
    ) },
    { key: "role", header: "Role", sortValue: (m) => m.role, render: (m) => <Badge tone={roleTone[m.role]}>{m.role}</Badge> },
    { key: "status", header: "Status", sortValue: (m) => m.status, render: (m) => <Badge tone={statusTone[m.status]} dot>{m.status}</Badge> },
    { key: "created", header: "Joined", sortValue: (m) => m.createdAt, render: (m) => <span className="text-muted">{formatDate(m.createdAt)}</span> },
  ];

  return (
    <div>
      <PageHeader title="Members" subtitle="Invite and manage your team" />


      <Card className="mb-6 p-5">
        <form onSubmit={invite} className="flex flex-wrap items-end gap-3">
          <div className="min-w-56 flex-1">
            <Label>Invite by email</Label>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="teammate@company.com"
              required
            />
          </div>
          <div>
            <Label>Role</Label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as "admin" | "member")}
              className="rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-brand"
            >
              <option value="member">Member</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          <Button type="submit" disabled={inviting}>
            {inviting ? "Inviting…" : "Send invite"}
          </Button>
        </form>
        {notice && <p className="mt-3 text-sm text-muted">{notice}</p>}
      </Card>

      <FilterBar>
        <SearchInput value={search} onChange={setSearch} placeholder="Search members…" />
        <select
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value)}
          className="rounded-lg border border-border bg-surface px-3 py-1.5 text-xs outline-none focus:border-brand"
        >
          <option value="">All roles</option>
          <option value="owner">Owner</option>
          <option value="admin">Admin</option>
          <option value="member">Member</option>
        </select>
      </FilterBar>

      {loading ? (
        <Skeleton className="h-64" />
      ) : (
        <DataTable
          rows={visible}
          columns={columns}
          rowId={(m) => m.id}
          selectable
          bulkActions={(ids, clear) => (
            <Button variant="danger" className="px-3 py-1.5 text-xs" onClick={() => bulkDisable(ids, clear)}>
              Disable selected
            </Button>
          )}
          rowActions={(m) =>
            m.role !== "owner" && m.status !== "disabled" ? (
              <button onClick={() => disable(m)} className="text-sm text-[var(--color-negative)] hover:underline">
                Disable
              </button>
            ) : null
          }
          empty={<EmptyState icon="👥" title="No members match" hint="Adjust your search or role filter." />}
        />
      )}
    </div>
  );
}
