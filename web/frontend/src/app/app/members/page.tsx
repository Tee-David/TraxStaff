"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { api } from "@/lib/api";
import type { Member } from "@/lib/types";
import { Badge, Button, Card, EmptyState, Input, Label, PageHeader, Skeleton } from "@/components/ui";
import { Select } from "@/components/Select";
import { formatDate } from "@/lib/format";

const MAX_SEATS = 10;

const ROLE_CONFIG = {
  owner: { label: "Owner", bg: "bg-brand/10", text: "text-brand", dot: "#000065" },
  admin: { label: "Admin", bg: "bg-accent/10", text: "text-accent", dot: "#ff6600" },
  member: { label: "Member", bg: "bg-border", text: "text-muted", dot: "var(--color-faint)" },
} as const;

const STATUS_CONFIG = {
  active: { label: "Active", color: "bg-green-500" },
  invited: { label: "Pending", color: "bg-amber-400" },
  disabled: { label: "Disabled", color: "bg-border" },
} as const;

const AVATAR_PALETTE = [
  "bg-blue-700", "bg-orange-600", "bg-teal-600",
  "bg-violet-600", "bg-rose-600", "bg-indigo-600",
];

function tintIndex(email: string) {
  let h = 0;
  for (const c of email) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h % AVATAR_PALETTE.length;
}

function MemberAvatar({ email, disabled }: { email: string; disabled?: boolean }) {
  const initials = email.substring(0, 2).toUpperCase();
  const colorClass = disabled ? "bg-faint" : AVATAR_PALETTE[tintIndex(email)];
  return (
    <div className={`h-9 w-9 shrink-0 rounded-full flex items-center justify-center text-[13px] font-bold text-white ${colorClass}`}>
      {initials}
    </div>
  );
}

function ActionMenu({ items }: { items: { label: string; danger?: boolean; onClick: () => void }[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function outside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener("mousedown", outside);
    return () => document.removeEventListener("mousedown", outside);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="rounded-lg px-2.5 py-1.5 text-muted hover:bg-canvas hover:text-ink transition focus:outline-none"
        aria-label="Actions"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
          <circle cx="8" cy="3" r="1.4" /><circle cx="8" cy="8" r="1.4" /><circle cx="8" cy="13" r="1.4" />
        </svg>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, scale: 0.94, y: -6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.94, y: -6 }}
            transition={{ duration: 0.13 }}
            className="absolute right-0 top-9 z-50 w-40 rounded-xl border border-border bg-surface shadow-[var(--shadow-lift)] overflow-hidden"
          >
            {items.map((it) => (
              <button
                key={it.label}
                onClick={() => { setOpen(false); it.onClick(); }}
                className={`block w-full px-4 py-2.5 text-left text-[13px] transition hover:bg-canvas ${it.danger ? "text-[var(--color-negative)]" : "text-ink"}`}
              >
                {it.label}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function RolePill({ role }: { role: Member["role"] }) {
  const cfg = ROLE_CONFIG[role];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ${cfg.bg} ${cfg.text}`}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: cfg.dot }} />
      {cfg.label}
    </span>
  );
}

function StatusPill({ status }: { status: Member["status"] }) {
  const cfg = STATUS_CONFIG[status];
  return (
    <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-ink">
      <span className={`h-2 w-2 rounded-full ${cfg.color}`} />
      {cfg.label}
    </span>
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
  const [showInviteForm, setShowInviteForm] = useState(false);

  async function load() {
    const data = await api<Member[]>("/members");
    setMembers(data);
    setLoading(false);
  }
  useEffect(() => { load().catch(() => setLoading(false)); }, []);

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    setInviting(true);
    setNotice(null);
    try {
      await api("/auth/invite", { method: "POST", body: JSON.stringify({ email, role }) });
      setNotice({ kind: "ok", text: `Invite sent to ${email}.` });
      setEmail("");
      setShowInviteForm(false);
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
  const allVisible = members.filter(matches);
  const active = allVisible.filter((m) => m.status !== "invited");
  const pending = allVisible.filter((m) => m.status === "invited");
  const seatsUsed = members.filter((m) => m.status !== "disabled").length;
  const seatsPct = Math.min(100, Math.round((seatsUsed / MAX_SEATS) * 100));
  const totalActive = members.filter((m) => m.status === "active").length;

  return (
    <div>
      {/* Header */}
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-heading text-2xl font-bold text-ink">Team members</h1>
          <p className="mt-0.5 text-sm text-muted">Invite teammates and manage their access</p>
        </div>
        <div className="flex items-center gap-3">
          <Badge tone="muted">{totalActive} active</Badge>
          <Button onClick={() => setShowInviteForm((v) => !v)} className="gap-2">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M7 1v12M1 7h12" />
            </svg>
            Add member
          </Button>
        </div>
      </div>

      {/* Invite form (collapsible) */}
      <AnimatePresence>
        {showInviteForm && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <Card className="mb-5 p-5 border-brand/30">
              <h2 className="font-heading text-[15px] font-semibold mb-4">Invite a new member</h2>
              <form onSubmit={invite} className="flex flex-wrap items-end gap-3">
                <div className="min-w-56 flex-1">
                  <Label>Email address</Label>
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
                <p className={`mt-3 text-sm ${notice.kind === "ok" ? "text-[var(--color-positive)]" : "text-[var(--color-negative)]"}`}>
                  {notice.text}
                </p>
              )}
              {/* Seat meter */}
              <div className="mt-4 border-t border-border pt-4">
                <div className="mb-2 flex items-center justify-between text-[12px]">
                  <span className="text-muted">{seatsUsed} of {MAX_SEATS} seats used</span>
                  {seatsUsed >= MAX_SEATS && <span className="font-semibold text-accent">Seat limit reached</span>}
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-canvas">
                  <div
                    className="h-full rounded-full bg-brand transition-[width] duration-500"
                    style={{ width: `${seatsPct}%` }}
                  />
                </div>
              </div>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Search */}
      <div className="mb-4 flex items-center gap-3">
        <div className="relative flex-1 max-w-xs">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
            <circle cx="6" cy="6" r="4.5" /><path d="m10.5 10.5 2.5 2.5" strokeLinecap="round" />
          </svg>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or email…"
            className="w-full rounded-lg border border-border bg-surface pl-8 pr-3 py-2 text-sm text-ink placeholder:text-faint outline-none focus:border-brand transition"
          />
        </div>
        {notice && !showInviteForm && (
          <p className={`text-sm ${notice.kind === "ok" ? "text-[var(--color-positive)]" : "text-[var(--color-negative)]"}`}>
            {notice.text}
          </p>
        )}
      </div>

      {loading ? (
        <Skeleton className="h-64" />
      ) : (
        <div className="space-y-5">

          {/* Active & disabled members */}
          <Card className="overflow-hidden">
            <div className="border-b border-border px-6 py-4 flex items-center justify-between">
              <h2 className="font-heading text-[14px] font-semibold text-ink">People with access</h2>
              <span className="text-[12px] text-muted">{active.length} member{active.length !== 1 ? "s" : ""}</span>
            </div>

            {active.length === 0 ? (
              <div className="px-6 py-12">
                <EmptyState icon="👥" title="No members match" hint="Try adjusting your search." />
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border/60 bg-canvas/30 text-[11px] font-semibold uppercase tracking-wide text-muted">
                      <th className="px-6 py-3 text-left">User</th>
                      <th className="px-4 py-3 text-left w-24">Status</th>
                      <th className="px-4 py-3 text-left hidden sm:table-cell w-44">Email</th>
                      <th className="px-4 py-3 text-left hidden md:table-cell w-32">Joined</th>
                      <th className="px-4 py-3 text-left w-32">Role</th>
                      <th className="px-4 py-3 text-center w-12">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {active.map((m) => (
                      <tr key={m.id} className="hover:bg-canvas/40 transition group">
                        {/* User */}
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <MemberAvatar email={m.email} disabled={m.status === "disabled"} />
                            <div className="min-w-0">
                              <div className="font-semibold text-[13px] text-ink truncate">{m.email.split("@")[0]}</div>
                              <div className="text-[11px] text-muted truncate sm:hidden">{m.email}</div>
                            </div>
                          </div>
                        </td>
                        {/* Status */}
                        <td className="px-4 py-4 whitespace-nowrap">
                          <StatusPill status={m.status} />
                        </td>
                        {/* Email */}
                        <td className="px-4 py-4 hidden sm:table-cell">
                          <span className="text-[12px] text-muted truncate">{m.email}</span>
                        </td>
                        {/* Joined */}
                        <td className="px-4 py-4 hidden md:table-cell">
                          <span className="text-[12px] text-muted">{formatDate(m.createdAt)}</span>
                        </td>
                        {/* Role */}
                        <td className="px-4 py-4">
                          {m.role === "owner" ? (
                            <RolePill role="owner" />
                          ) : m.status === "disabled" ? (
                            <RolePill role={m.role} />
                          ) : (
                            <Select
                              value={m.role}
                              onChange={(v) => changeRole(m, v as "admin" | "member")}
                              options={[{ value: "member", label: "Member" }, { value: "admin", label: "Admin" }]}
                              align="right"
                              minWidth={120}
                            />
                          )}
                        </td>
                        {/* Actions */}
                        <td className="px-4 py-4 text-center">
                          {m.role !== "owner" && (
                            <ActionMenu
                              items={
                                m.status === "disabled"
                                  ? [{ label: "Re-enable", onClick: () => setStatus(m, "active") }]
                                  : [{ label: "Disable access", danger: true, onClick: () => setStatus(m, "disabled") }]
                              }
                            />
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {/* Pending invitations */}
          {pending.length > 0 && (
            <Card className="overflow-hidden">
              <div className="border-b border-border px-6 py-4 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <h2 className="font-heading text-[14px] font-semibold text-ink">Pending invitations</h2>
                  <span className="inline-flex items-center justify-center h-5 min-w-5 px-1.5 rounded-full bg-accent/10 text-[11px] font-bold text-accent">{pending.length}</span>
                </div>
                <span className="text-[12px] text-muted">Awaiting acceptance</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border/60 bg-canvas/30 text-[11px] font-semibold uppercase tracking-wide text-muted">
                      <th className="px-6 py-3 text-left">User</th>
                      <th className="px-4 py-3 text-left hidden sm:table-cell">Email</th>
                      <th className="px-4 py-3 text-left hidden md:table-cell w-32">Invited</th>
                      <th className="px-4 py-3 text-left w-32">Role</th>
                      <th className="px-4 py-3 text-center w-12">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {pending.map((m) => (
                      <tr key={m.id} className="hover:bg-canvas/40 transition">
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <MemberAvatar email={m.email} disabled />
                            <div className="min-w-0">
                              <div className="font-semibold text-[13px] text-ink truncate">{m.email.split("@")[0]}</div>
                              <div className="text-[11px] sm:hidden text-muted truncate">{m.email}</div>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-4 hidden sm:table-cell">
                          <span className="text-[12px] text-muted">{m.email}</span>
                        </td>
                        <td className="px-4 py-4 hidden md:table-cell">
                          <span className="text-[12px] text-muted">{formatDate(m.createdAt)}</span>
                        </td>
                        <td className="px-4 py-4">
                          <RolePill role={m.role} />
                        </td>
                        <td className="px-4 py-4 text-center">
                          <ActionMenu
                            items={[
                              { label: "Resend invite", onClick: () => resend(m) },
                              { label: "Revoke", danger: true, onClick: () => setStatus(m, "disabled") },
                            ]}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
