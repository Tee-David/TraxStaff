"use client";

import { useCallback, useEffect, useState, useRef } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { api } from "@/lib/api";
import type { Member, Project } from "@/lib/types";
import { Badge, Button, Card, EmptyState, Input } from "@/components/ui";
import { SearchInput } from "@/components/filters";
import { Select } from "@/components/Select";

const DOTS = ["var(--color-cat-focus)", "#ff6600", "#12b5a5", "#8a5cf6", "#e0457b"];

const AVATAR_PALETTE = [
  "bg-blue-700", "bg-orange-600", "bg-teal-600",
  "bg-violet-600", "bg-rose-600", "bg-indigo-600",
];

function tintIndex(email: string) {
  let h = 0;
  for (const c of email) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h % AVATAR_PALETTE.length;
}

/** Compact "who's assigned" indicator for a table row — a small avatar-initials
 * cluster with an overflow count, so admins can see assignment at a glance
 * without opening the assign dialog. */
function AssignedCluster({ userIds, members }: { userIds: string[]; members: Member[] }) {
  if (userIds.length === 0) {
    return <span className="text-[12px] text-faint">Unassigned</span>;
  }
  const byId = new Map(members.map((m) => [m.id, m]));
  const shown = userIds.slice(0, 3);
  return (
    <div className="flex items-center gap-2">
      <div className="flex -space-x-2">
        {shown.map((uid) => {
          const m = byId.get(uid);
          const email = m?.email ?? "?";
          return (
            <div
              key={uid}
              title={email}
              className={`h-6 w-6 rounded-full ring-2 ring-surface flex items-center justify-center text-[10px] font-bold text-white ${AVATAR_PALETTE[tintIndex(email)]}`}
            >
              {email.substring(0, 2).toUpperCase()}
            </div>
          );
        })}
      </div>
      <span className="text-[12px] text-muted">
        {userIds.length === 1 ? "1 person" : `${userIds.length} people`}
      </span>
    </div>
  );
}

/** Checklist of every org member, pre-checked per the project's current
 * assignment. Mirrors the TargetDialog pattern in members/page.tsx: a
 * centered card over a backdrop, Cancel/Save, loading state on Save. */
function AssignMembersDialog({
  project,
  members,
  onClose,
  onSave,
}: {
  project: Project;
  members: Member[];
  onClose: () => void;
  onSave: (userIds: string[]) => Promise<void>;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set(project.assignedUserIds ?? []));
  const [saving, setSaving] = useState(false);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const assignable = members.filter((m) => m.status !== "disabled");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <Card className="relative z-10 w-full max-w-sm p-6">
        <h2 className="font-heading text-[15px] font-semibold text-ink">Assign members</h2>
        <p className="mt-1 text-[12px] text-muted">
          Choose who can see and track time against &ldquo;{project.name}&rdquo;. Admins and owners
          always see every project regardless of this list.
        </p>
        <div className="mt-4 max-h-64 space-y-1 overflow-y-auto">
          {assignable.length === 0 ? (
            <p className="py-4 text-center text-[13px] text-muted">No members to assign yet.</p>
          ) : (
            assignable.map((m) => (
              <label
                key={m.id}
                className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 text-sm hover:bg-canvas transition"
              >
                <input
                  type="checkbox"
                  checked={selected.has(m.id)}
                  onChange={() => toggle(m.id)}
                  className="h-4 w-4 rounded border-border accent-brand"
                />
                <span className="truncate text-ink">{m.email}</span>
                {m.role !== "member" && (
                  <span className="ml-auto shrink-0 text-[11px] text-muted capitalize">{m.role}</span>
                )}
              </label>
            ))
          )}
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button
            onClick={async () => {
              setSaving(true);
              try {
                await onSave([...selected]);
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

type Tab = "active" | "archived";

const MENU_WIDTH = 160;

/**
 * Portalled to document.body at fixed coordinates taken from the button's own
 * rect — same fix as the Members page menu. This table sits in a Card with
 * overflow-hidden (to clip its rounded corners) inside an overflow-x-auto
 * scroller, and an absolutely positioned child cannot escape either, so the
 * menu used to draw clipped inside the row instead of floating above it.
 */
function ActionMenu({ project, onRefresh, onAssign }: { project: Project; onRefresh: () => void; onAssign: () => void }) {
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

  async function toggleArchive() {
    await api(`/projects/${project.id}`, { method: "PATCH", body: JSON.stringify({ archived: !project.archivedAt }) });
    setRect(null);
    onRefresh();
  }

  const pos = rect
    ? {
        left: Math.max(8, Math.min(rect.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - 8)),
        top: rect.bottom + 8 + 140 > window.innerHeight ? undefined : rect.bottom + 8,
        bottom: rect.bottom + 8 + 140 > window.innerHeight ? window.innerHeight - rect.top + 8 : undefined,
      }
    : null;

  return (
    <>
      <button
        ref={btnRef}
        onClick={() => setRect(open ? null : (btnRef.current?.getBoundingClientRect() ?? null))}
        className="text-muted hover:text-ink hover:bg-canvas rounded-lg px-2 py-1 transition focus:outline-none focus:ring-2 focus:ring-brand"
        aria-expanded={open}
      >
        ⋯
      </button>
      {typeof document !== "undefined" &&
        createPortal(
          <AnimatePresence>
            {pos && (
              <motion.div
                ref={menuRef}
                initial={{ opacity: 0, scale: 0.95, y: -10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: -10 }}
                transition={{ duration: 0.15 }}
                style={{ position: "fixed", width: MENU_WIDTH, ...pos }}
                className="z-[60] overflow-hidden rounded-xl border border-border bg-surface shadow-xl"
              >
                <div className="py-1">
                  <Link
                    href={`/app/projects/${project.id}`}
                    onClick={() => setRect(null)}
                    className="block w-full px-4 py-2 text-left text-sm text-ink hover:bg-canvas transition"
                  >
                    View details
                  </Link>
                  <button
                    onClick={() => { setRect(null); onAssign(); }}
                    className="block w-full px-4 py-2 text-left text-sm text-ink hover:bg-canvas transition"
                  >
                    Assign members
                  </button>
                  <button
                    onClick={toggleArchive}
                    className="block w-full px-4 py-2 text-left text-sm text-ink hover:bg-canvas transition"
                  >
                    {project.archivedAt ? "Unarchive" : "Archive"}
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>,
          document.body
        )}
    </>
  );
}

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("active");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("newest");
  const [assigningFor, setAssigningFor] = useState<Project | null>(null);

  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [clientTag, setClientTag] = useState("");

  const load = useCallback(() => {
    setLoading(true);
    api<Project[]>(`/projects${tab === "archived" ? "?archived=1" : ""}`)
      .then(setProjects)
      .catch(() => {
        setProjects([]);
      })
      .finally(() => setLoading(false));
  }, [tab]);

  useEffect(() => {
    load();
  }, [load]);

  // Loaded once for the assign dialog and the row cluster — admin-only page,
  // so this list is small and doesn't need to move with tab/search.
  useEffect(() => {
    api<Member[]>("/members").then(setMembers).catch(() => setMembers([]));
  }, []);

  async function createProject(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    try {
      await api("/projects", { method: "POST", body: JSON.stringify({ name, clientTag: clientTag || undefined }) });
      setName("");
      setClientTag("");
      await load();
    } finally {
      setCreating(false);
    }
  }

  async function saveAssignment(project: Project, userIds: string[]) {
    await api(`/projects/${project.id}/members`, {
      method: "PUT",
      body: JSON.stringify({ userIds }),
    });
    await load();
  }

  let visible = projects.filter((p) => p.name.toLowerCase().includes(search.toLowerCase()));
  if (sort === "newest") {
    visible = visible.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  } else if (sort === "oldest") {
    visible = visible.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  } else if (sort === "name") {
    visible = visible.sort((a, b) => a.name.localeCompare(b.name));
  }

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-8 gap-4">
        <div>
          <h1 className="text-2xl font-heading font-bold text-ink">Projects</h1>
        </div>
        {tab === "active" && (
          <form onSubmit={createProject} className="flex flex-col sm:flex-row items-end sm:items-center gap-3">
            <div className="flex gap-2">
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Project name" required className="w-40" />
              <Input value={clientTag} onChange={(e) => setClientTag(e.target.value)} placeholder="Client (opt)" className="w-32" />
            </div>
            <Button type="submit" disabled={creating} className="bg-accent hover:bg-accent/90 text-white border-none shrink-0 shadow-[var(--shadow-lift)]">
              + Add Project
            </Button>
          </form>
        )}
      </div>

      <div className="mb-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="inline-flex rounded-lg border border-border bg-surface p-1 shadow-sm">
          {(["active", "archived"] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`rounded-md px-4 py-1.5 text-[13px] font-semibold capitalize transition ${
                tab === t ? "bg-canvas text-ink shadow-[var(--shadow-soft)]" : "text-muted hover:text-ink"
              }`}
            >
              {t === "active" ? "All projects" : "Archived"}
            </button>
          ))}
        </div>
        
        <div className="flex items-center gap-3">
          <span className="text-[13px] font-medium text-muted">Sort by</span>
          <div className="w-32">
            <Select 
              value={sort} 
              onChange={setSort} 
              options={[
                { value: "newest", label: "Newest" },
                { value: "oldest", label: "Oldest" },
                { value: "name", label: "Name (A-Z)" }
              ]} 
            />
          </div>
          <div className="w-48 relative">
            <SearchInput value={search} onChange={setSearch} placeholder="Search…" />
          </div>
        </div>
      </div>

      {loading ? (
        <div className="space-y-4">{[0, 1, 2, 3].map((i) => <div key={i} className="h-16 rounded-xl bg-canvas animate-pulse" />)}</div>
      ) : visible.length === 0 ? (
        <EmptyState
          icon="🗂"
          title={search ? "No projects match your search" : `No ${tab} projects`}
          hint={tab === "active" ? "Create your first project above." : undefined}
        />
      ) : (
        <Card className="overflow-hidden border border-border shadow-[var(--shadow-soft)]">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[900px]">
              <thead>
                <tr className="border-b border-border/80 bg-canvas/30 text-[12px] font-semibold text-ink">
                  <th className="px-6 py-4">Name</th>
                  <th className="px-4 py-4 w-32">Status</th>
                  <th className="px-4 py-4 w-56">Summary</th>
                  <th className="px-4 py-4 w-40">Progress</th>
                  <th className="px-4 py-4 w-40">Assigned</th>
                  <th className="px-4 py-4 text-center w-16">Action</th>
                </tr>
              </thead>
              <tbody className="text-sm">
                {visible.map((p, i) => {
                  const total = p.tasks?.length ?? 0;
                  const done = p.tasks?.filter((t) => t.status === "done").length ?? 0;
                  const inProg = p.tasks?.filter((t) => t.status === "in_progress").length ?? 0;
                  
                  const progressPct = total === 0 ? 0 : Math.round((done / total) * 100);
                  
                  let statusLabel = "Backlog";
                  let statusTone: "muted" | "brand" | "green" | "red" | "accent" = "muted";
                  
                  if (p.archivedAt) {
                    statusLabel = "Paused";
                    statusTone = "muted" as const;
                  } else if (total > 0 && done === total) {
                    statusLabel = "Done";
                    statusTone = "green" as const;
                  } else if (inProg > 0 || done > 0) {
                    statusLabel = "In Progress";
                    statusTone = "accent" as const;
                  }

                  const summary = p.tasks && p.tasks.length > 0 
                    ? p.tasks[p.tasks.length - 1].title 
                    : "Workspace initialized";
                  const subSummary = p.tasks && p.tasks.length > 0 
                    ? `Latest of ${total} tasks` 
                    : "No tasks added yet";

                  const dotColor = DOTS[i % DOTS.length];

                  return (
                    <tr key={p.id} className="border-b border-border/60 last:border-0 hover:bg-canvas/40 transition">
                      <td className="px-6 py-4">
                        <Link href={`/app/projects/${p.id}`} className="flex items-center gap-3 group">
                          <div className="h-9 w-9 rounded-full flex items-center justify-center text-white font-bold text-sm shrink-0 shadow-sm" style={{ backgroundColor: dotColor }}>
                            {p.name.charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <div className="font-semibold text-[14px] text-ink group-hover:text-brand transition">{p.name}</div>
                            <div className="text-[12px] text-muted truncate max-w-[200px]">{p.clientTag || "Internal"}</div>
                          </div>
                        </Link>
                      </td>
                      <td className="px-4 py-4">
                        <Badge tone={statusTone} dot={false}>
                          <span style={{ color: `var(--color-${statusTone === 'accent' ? 'accent' : statusTone === 'green' ? 'positive' : 'muted'})`}}>
                            {statusLabel}
                          </span>
                        </Badge>
                      </td>
                      <td className="px-4 py-4">
                        <div className="font-medium text-[13px] text-ink truncate max-w-[220px]">{summary}</div>
                        <div className="text-[12px] text-muted truncate max-w-[220px]">{subSummary}</div>
                      </td>
                      <td className="px-4 py-4">
                        <div className="flex items-center gap-3">
                          <div className="flex-1 h-1.5 rounded-full bg-border overflow-hidden">
                            <div 
                              className="h-full rounded-full transition-all duration-500"
                              style={{ 
                                width: `${progressPct}%`,
                                backgroundColor: statusTone === 'green' ? 'var(--color-positive)' : statusTone === 'accent' ? 'var(--color-accent)' : 'var(--color-brand)'
                              }} 
                            />
                          </div>
                          <span className="text-[12px] font-semibold text-muted w-8">{progressPct}%</span>
                        </div>
                      </td>
                      <td className="px-4 py-4">
                        <AssignedCluster userIds={p.assignedUserIds ?? []} members={members} />
                      </td>
                      <td className="px-4 py-4 text-center">
                        <ActionMenu project={p} onRefresh={load} onAssign={() => setAssigningFor(p)} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {assigningFor && (
        <AssignMembersDialog
          project={assigningFor}
          members={members}
          onClose={() => setAssigningFor(null)}
          onSave={(userIds) => saveAssignment(assigningFor, userIds)}
        />
      )}
    </div>
  );
}

