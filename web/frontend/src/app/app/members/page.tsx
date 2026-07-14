"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { Member } from "@/lib/types";
import { Badge, Button, Card, Input, Label, PageHeader, Skeleton } from "@/components/ui";
import { FilterBar, SearchInput } from "@/components/filters";

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

  const roleTone = { owner: "accent", admin: "brand", member: "muted" } as const;
  const statusTone = { active: "green", invited: "muted", disabled: "red" } as const;

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
        <Card className="p-5">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                <th className="pb-2 font-medium">Email</th>
                <th className="pb-2 font-medium">Role</th>
                <th className="pb-2 font-medium">Status</th>
                <th className="pb-2 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {members
                .filter((m) => m.email.toLowerCase().includes(search.toLowerCase()))
                .filter((m) => !roleFilter || m.role === roleFilter)
                .map((m) => (
                <tr key={m.id} className="border-b border-border/60 last:border-0">
                  <td className="py-2.5 font-medium">{m.email}</td>
                  <td className="py-2.5">
                    <Badge tone={roleTone[m.role]}>{m.role}</Badge>
                  </td>
                  <td className="py-2.5">
                    <Badge tone={statusTone[m.status]}>{m.status}</Badge>
                  </td>
                  <td className="py-2.5 text-right">
                    {m.role !== "owner" && m.status !== "disabled" && (
                      <button
                        onClick={() => disable(m)}
                        className="text-sm text-red-600 hover:underline"
                      >
                        Disable
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
