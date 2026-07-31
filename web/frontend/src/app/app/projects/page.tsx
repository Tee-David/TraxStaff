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

/** Chevron used by the collapsible Archives strip at the bottom of the rail. */
function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
      className={`shrink-0 transition-transform ${open ? "rotate-90" : ""}`}
    >
      <path d="m9 6 6 6-6 6" />
    </svg>
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

/** What POST /projects/bulk gives back. `blocked` is the important half. */
type BulkResult = {
  action: "archive" | "unarchive" | "delete";
  updated: number;
  deleted: { id: string; name: string }[];
  blocked: { id: string; name: string; sessionCount: number }[];
};

/**
 * Second step of the delete confirmation.
 *
 * Deleting a project is irreversible and takes its tasks with it, so a single
 * click is not enough: this names every project going, says plainly what happens
 * to the ones that can't go, and will not enable the button until the word
 * DELETE has been typed. Archiving is offered right beside it because it is
 * almost always what was actually wanted.
 */
function ConfirmDeleteDialog({
  projects,
  onCancel,
  onConfirm,
  onArchiveInstead,
}: {
  projects: Project[];
  onCancel: () => void;
  onConfirm: () => Promise<void>;
  onArchiveInstead: () => Promise<void>;
}) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const armed = typed.trim().toUpperCase() === "DELETE";

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={busy ? undefined : onCancel} />
      <Card className="relative z-10 w-full max-w-md p-6">
        <h2 className="font-heading text-[15px] font-semibold text-[var(--color-negative)]">
          Delete {projects.length} project{projects.length === 1 ? "" : "s"}?
        </h2>
        <p className="mt-2 text-[13px] leading-relaxed text-muted">
          This cannot be undone. Their tasks and member assignments are deleted with
          them. Any project that already has tracked time against it will be{" "}
          <strong className="text-ink">kept</strong> — deleting it would destroy
          timesheet history, so those have to be archived instead.
        </p>

        <ul className="mt-4 max-h-40 space-y-1 overflow-y-auto rounded-xl bg-canvas p-3">
          {projects.map((p) => (
            <li key={p.id} className="truncate text-[13px] text-ink">
              {p.name}
            </li>
          ))}
        </ul>

        <label className="mt-4 block text-[12px] font-medium text-muted">
          Type DELETE to confirm
          <Input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder="DELETE"
            autoFocus
            className="mt-1.5 w-full"
          />
        </label>

        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button variant="ghost" onClick={() => run(onArchiveInstead)} disabled={busy}>
            Archive instead
          </Button>
          <Button
            onClick={() => run(onConfirm)}
            disabled={!armed || busy}
            className="border-none bg-[var(--color-negative)] text-white hover:opacity-90"
          >
            {busy ? "Deleting…" : "Delete permanently"}
          </Button>
        </div>
      </Card>
    </div>
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

  /* Bulk selection. Held as ids rather than indices so it survives a re-sort or
     a search change without silently pointing at different rows. */
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkNote, setBulkNote] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    // This is the admin project-management view (assign members, archive,
    // etc.), so it explicitly asks for every org project — the default
    // /projects response is now scoped to "projects I'm assigned to", same as
    // everyone else, and would otherwise hide unassigned/other-members'
    // projects from the very screen used to assign them.
    const params = new URLSearchParams({ scope: "all" });
    if (tab === "archived") params.set("archived", "1");
    api<Project[]>(`/projects?${params.toString()}`)
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

  /* Switching tab or clearing the list drops the selection: keeping ids that are
     no longer on screen means a bulk action could hit rows nobody can see. */
  useEffect(() => {
    setPicked(new Set());
    setBulkNote(null);
  }, [tab]);

  function togglePick(id: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function runBulk(action: "archive" | "unarchive" | "delete") {
    const ids = [...picked];
    if (ids.length === 0) return;
    setBulkBusy(true);
    setBulkNote(null);
    try {
      const res = await api<BulkResult>("/projects/bulk", {
        method: "POST",
        body: JSON.stringify({ action, ids }),
      });

      if (action === "delete") {
        const parts: string[] = [];
        if (res.deleted.length > 0) {
          parts.push(`Deleted ${res.deleted.length} project${res.deleted.length === 1 ? "" : "s"}.`);
        }
        // The blocked list is the whole point of reporting back — silently
        // dropping these would look like the delete simply didn't work.
        if (res.blocked.length > 0) {
          parts.push(
            `Kept ${res.blocked.length} with tracked time: ${res.blocked
              .map((b) => b.name)
              .join(", ")}. Archive those instead.`
          );
        }
        setBulkNote(parts.join(" ") || "Nothing was deleted.");
      } else {
        setBulkNote(
          `${action === "archive" ? "Archived" : "Restored"} ${res.updated} project${res.updated === 1 ? "" : "s"}.`
        );
      }

      setPicked(new Set());
      setConfirmingDelete(false);
      await load();
    } catch {
      setBulkNote("That didn't go through. Try again?");
    } finally {
      setBulkBusy(false);
    }
  }

  const visibleAll = projects.filter((p) => p.name.toLowerCase().includes(search.toLowerCase()));
  let visible = visibleAll;
  if (sort === "newest") {
    visible = visible.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  } else if (sort === "oldest") {
    visible = visible.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  } else if (sort === "name") {
    visible = visible.sort((a, b) => a.name.localeCompare(b.name));
  }

  const allPicked = visible.length > 0 && visible.every((p) => picked.has(p.id));
  const pickedProjects = visible.filter((p) => picked.has(p.id));

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-6 gap-4" data-tour="projects-header">
        <div>
          <h1 className="font-heading text-2xl font-bold text-ink">Projects</h1>
          <p className="mt-0.5 text-sm text-muted">Every workspace your org is tracking time against.</p>
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

      {/* Overview controls — Filter (search) / Sort By, matching the reference's
          workload-dashboard control row. The active/archived split lives in the
          collapsible Archives strip below the rail, not as a second control here. */}
      <div className="mb-5 flex flex-col md:flex-row md:items-center justify-between gap-4" data-tour="projects-controls">
        <span className="text-[13px] font-semibold uppercase tracking-wide text-faint">
          {tab === "active" ? "All projects" : "Archived projects"}
        </span>
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
            <SearchInput value={search} onChange={setSearch} placeholder="Filter…" />
          </div>
        </div>
      </div>

      {tab === "archived" && (
        <button
          onClick={() => setTab("active")}
          className="mb-4 inline-flex items-center gap-1.5 text-[13px] font-medium text-muted hover:text-ink transition"
        >
          &larr; Back to active projects
        </button>
      )}

      {/* Result of the last bulk action. Sticks around until the next one so a
          "kept N with tracked time" explanation can actually be read. */}
      {bulkNote && (
        <div className="mb-4 flex items-start justify-between gap-3 rounded-xl border border-border bg-canvas px-4 py-3">
          <p className="text-[13px] text-ink">{bulkNote}</p>
          <button
            onClick={() => setBulkNote(null)}
            className="shrink-0 text-[12px] font-semibold text-muted hover:text-ink"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Bulk action bar, only once something is picked. */}
      <AnimatePresence>
        {picked.size > 0 && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.15 }}
            className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-brand/30 bg-brand/[0.06] px-4 py-3"
          >
            <span className="mr-auto text-[13px] font-semibold text-ink">
              {picked.size} project{picked.size === 1 ? "" : "s"} selected
            </span>
            <Button variant="ghost" onClick={() => setPicked(new Set())} disabled={bulkBusy}>
              Clear
            </Button>
            {tab === "active" ? (
              <Button variant="ghost" onClick={() => runBulk("archive")} disabled={bulkBusy}>
                Archive
              </Button>
            ) : (
              <Button variant="ghost" onClick={() => runBulk("unarchive")} disabled={bulkBusy}>
                Restore
              </Button>
            )}
            <Button
              onClick={() => setConfirmingDelete(true)}
              disabled={bulkBusy}
              className="border-none bg-[var(--color-negative)] text-white hover:opacity-90"
            >
              Delete…
            </Button>
          </motion.div>
        )}
      </AnimatePresence>

      {loading ? (
        <div className="space-y-3">{[0, 1, 2, 3].map((i) => <div key={i} className="h-16 rounded-xl bg-canvas animate-pulse" />)}</div>
      ) : visible.length === 0 ? (
        <EmptyState
          icon="🗂"
          title={search ? "No projects match your search" : `No ${tab} projects`}
          hint={tab === "active" ? "Create your first project above." : undefined}
        />
      ) : (
        <Card className="overflow-hidden border border-border shadow-[var(--shadow-soft)]" data-tour="projects-table">
          {/* Select-all header. Indeterminate when only some rows are picked,
              which is the only honest state for a partial selection — a plain
              unchecked box there implies clicking it selects nothing. */}
          <div className="flex items-center gap-3 border-b border-border bg-canvas/50 px-5 py-2.5">
            <input
              type="checkbox"
              aria-label={allPicked ? "Clear selection" : "Select all projects"}
              checked={allPicked}
              ref={(el) => {
                if (el) el.indeterminate = picked.size > 0 && !allPicked;
              }}
              onChange={() =>
                setPicked(allPicked ? new Set() : new Set(visible.map((p) => p.id)))
              }
              className="h-4 w-4 rounded border-border accent-brand"
            />
            <span className="text-[12px] font-medium text-muted">
              {picked.size > 0
                ? `${picked.size} selected`
                : `${visible.length} project${visible.length === 1 ? "" : "s"}`}
            </span>
          </div>

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

            const dotColor = DOTS[i % DOTS.length];

            return (
              <div
                key={p.id}
                className={`flex flex-col gap-3 border-b border-border/60 px-5 py-4 last:border-0 transition sm:flex-row sm:items-center ${
                  picked.has(p.id) ? "bg-brand/[0.06]" : "hover:bg-canvas/40"
                }`}
              >
                {/* Outside the Link, or picking a row would navigate away. */}
                <input
                  type="checkbox"
                  aria-label={`Select ${p.name}`}
                  checked={picked.has(p.id)}
                  onChange={() => togglePick(p.id)}
                  className="h-4 w-4 shrink-0 rounded border-border accent-brand"
                />
                <Link href={`/app/projects/${p.id}`} className="group flex min-w-0 flex-1 items-center gap-3">
                  <div
                    className="h-9 w-9 shrink-0 rounded-full flex items-center justify-center text-white font-bold text-sm shadow-sm"
                    style={{ backgroundColor: dotColor }}
                  >
                    {p.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-semibold text-[14px] text-ink group-hover:text-brand transition">{p.name}</span>
                      <Badge tone={statusTone}>{statusLabel}</Badge>
                    </div>
                    <div className="truncate text-[12px] text-muted">
                      {p.clientTag || "Internal"} · {total} task{total === 1 ? "" : "s"}
                    </div>
                  </div>
                </Link>

                <div className="flex items-center gap-4 sm:shrink-0">
                  <div className="flex w-28 items-center gap-2 sm:w-32">
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-border">
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{
                          width: `${progressPct}%`,
                          backgroundColor: statusTone === "green" ? "var(--color-positive)" : statusTone === "accent" ? "var(--color-accent)" : "var(--color-brand)",
                        }}
                      />
                    </div>
                    <span className="w-8 shrink-0 text-[12px] font-semibold text-muted">{progressPct}%</span>
                  </div>
                  <div className="hidden w-36 md:block">
                    <AssignedCluster userIds={p.assignedUserIds ?? []} members={members} />
                  </div>
                  <ActionMenu project={p} onRefresh={load} onAssign={() => setAssigningFor(p)} />
                </div>
              </div>
            );
          })}
        </Card>
      )}

      {/* Collapsible Archives strip — the reference's left-rail affordance,
          adapted to reuse the existing active/archived tab state rather than
          introducing a second, parallel "is it archived" flag. */}
      {tab === "active" && !loading && (
        <button
          onClick={() => setTab("archived")}
          data-tour="projects-archives"
          className="mt-4 flex w-full items-center gap-2 rounded-xl border border-dashed border-border px-4 py-3 text-left text-[13px] font-medium text-muted transition hover:border-border-strong hover:text-ink"
        >
          <Chevron open={false} />
          Archives
        </button>
      )}

      {assigningFor && (
        <AssignMembersDialog
          project={assigningFor}
          members={members}
          onClose={() => setAssigningFor(null)}
          onSave={(userIds) => saveAssignment(assigningFor, userIds)}
        />
      )}

      {confirmingDelete && pickedProjects.length > 0 && (
        <ConfirmDeleteDialog
          projects={pickedProjects}
          onCancel={() => setConfirmingDelete(false)}
          onConfirm={() => runBulk("delete")}
          onArchiveInstead={() => runBulk("archive")}
        />
      )}
    </div>
  );
}

