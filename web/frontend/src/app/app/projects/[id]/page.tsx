"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { api } from "@/lib/api";
import type { Project, Session, Task } from "@/lib/types";
import { Badge, Button, Card, Input, Modal, ModalCard, Skeleton } from "@/components/ui";
import { Select } from "@/components/Select";
import { WorkloadCard, workloadCounts } from "@/components/WorkloadCard";
import { TimesheetCard, weekdayHoursFromSessions } from "@/components/TimesheetCard";
import { rangeToParams } from "@/components/filters";
import { formatDate } from "@/lib/format";
import Link from "next/link";

const PRIORITY = {
  urgent: { label: "Urgent", tone: "red" as const },
  normal: { label: "Normal", tone: "muted" as const },
  lowest: { label: "Lowest", tone: "green" as const },
};

const COLUMNS: { key: Task["status"]; label: string; tone: "muted" | "brand" | "green" }[] = [
  { key: "todo", label: "To Do", tone: "muted" },
  { key: "in_progress", label: "In Progress", tone: "brand" },
  { key: "done", label: "Done", tone: "green" },
];

/** status -> Lists-table progress percentage, matching the same rollup math
 * the project list page uses for its own progress bar (done/total). */
function statusProgressPct(status: Task["status"]): number {
  if (status === "done") return 100;
  if (status === "in_progress") return 50;
  return 0;
}

export default function ProjectDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [menu, setMenu] = useState(false);
  const menuBtnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const load = useCallback(() => {
    setLoading(true);
    api<Project>(`/projects/${id}`)
      .then(setProject)
      .catch(() => router.push("/app/projects"))
      .finally(() => setLoading(false));
  }, [id, router]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!menu) return;
    function outside(e: MouseEvent) {
      const t = e.target as Node;
      if (!menuBtnRef.current?.contains(t) && !menuRef.current?.contains(t)) setMenu(false);
    }
    document.addEventListener("mousedown", outside);
    return () => document.removeEventListener("mousedown", outside);
  }, [menu]);

  async function archiveToggle() {
    if (!project) return;
    await api(`/projects/${project.id}`, { method: "PATCH", body: JSON.stringify({ archived: !project.archivedAt }) });
    setMenu(false);
    await load();
  }

  async function share() {
    setMenu(false);
    try {
      await navigator.clipboard.writeText(window.location.href);
    } catch {
      /* clipboard unavailable — silently no-op, nothing to preserve/regress here */
    }
  }

  if (loading) {
    return (
      <div>
        <Skeleton className="mb-6 h-20" />
        <Skeleton className="h-96" />
      </div>
    );
  }

  if (!project) return null;

  return (
    <div>
      {/* Breadcrumb */}
      <div className="mb-3 flex items-center gap-1.5 text-sm text-muted">
        <Link href="/app/projects" className="hover:text-ink hover:underline">
          Projects
        </Link>
        <span>/</span>
        <span className="text-ink font-medium">{project.name}</span>
      </div>

      {/* Header: name + Share / "…" menu */}
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="font-heading text-[26px] font-bold leading-tight text-ink">{project.name}</h1>
            {project.archivedAt && <Badge tone="muted">Archived</Badge>}
          </div>
          <p className="mt-0.5 text-sm text-muted">{project.clientTag || "Project workspace"}</p>
        </div>
        <div className="relative flex items-center gap-2">
          <Button variant="ghost" onClick={share}>
            Share
          </Button>
          <button
            ref={menuBtnRef}
            onClick={() => setMenu((m) => !m)}
            className="rounded-lg px-2.5 py-2 text-muted hover:bg-canvas hover:text-ink transition"
            aria-label="Project actions"
            aria-expanded={menu}
          >
            ⋯
          </button>
          <AnimatePresence>
            {menu && (
              <motion.div
                ref={menuRef}
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                className="absolute right-0 top-11 z-20 w-44 overflow-hidden rounded-xl border border-border bg-surface shadow-xl"
              >
                <button onClick={archiveToggle} className="block w-full px-4 py-2 text-left text-sm text-ink hover:bg-canvas transition">
                  {project.archivedAt ? "Unarchive project" : "Archive project"}
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      <Overview project={project} />

      <TaskLists project={project} onChange={load} archived={!!project.archivedAt} />
    </div>
  );
}

/** Overview: Workload + Timesheet summary cards for this project's tasks and
 * the current viewer's tracked hours against it. */
function Overview({ project }: { project: Project }) {
  const [weekPreset, setWeekPreset] = useState<"week" | "last_week">("week");
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loadingHours, setLoadingHours] = useState(true);

  useEffect(() => {
    setLoadingHours(true);
    const { from, to } = rangeToParams({ type: "preset", preset: weekPreset });
    const qs = new URLSearchParams();
    if (from) qs.set("from", from);
    if (to) qs.set("to", to);
    // /sessions always scopes to the caller's own time (see web/backend
    // src/routes/sessions.ts — there's no team-wide listing endpoint), so this
    // reflects the viewer's own hours on the project, same as Timesheets.
    // Filtered to this project client-side; no backend change needed.
    api<Session[]>(`/sessions?${qs.toString()}`)
      .then((rows) => setSessions(rows.filter((s) => s.projectId === project.id)))
      .catch(() => setSessions([]))
      .finally(() => setLoadingHours(false));
  }, [project.id, weekPreset]);

  const counts = useMemo(() => workloadCounts(project.tasks ?? []), [project.tasks]);
  const weekdayHours = useMemo(() => weekdayHoursFromSessions(sessions), [sessions]);

  return (
    <div className="mb-6">
      <h2 className="mb-3 text-[13px] font-semibold uppercase tracking-wide text-faint">Overview</h2>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <WorkloadCard counts={counts} />
        {loadingHours ? (
          <Skeleton className="h-56" />
        ) : (
          <TimesheetCard
            data={weekdayHours}
            action={
              <div className="w-32">
                <Select
                  value={weekPreset}
                  onChange={(v) => setWeekPreset(v as "week" | "last_week")}
                  options={[
                    { value: "week", label: "This Week" },
                    { value: "last_week", label: "Last Week" },
                  ]}
                />
              </div>
            }
          />
        )}
      </div>
    </div>
  );
}

type SortKey = "created" | "due" | "priority";
type ViewMode = "list" | "board";

/** Row "…" menu for the Lists table — status change + delete, portalled to
 * document.body via the same fixed-rect technique as the projects list page's
 * ActionMenu (same clipping problem, same fix: this table can scroll, and an
 * absolutely positioned child can't escape an ancestor's overflow). */
function TaskRowMenu({ task, onSetStatus, onDelete }: { task: Task; onSetStatus: (s: Task["status"]) => void; onDelete: () => void }) {
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
    document.addEventListener("mousedown", outside);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", outside);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const MENU_WIDTH = 170;
  const pos = rect
    ? {
        left: Math.max(8, Math.min(rect.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - 8)),
        top: rect.bottom + 8 + 180 > window.innerHeight ? undefined : rect.bottom + 8,
        bottom: rect.bottom + 8 + 180 > window.innerHeight ? window.innerHeight - rect.top + 8 : undefined,
      }
    : null;

  return (
    <>
      <button
        ref={btnRef}
        onClick={() => setRect(open ? null : (btnRef.current?.getBoundingClientRect() ?? null))}
        className="text-muted hover:text-ink hover:bg-canvas rounded-lg px-2 py-1 transition"
        aria-expanded={open}
        aria-label="Task actions"
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
                  {COLUMNS.map((col) => (
                    <button
                      key={col.key}
                      onClick={() => { setRect(null); onSetStatus(col.key); }}
                      disabled={task.status === col.key}
                      className="block w-full px-4 py-2 text-left text-sm text-ink hover:bg-canvas transition disabled:opacity-40"
                    >
                      Mark {col.label}
                    </button>
                  ))}
                  <div className="my-1 border-t border-border/60" />
                  <button
                    onClick={() => { setRect(null); onDelete(); }}
                    className="block w-full px-4 py-2 text-left text-sm text-[var(--color-negative)] hover:bg-canvas transition"
                  >
                    Delete
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

function TaskLists({ project, onChange, archived }: { project: Project; onChange: () => void; archived: boolean }) {
  const [title, setTitle] = useState("");
  const [adding, setAdding] = useState(false);
  const [view, setView] = useState<ViewMode>("list");
  const [sortKey, setSortKey] = useState<SortKey>("created");
  const [deleteConfirm, setDeleteConfirm] = useState<Task | null>(null); // Task pending confirmation to delete
  const [deleting, setDeleting] = useState(false);

  async function addTask(e: React.FormEvent) {
    e.preventDefault();
    setAdding(true);
    try {
      await api(`/projects/${project.id}/tasks`, { method: "POST", body: JSON.stringify({ title }) });
      setTitle("");
      await onChange();
    } finally {
      setAdding(false);
    }
  }
  async function setStatus(t: Task, status: Task["status"]) {
    await api(`/tasks/${t.id}`, { method: "PATCH", body: JSON.stringify({ status }) });
    await onChange();
  }
  async function move(t: Task, dir: 1 | -1) {
    const order: Task["status"][] = ["todo", "in_progress", "done"];
    const idx = order.indexOf(t.status);
    const next = order[Math.min(order.length - 1, Math.max(0, idx + dir))];
    if (next === t.status) return;
    await setStatus(t, next);
  }
  async function cyclePriority(t: Task) {
    const order: Task["priority"][] = ["lowest", "normal", "urgent"];
    const next = order[(order.indexOf(t.priority) + 1) % order.length];
    await api(`/tasks/${t.id}`, { method: "PATCH", body: JSON.stringify({ priority: next }) });
    await onChange();
  }
  async function confirmDelete(t: Task) {
    setDeleting(true);
    try {
      await api(`/tasks/${t.id}`, { method: "DELETE" });
      await onChange();
    } finally {
      setDeleting(false);
      setDeleteConfirm(null);
    }
  }
  // Request confirmation before deleting (don't delete immediately).
  async function delTask(t: Task) {
    setDeleteConfirm(t);
  }

  const priorityOrder: Record<Task["priority"], number> = { urgent: 0, normal: 1, lowest: 2 };
  const tasks = useMemo(() => {
    const list = [...(project.tasks ?? [])];
    if (sortKey === "created") return list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    if (sortKey === "due") return list.sort((a, b) => {
      if (!a.dueDate && !b.dueDate) return 0;
      if (!a.dueDate) return 1;
      if (!b.dueDate) return -1;
      return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
    });
    return list.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);
  }, [project.tasks, sortKey]);

  function exportCsv() {
    const rows = [
      ["Name", "Start", "End", "Priority", "Status", "Progress"],
      ...tasks.map((t) => [
        t.title,
        formatDate(t.createdAt),
        t.dueDate ? formatDate(t.dueDate) : "",
        PRIORITY[t.priority].label,
        t.status,
        `${statusProgressPct(t.status)}%`,
      ]),
    ];
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${project.name.replace(/\s+/g, "-").toLowerCase()}-tasks.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-[13px] font-semibold uppercase tracking-wide text-faint">Lists</h2>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="ghost" onClick={exportCsv} disabled={tasks.length === 0}>
            ↓ Export
          </Button>
          <div className="w-36">
            <Select
              value={sortKey}
              onChange={(v) => setSortKey(v as SortKey)}
              options={[
                { value: "created", label: "Sort: Newest" },
                { value: "due", label: "Sort: Due date" },
                { value: "priority", label: "Sort: Priority" },
              ]}
            />
          </div>
          <div className="inline-flex rounded-lg border border-border bg-surface p-1 shadow-sm">
            {(["list", "board"] as ViewMode[]).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`rounded-md px-3 py-1 text-[12px] font-semibold capitalize transition ${
                  view === v ? "bg-canvas text-ink shadow-[var(--shadow-soft)]" : "text-muted hover:text-ink"
                }`}
              >
                {v}
              </button>
            ))}
          </div>
        </div>
      </div>

      {!archived && (
        <form onSubmit={addTask} className="mb-4 flex gap-2">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Add a task…" required />
          <Button variant="ghost" type="submit" disabled={adding}>
            Add
          </Button>
        </form>
      )}

      {view === "list" ? (
        <ListsTable
          tasks={tasks}
          onCyclePriority={cyclePriority}
          onSetStatus={setStatus}
          onDelete={delTask}
        />
      ) : (
        <Board tasks={tasks} onMove={move} onCyclePriority={cyclePriority} onDelete={delTask} />
      )}

      {/* Delete task confirmation dialog */}
      {deleteConfirm && (
        <Modal
          label="Delete task"
          onClose={() => setDeleteConfirm(null)}
          busy={deleting}
          size="sm"
        >
          <ModalCard>
            <h2 className="font-heading text-[15px] font-semibold text-ink">Delete task?</h2>
            <p className="mt-1 text-[12px] text-muted">
              Delete &ldquo;{deleteConfirm.title}&rdquo;? This cannot be undone. Any sessions
              assigned to this task keep their tracked time but lose the task reference.
            </p>
            <div className="mt-6 flex flex-wrap justify-end gap-2">
              <Button variant="ghost" onClick={() => setDeleteConfirm(null)} disabled={deleting}>
                Cancel
              </Button>
              <Button variant="danger" onClick={() => confirmDelete(deleteConfirm)} disabled={deleting}>
                {deleting ? "Deleting…" : "Delete"}
              </Button>
            </div>
          </ModalCard>
        </Modal>
      )}
    </div>
  );
}

function ListsTable({
  tasks,
  onCyclePriority,
  onSetStatus,
  onDelete,
}: {
  tasks: Task[];
  onCyclePriority: (t: Task) => void;
  onSetStatus: (t: Task, status: Task["status"]) => void;
  onDelete: (t: Task) => void;
}) {
  if (tasks.length === 0) {
    return (
      <Card className="flex flex-col items-center justify-center px-6 py-14 text-center">
        <p className="text-sm text-muted">No tasks yet — add one above.</p>
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden border border-border shadow-[var(--shadow-soft)]">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-left border-collapse">
          <thead>
            <tr className="border-b border-border/80 bg-canvas/30 text-[11px] font-semibold uppercase tracking-wide text-faint">
              <th className="w-10 px-5 py-3" />
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3 w-32">Start</th>
              <th className="px-4 py-3 w-32">End</th>
              <th className="px-4 py-3 w-32">Priority</th>
              <th className="px-4 py-3 w-40">Progress</th>
              <th className="w-10 px-4 py-3" />
            </tr>
          </thead>
          <tbody className="text-sm">
            {tasks.map((t) => {
              const pct = statusProgressPct(t.status);
              return (
                <tr key={t.id} className="border-b border-border/60 last:border-0 hover:bg-canvas/40 transition">
                  <td className="px-5 py-3">
                    <input
                      type="checkbox"
                      checked={t.status === "done"}
                      onChange={() => onSetStatus(t, t.status === "done" ? "todo" : "done")}
                      className="h-4 w-4 rounded border-border accent-brand"
                      aria-label={t.status === "done" ? "Mark as to-do" : "Mark as done"}
                    />
                  </td>
                  <td className="px-4 py-3">
                    <span className={t.status === "done" ? "text-muted line-through" : "font-medium text-ink"}>{t.title}</span>
                  </td>
                  <td className="px-4 py-3 text-muted">{formatDate(t.createdAt)}</td>
                  <td className="px-4 py-3 text-muted">{t.dueDate ? formatDate(t.dueDate) : "—"}</td>
                  <td className="px-4 py-3">
                    <button onClick={() => onCyclePriority(t)} title="Change priority">
                      <Badge tone={PRIORITY[t.priority].tone} dot>{PRIORITY[t.priority].label}</Badge>
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-border">
                        <div
                          className="h-full rounded-full transition-all duration-500"
                          style={{
                            width: `${pct}%`,
                            backgroundColor: pct === 100 ? "var(--color-positive)" : pct > 0 ? "var(--color-brand)" : "var(--color-faint)",
                          }}
                        />
                      </div>
                      <span className="w-8 shrink-0 text-[12px] font-semibold text-muted">{pct}%</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <TaskRowMenu task={t} onSetStatus={(s) => onSetStatus(t, s)} onDelete={() => onDelete(t)} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function Board({
  tasks,
  onMove,
  onCyclePriority,
  onDelete,
}: {
  tasks: Task[];
  onMove: (t: Task, dir: 1 | -1) => void;
  onCyclePriority: (t: Task) => void;
  onDelete: (t: Task) => void;
}) {
  return (
    <Card className="p-5">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {COLUMNS.map((col) => {
          const items = tasks.filter((t) => t.status === col.key);
          return (
            <div key={col.key} className="rounded-xl bg-canvas p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted">{col.label}</span>
                <Badge tone={col.tone}>{items.length}</Badge>
              </div>
              <div className="space-y-2">
                <AnimatePresence>
                  {items.map((t) => (
                    <motion.div
                      key={t.id}
                      layout
                      initial={{ opacity: 0, scale: 0.96 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.96 }}
                      className="group rounded-xl border border-border bg-surface px-3 py-2.5 text-sm shadow-[var(--shadow-soft)]"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className={t.status === "done" ? "text-muted line-through" : "font-medium"}>{t.title}</span>
                        <button onClick={() => onDelete(t)} className="text-muted opacity-0 transition hover:text-[var(--color-negative)] group-hover:opacity-100" aria-label="Delete">
                          ×
                        </button>
                      </div>
                      <div className="mt-2 flex items-center justify-between">
                        <button onClick={() => onCyclePriority(t)} title="Change priority">
                          <Badge tone={PRIORITY[t.priority].tone} dot>{PRIORITY[t.priority].label}</Badge>
                        </button>
                        {t.dueDate && <span className="text-[11px] text-muted">⚑ {formatDate(t.dueDate)}</span>}
                      </div>
                      <div className="mt-2 flex gap-1 border-t border-border/60 pt-2">
                        <button onClick={() => onMove(t, -1)} disabled={col.key === "todo"} className="rounded px-1.5 text-xs text-muted hover:bg-canvas disabled:opacity-30" aria-label="Move left">←</button>
                        <button onClick={() => onMove(t, 1)} disabled={col.key === "done"} className="rounded px-1.5 text-xs text-muted hover:bg-canvas disabled:opacity-30" aria-label="Move right">→</button>
                      </div>
                    </motion.div>
                  ))}
                </AnimatePresence>
                {items.length === 0 && <p className="px-1 py-2 text-xs text-muted">—</p>}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
