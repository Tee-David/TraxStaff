"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import type { Member } from "@/lib/types";
import { Badge, Button, Card, EmptyState, Input, Label, PageHeader, Skeleton } from "@/components/ui";
import { Select } from "@/components/Select";
import { formatDate } from "@/lib/format";

const MAX_SEATS = 10; // team stays under 10 (see PRD)
const roleTone = { owner: "accent", admin: "brand", member: "muted" } as const;

// Deterministic avatar tint from an email.
const AVATARS = ["#000065", "#ff6600", "#12b5a5", "#8a5cf6", "#e0457b"];
function tint(email: string) {
  let h = 0;
  for (const c of email) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return AVATARS[h % AVATARS.length];
}

function Avatar({ email, muted }: { email: string; muted?: boolean }) {
  return (
    <span
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold uppercase text-white"
      style={{ background: muted ? "var(--color-faint)" : tint(email) }}
    >
      {email.slice(0, 1)}
    </span>
  );
}

// Small ⋯ actions menu with a click-away backdrop.
function RowMenu({ items }: { items: { label: string; danger?: boolean; onClick: () => void }[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="Actions"
        className="rounded-lg px-2 py-1 text-lg leading-none text-faint transition hover:bg-canvas hover:text-ink"
      >
        ⋯
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-9 z-20 w-40 overflow-hidden rounded-xl border border-border bg-surface py-1 shadow-lift">
            {items.map((it) => (
              <button
                key={it.label}
                onClick={() => { setOpen(false); it.onClick(); }}
                className={`block w-full px-3.5 py-2 text-left text-sm transition hover:bg-canvas ${it.danger ? "text-[var(--color-negative)]" : ""}`}
              >
                {it.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export default function MembersPage() {
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"admin" | "member">("member");
  const [inviting, setInviting] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [search, setSearch] = useState("");

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
      setNotice({ kind: "ok", text: `Invite sent to ${email}.` });
      setEmail("");
      await load();
    } catch (err) {
      setNotice({ kind: "err", text: err instanceof Error ? err.message : "Invite failed" });
    } finally {
      setInviting(false);
    }
  }

  async function changeRole(m: Member, next: "admin" | "member") {
    setMembers((ms) => ms.map((x) => (x.id === m.id ? { ...x, role: next } : x)));
    await api(`/members/${m.id}`, { method: "PATCH", body: JSON.stringify({ role: next }) }).catch(() => load());
  }
  async function setStatus(m: Member, status: "active" | "disabled") {
    if (status === "disabled") await api(`/members/${m.id}`, { method: "DELETE" }).catch(() => {});
    else await api(`/members/${m.id}`, { method: "PATCH", body: JSON.stringify({ status }) }).catch(() => {});
    await load();
  }
  async function resend(m: Member) {
    setNotice(null);
    try {
      await api("/auth/invite", { method: "POST", body: JSON.stringify({ email: m.email, role: m.role }) });
      setNotice({ kind: "ok", text: `Invite re-sent to ${m.email}.` });
    } catch {
      setNotice({ kind: "err", text: "Could not resend invite." });
    }
  }

  const matches = (m: Member) => m.email.toLowerCase().includes(search.toLowerCase());
  const active = members.filter((m) => m.status !== "invited").filter(matches);
  const pending = members.filter((m) => m.status === "invited").filter(matches);
  const seatsUsed = members.filter((m) => m.status !== "disabled").length;
  const seatsPct = Math.min(100, Math.round((seatsUsed / MAX_SEATS) * 100));

  return (
    <div>
      <PageHeader title="Members" subtitle="Invite teammates and manage their access" />

      {/* Invite */}
      <Card className="mb-5 p-5">
        <form onSubmit={invite} className="flex flex-wrap items-end gap-3">
          <div className="min-w-56 flex-1">
            <Label>Invite by email</Label>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="teammate@company.com" required />
          </div>
          <div>
            <Label>Role</Label>
            <Select
              value={role}
              onChange={(v) => setRole(v as "admin" | "member")}
              options={[{ value: "member", label: "Member" }, { value: "admin", label: "Admin" }]}
              minWidth={140}
            />
          </div>
          <Button type="submit" disabled={inviting || seatsUsed >= MAX_SEATS}>
            {inviting ? "Sending…" : "Send invite"}
          </Button>
        </form>
        {notice && (
          <p className={`mt-3 text-sm ${notice.kind === "ok" ? "text-[var(--color-positive)]" : "text-[var(--color-negative)]"}`}>{notice.text}</p>
        )}
        {/* Seats */}
        <div className="mt-4 border-t border-border pt-4">
          <div className="mb-1.5 flex items-center justify-between text-xs">
            <span className="font-medium text-muted">{seatsUsed} of {MAX_SEATS} team seats used</span>
            {seatsUsed >= MAX_SEATS && <span className="font-semibold text-accent">Seat limit reached</span>}
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-canvas">
            <div className="h-full rounded-full bg-brand transition-[width] duration-500" style={{ width: `${seatsPct}%` }} />
          </div>
        </div>
      </Card>

      {/* Search */}
      <div className="mb-4">
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search members…" className="max-w-xs" />
      </div>

      {loading ? (
        <Skeleton className="h-64" />
      ) : (
        <div className="space-y-5">
          {/* People with access */}
          <Card>
            <div className="border-b border-border px-5 py-3.5">
              <h2 className="font-heading text-[15px] font-semibold">People with access</h2>
            </div>
            <div className="divide-y divide-border">
              {active.length === 0 && (
                <div className="px-5 py-8">
                  <EmptyState icon="👥" title="No members match" hint="Try a different search." />
                </div>
              )}
              {active.map((m) => (
                <div key={m.id} className="flex items-center gap-3 px-5 py-3">
                  <Avatar email={m.email} muted={m.status === "disabled"} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium">{m.email.split("@")[0]}</span>
                      {m.status === "disabled" && <Badge tone="red">disabled</Badge>}
                    </div>
                    <div className="truncate text-xs text-muted">{m.email}</div>
                  </div>
                  <span className="hidden text-xs text-faint sm:block">Joined {formatDate(m.createdAt)}</span>
                  {m.role === "owner" ? (
                    <Badge tone={roleTone.owner}>Owner</Badge>
                  ) : m.status === "disabled" ? (
                    <Badge tone="muted">{m.role}</Badge>
                  ) : (
                    <Select
                      value={m.role}
                      onChange={(v) => changeRole(m, v as "admin" | "member")}
                      options={[{ value: "member", label: "Member" }, { value: "admin", label: "Admin" }]}
                      align="right"
                      minWidth={140}
                    />
                  )}
                  {m.role !== "owner" && (
                    <RowMenu
                      items={
                        m.status === "disabled"
                          ? [{ label: "Re-enable", onClick: () => setStatus(m, "active") }]
                          : [{ label: "Disable access", danger: true, onClick: () => setStatus(m, "disabled") }]
                      }
                    />
                  )}
                </div>
              ))}
            </div>
          </Card>

          {/* Pending invitations */}
          {pending.length > 0 && (
            <Card>
              <div className="border-b border-border px-5 py-3.5">
                <h2 className="font-heading text-[15px] font-semibold">
                  Pending invitations <span className="ml-1 text-xs font-normal text-muted">({pending.length})</span>
                </h2>
              </div>
              <div className="divide-y divide-border">
                {pending.map((m) => (
                  <div key={m.id} className="flex items-center gap-3 px-5 py-3">
                    <Avatar email={m.email} muted />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{m.email}</div>
                      <div className="text-xs text-muted">Invited {formatDate(m.createdAt)}</div>
                    </div>
                    <Badge tone="muted" dot>Invite sent</Badge>
                    <Badge tone={roleTone[m.role]}>{m.role}</Badge>
                    <RowMenu
                      items={[
                        { label: "Resend invite", onClick: () => resend(m) },
                        { label: "Revoke", danger: true, onClick: () => setStatus(m, "disabled") },
                      ]}
                    />
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
