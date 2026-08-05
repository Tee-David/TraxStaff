"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { api } from "@/lib/api";
import type { Member } from "@/lib/types";
import { Badge, Button, Card, EmptyState, Input, Label, PageHeader, Skeleton } from "@/components/ui";
import { Select } from "@/components/Select";
import { formatDate } from "@/lib/format";

const ROLE_CONFIG = {
  owner: { label: "Owner", bg: "bg-brand/10", text: "text-brand", dot: "#000065" },
  admin: { label: "Admin", bg: "bg-accent/10", text: "text-accent", dot: "#ff6600" },
  member: { label: "Member", bg: "bg-border", text: "text-muted", dot: "var(--color-faint)" },
} as const;

const STATUS_CONFIG = {
  active: { label: "Active", color: "bg-green-500" },
  invited: { label: "Pending", color: "bg-amber-400" },
  disabled: { label: "Disabled", color: "bg-border" },
  removed: { label: "Removed", color: "bg-[var(--color-negative)]" },
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

// Display the email, or a placeholder if the member has been removed.
// (Removed members have their email tombstoned to free it for reuse, so the original
// email is no longer stored/visible on the row.)
function displayEmail(member: Member): string {
  if (member.status === "removed") {
    return "(removed)";
  }
  return member.email;
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

const MENU_WIDTH = 160;

/**
 * The dropdown renders into document.body rather than next to its button.
 *
 * Both member tables sit in a `Card` with `overflow-hidden` (to clip the table's
 * rounded corners) inside an `overflow-x-auto` scroller. An absolutely
 * positioned child cannot escape either of those, so the menu was drawn clipped
 * INSIDE the card and pushed a scrollbar onto it. A portal plus fixed
 * coordinates from the button's own rect is the only thing that reliably
 * escapes an ancestor's overflow.
 */
function ActionMenu({ items }: { items: { label: string; danger?: boolean; onClick: () => void }[] }) {
  const [rect, setRect] = useState<DOMRect | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const open = rect !== null;

  useEffect(() => {
    if (!open) return;
    function outside(e: MouseEvent) {
      const t = e.target as Node;
      if (!btnRef.current?.contains(t) && !menuRef.current?.contains(t)) setRect(null);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setRect(null);
    }
    // Fixed coordinates go stale the moment anything scrolls, so close instead
    // of leaving the menu stranded away from its row.
    const close = () => setRect(null);
    document.addEventListener("mousedown", outside);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("mousedown", outside);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  // Right-aligned to the button, flipped above it when there is no room below.
  const pos = rect
    ? {
        left: Math.max(8, Math.min(rect.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - 8)),
        top: rect.bottom + 8 + 120 > window.innerHeight ? undefined : rect.bottom + 8,
        bottom: rect.bottom + 8 + 120 > window.innerHeight ? window.innerHeight - rect.top + 8 : undefined,
      }
    : null;

  return (
    <>
      <button
        ref={btnRef}
        onClick={() => setRect(open ? null : (btnRef.current?.getBoundingClientRect() ?? null))}
        className="rounded-lg px-2.5 py-1.5 text-muted hover:bg-canvas hover:text-ink transition focus:outline-none"
        aria-label="Actions"
        aria-expanded={open}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
          <circle cx="8" cy="3" r="1.4" /><circle cx="8" cy="8" r="1.4" /><circle cx="8" cy="13" r="1.4" />
        </svg>
      </button>
      {typeof document !== "undefined" &&
        createPortal(
          <AnimatePresence>
            {pos && (
              <motion.div
                ref={menuRef}
                initial={{ opacity: 0, scale: 0.94, y: -6 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.94, y: -6 }}
                transition={{ duration: 0.13 }}
                style={{ position: "fixed", width: MENU_WIDTH, ...pos }}
                className="z-[60] rounded-xl border border-border bg-surface shadow-[var(--shadow-lift)] overflow-hidden"
              >
                {items.map((it) => (
                  <button
                    key={it.label}
                    onClick={() => { setRect(null); it.onClick(); }}
                    className={`block w-full px-4 py-2.5 text-left text-[13px] transition hover:bg-canvas ${it.danger ? "text-[var(--color-negative)]" : "text-ink"}`}
                  >
                    {it.label}
                  </button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>,
          document.body
        )}
    </>
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

/** Hours for humans, minutes on the wire. Blank means "inherit the org default". */
function TargetDialog({
  member,
  onClose,
  onSave,
}: {
  member: Member;
  onClose: () => void;
  onSave: (daily: number | null, weekly: number | null) => Promise<void>;
}) {
  const toHours = (m: number | null) => (m === null ? "" : String(m / 60));
  const [daily, setDaily] = useState(toHours(member.dailyTargetMinutes));
  const [weekly, setWeekly] = useState(toHours(member.weeklyTargetMinutes));
  const [saving, setSaving] = useState(false);

  // "" clears the override; anything unparseable is treated the same way rather
  // than silently writing a 0-hour target.
  const parse = (v: string) => {
    const t = v.trim();
    if (t === "") return null;
    const n = Number(t);
    return Number.isFinite(n) && n >= 0 ? Math.round(n * 60) : null;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <Card className="relative z-10 w-full max-w-sm p-6">
        <h2 className="font-heading text-[15px] font-semibold text-ink">Work targets</h2>
        <p className="mt-1 text-[12px] text-muted">
          For {member.email}. Leave blank to use the organisation default.
        </p>
        <div className="mt-5 space-y-4">
          <div>
            <Label>Daily target (hours)</Label>
            <Input type="number" min={0} max={24} step={0.5} value={daily} placeholder="Org default" onChange={(e) => setDaily(e.target.value)} />
          </div>
          <div>
            <Label>Weekly target (hours)</Label>
            <Input type="number" min={0} max={168} step={0.5} value={weekly} placeholder="Org default" onChange={(e) => setWeekly(e.target.value)} />
          </div>
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button
            onClick={async () => {
              setSaving(true);
              try {
                await onSave(parse(daily), parse(weekly));
                onClose();
              } finally {
                setSaving(false);
              }
            }}
            disabled={saving}
          >
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </Card>
    </div>
  );
}

/**
 * Removal is a one-way door — there is no Re-enable path afterward, unlike
 * Disable — so it requires the admin to type the member's exact email before
 * the destructive button will even enable. Mirrors TargetDialog's modal shell.
 */
function RemoveDialog({
  member,
  onClose,
  onConfirm,
}: {
  member: Member;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}) {
  const [confirmText, setConfirmText] = useState("");
  const [saving, setSaving] = useState(false);
  const matches = confirmText.trim().toLowerCase() === member.email.toLowerCase();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <Card className="relative z-10 w-full max-w-sm p-6">
        <h2 className="font-heading text-[15px] font-semibold text-ink">Remove user</h2>
        <p className="mt-1 text-[12px] text-muted">
          This permanently revokes {member.email}&rsquo;s access. Unlike disabling, there is no
          re-enable path afterward — their tracked time, screenshots, and history are kept, but
          the account itself cannot sign in or be restored from here.
        </p>
        <div className="mt-4">
          <Label>Type {member.email} to confirm</Label>
          <Input
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder={member.email}
            autoFocus
          />
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button
            variant="danger"
            onClick={async () => {
              setSaving(true);
              try {
                await onConfirm();
                onClose();
              } finally {
                setSaving(false);
              }
            }}
            disabled={saving || !matches}
          >
            {saving ? "Removing…" : "Remove user"}
          </Button>
        </div>
      </Card>
    </div>
  );
}

type InviteResult = { ok: true; emailed: boolean; inviteUrl?: string };

function noticeTone(kind: "ok" | "err" | "warn"): string {
  if (kind === "ok") return "text-[var(--color-positive)]";
  // Undelivered mail is not a failed invite — the link works. Amber, not red.
  if (kind === "warn") return "text-[var(--color-warning,#b26b00)]";
  return "text-[var(--color-negative)]";
}

/**
 * The invite is valid whether or not the mail got out, so this is never framed
 * as a failure — but it must not claim the message was sent when it was not.
 * Saying "Invite sent" while the SMTP connection was refused is how an admin
 * ends up waiting on an email that is never coming.
 */
function inviteNotice(
  email: string,
  res: InviteResult,
  verb: "sent" | "re-sent"
): { kind: "ok" | "warn"; text: string } {
  if (res.emailed) return { kind: "ok", text: `Invite ${verb} to ${email}.` };
  return {
    kind: "warn",
    text: res.inviteUrl
      ? `${email} was invited, but the email could not be delivered. Send them this link: ${res.inviteUrl}`
      : `${email} was invited, but the email could not be delivered. Use Resend, or share their invite link directly.`,
  };
}

export default function MembersPage() {
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"admin" | "member">("member");
  const [inviting, setInviting] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "err" | "warn"; text: string } | null>(null);
  const [search, setSearch] = useState("");
  const [showInviteForm, setShowInviteForm] = useState(false);
  const [targetFor, setTargetFor] = useState<Member | null>(null);
  const [removeFor, setRemoveFor] = useState<Member | null>(null);

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
      const res = await api<InviteResult>("/auth/invite", {
        method: "POST",
        body: JSON.stringify({ email, role }),
      });
      setNotice(inviteNotice(email, res, "sent"));
      setEmail("");
      setShowInviteForm(false);
      await load();
    } catch (err) {
      setNotice({ kind: "err", text: err instanceof Error ? err.message : "Invite failed" });
    } finally {
      setInviting(false);
    }
  }

  async function saveTargets(m: Member, daily: number | null, weekly: number | null) {
    await api(`/members/${m.id}`, {
      method: "PATCH",
      body: JSON.stringify({ dailyTargetMinutes: daily, weeklyTargetMinutes: weekly }),
    });
    await load();
  }

  async function changeRole(m: Member, next: "admin" | "member") {
    setMembers((ms) => ms.map((x) => (x.id === m.id ? { ...x, role: next } : x)));
    await api(`/members/${m.id}`, { method: "PATCH", body: JSON.stringify({ role: next }) }).catch(() => load());
  }

  async function setStatus(m: Member, status: "active" | "disabled" | "removed") {
    if (status === "disabled") await api(`/members/${m.id}`, { method: "DELETE" }).catch(() => {});
    else await api(`/members/${m.id}`, { method: "PATCH", body: JSON.stringify({ status }) }).catch(() => {});
    await load();
  }

  async function resend(m: Member) {
    setNotice(null);
    try {
      const res = await api<InviteResult>("/auth/invite", {
        method: "POST",
        body: JSON.stringify({ email: m.email, role: m.role }),
      });
      setNotice(inviteNotice(m.email, res, "re-sent"));
    } catch {
      setNotice({ kind: "err", text: "Could not resend invite." });
    }
  }

  const matches = (m: Member) => m.email.toLowerCase().includes(search.toLowerCase());
  const allVisible = members.filter(matches);
  const active = allVisible.filter((m) => m.status !== "invited");
  const pending = allVisible.filter((m) => m.status === "invited");
  // Deliberately "active" only, not "not disabled" — a removed account is
  // gone for good and must not inflate this the way a disabled one shouldn't
  // either.
  const totalActive = members.filter((m) => m.status === "active").length;

  return (
    <div>
      {/* Header */}
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between" data-tour="members-header">
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
                <Button type="submit" disabled={inviting}>
                  {inviting ? "Sending…" : "Send invite"}
                </Button>
              </form>
              {notice && (
                <p className={`mt-3 text-sm ${noticeTone(notice.kind)} break-words`}>
                  {notice.text}
                </p>
              )}
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
          <p className={`text-sm ${noticeTone(notice.kind)} break-words`}>
            {notice.text}
          </p>
        )}
      </div>

      {loading ? (
        <Skeleton className="h-64" />
      ) : (
        <div className="space-y-5">

          {/* Active & disabled members */}
          <Card className="overflow-hidden" data-tour="members-table">
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
                            <MemberAvatar email={m.email} disabled={m.status !== "active"} />
                            <div className="min-w-0">
                              <div className="font-semibold text-[13px] text-ink truncate">{displayEmail(m).split("@")[0]}</div>
                              <div className="text-[11px] text-muted truncate sm:hidden">{displayEmail(m)}</div>
                            </div>
                          </div>
                        </td>
                        {/* Status */}
                        <td className="px-4 py-4 whitespace-nowrap">
                          <StatusPill status={m.status} />
                        </td>
                        {/* Email */}
                        <td className="px-4 py-4 hidden sm:table-cell">
                          <span className="text-[12px] text-muted truncate">{displayEmail(m)}</span>
                        </td>
                        {/* Joined */}
                        <td className="px-4 py-4 hidden md:table-cell">
                          <span className="text-[12px] text-muted">{formatDate(m.createdAt)}</span>
                        </td>
                        {/* Role */}
                        <td className="px-4 py-4">
                          {m.role === "owner" ? (
                            <RolePill role="owner" />
                          ) : m.status !== "active" ? (
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
                          {/* Owner: no menu at all. Removed: no menu either — the
                              account is gone for good and there is nothing left
                              to do from here (crucially, no Re-enable). */}
                          {m.role !== "owner" && m.status !== "removed" && (
                            <ActionMenu
                              items={
                                m.status === "disabled"
                                  ? [
                                      { label: "Re-enable", onClick: () => setStatus(m, "active") },
                                      { label: "Remove user", danger: true, onClick: () => setRemoveFor(m) },
                                    ]
                                  : [
                                      { label: "Set work targets", onClick: () => setTargetFor(m) },
                                      { label: "Disable access", danger: true, onClick: () => setStatus(m, "disabled") },
                                      { label: "Remove user", danger: true, onClick: () => setRemoveFor(m) },
                                    ]
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
            <Card className="overflow-hidden" data-tour="members-pending">
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
                              <div className="font-semibold text-[13px] text-ink truncate">{displayEmail(m).split("@")[0]}</div>
                              <div className="text-[11px] sm:hidden text-muted truncate">{displayEmail(m)}</div>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-4 hidden sm:table-cell">
                          <span className="text-[12px] text-muted">{displayEmail(m)}</span>
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

      {targetFor && (
        <TargetDialog
          member={targetFor}
          onClose={() => setTargetFor(null)}
          onSave={(daily, weekly) => saveTargets(targetFor, daily, weekly)}
        />
      )}

      {removeFor && (
        <RemoveDialog
          member={removeFor}
          onClose={() => setRemoveFor(null)}
          onConfirm={() => setStatus(removeFor, "removed")}
        />
      )}
    </div>
  );
}
