"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { api } from "@/lib/api";
import type { Project, Task } from "@/lib/types";
import { Badge, Button, Card, Input, PageHeader, Skeleton } from "@/components/ui";
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

export default function ProjectDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);

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
      <div className="mb-4 text-sm">
        <Link href="/app/projects" className="text-muted hover:text-ink hover:underline">
          &larr; Back to projects
        </Link>
      </div>
      <PageHeader 
        title={project.name} 
        subtitle={project.clientTag || "Project workspace"} 
        actions={project.archivedAt ? <Badge tone="muted">Archived</Badge> : undefined}
      />
      <ProjectBoard project={project} onChange={load} archived={!!project.archivedAt} />
    </div>
  );
}

function ProjectBoard({ project, onChange, archived }: { project: Project; onChange: () => void; archived: boolean }) {
  const [title, setTitle] = useState("");
  const [adding, setAdding] = useState(false);
  const [menu, setMenu] = useState(false);

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
  async function move(t: Task, dir: 1 | -1) {
    const order: Task["status"][] = ["todo", "in_progress", "done"];
    const idx = order.indexOf(t.status);
    const next = order[Math.min(order.length - 1, Math.max(0, idx + dir))];
    if (next === t.status) return;
    await api(`/tasks/${t.id}`, { method: "PATCH", body: JSON.stringify({ status: next }) });
    await onChange();
  }
  async function cyclePriority(t: Task) {
    const order: Task["priority"][] = ["lowest", "normal", "urgent"];
    const next = order[(order.indexOf(t.priority) + 1) % order.length];
    await api(`/tasks/${t.id}`, { method: "PATCH", body: JSON.stringify({ priority: next }) });
    await onChange();
  }
  async function archiveToggle() {
    await api(`/projects/${project.id}`, { method: "PATCH", body: JSON.stringify({ archived: !archived }) });
    setMenu(false);
    await onChange();
  }
  async function delTask(t: Task) {
    await api(`/tasks/${t.id}`, { method: "DELETE" });
    await onChange();
  }

  return (
    <Card className="p-5">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-lg">Task Board</h2>
        </div>
        <div className="relative flex items-center gap-2">
          <Badge>{project.tasks?.length ?? 0} tasks</Badge>
          <button onClick={() => setMenu((m) => !m)} className="rounded-lg px-2 py-1 text-muted hover:bg-canvas" aria-label="Actions">
            ⋯
          </button>
          <AnimatePresence>
            {menu && (
              <motion.div
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                className="absolute right-0 top-9 z-10 w-40 overflow-hidden rounded-lg border border-border bg-surface shadow-lg"
              >
                <button onClick={archiveToggle} className="block w-full px-4 py-2 text-left text-sm hover:bg-canvas">
                  {archived ? "Unarchive" : "Archive"}
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {COLUMNS.map((col) => {
          const items = (project.tasks ?? []).filter((t) => t.status === col.key);
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
                        <button onClick={() => delTask(t)} className="text-muted opacity-0 transition hover:text-[var(--color-negative)] group-hover:opacity-100" aria-label="Delete">
                          ×
                        </button>
                      </div>
                      <div className="mt-2 flex items-center justify-between">
                        <button onClick={() => cyclePriority(t)} title="Change priority">
                          <Badge tone={PRIORITY[t.priority].tone} dot>{PRIORITY[t.priority].label}</Badge>
                        </button>
                        {t.dueDate && <span className="text-[11px] text-muted">⚑ {formatDate(t.dueDate)}</span>}
                      </div>
                      <div className="mt-2 flex gap-1 border-t border-border/60 pt-2">
                        <button onClick={() => move(t, -1)} disabled={col.key === "todo"} className="rounded px-1.5 text-xs text-muted hover:bg-canvas disabled:opacity-30" aria-label="Move left">←</button>
                        <button onClick={() => move(t, 1)} disabled={col.key === "done"} className="rounded px-1.5 text-xs text-muted hover:bg-canvas disabled:opacity-30" aria-label="Move right">→</button>
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

      {!archived && (
        <form onSubmit={addTask} className="mt-3 flex gap-2">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Add a task…" required />
          <Button variant="ghost" type="submit" disabled={adding}>
            Add
          </Button>
        </form>
      )}
    </Card>
  );
}
