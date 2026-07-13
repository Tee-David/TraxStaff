"use client";

import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { api } from "@/lib/api";
import type { Project, Task } from "@/lib/types";
import { Badge, Button, Card, Input, Label } from "@/components/ui";
import { FilterBar, SearchInput } from "@/components/filters";

type Tab = "active" | "archived";
const COLUMNS: { key: Task["status"]; label: string; tone: "muted" | "brand" | "green" }[] = [
  { key: "todo", label: "To Do", tone: "muted" },
  { key: "in_progress", label: "In Progress", tone: "brand" },
  { key: "done", label: "Done", tone: "green" },
];

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("active");
  const [search, setSearch] = useState("");
  const [name, setName] = useState("");
  const [clientTag, setClientTag] = useState("");
  const [creating, setCreating] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    api<Project[]>(`/projects${tab === "archived" ? "?archived=1" : ""}`)
      .then(setProjects)
      .catch(() => setProjects([]))
      .finally(() => setLoading(false));
  }, [tab]);

  useEffect(() => {
    load();
  }, [load]);

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

  const visible = projects.filter((p) => p.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-2xl">Projects</h1>
        <p className="text-sm text-muted">Manage projects and their task boards</p>
      </div>

      <FilterBar>
        <div className="inline-flex rounded-lg border border-border bg-surface p-0.5">
          {(["active", "archived"] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium capitalize transition ${
                tab === t ? "bg-brand text-brand-fg" : "text-muted hover:text-ink"
              }`}
            >
              {t}
            </button>
          ))}
        </div>
        <SearchInput value={search} onChange={setSearch} placeholder="Search projects…" />
      </FilterBar>

      {tab === "active" && (
        <Card className="mb-6 p-5">
          <form onSubmit={createProject} className="flex flex-wrap items-end gap-3">
            <div className="min-w-48 flex-1">
              <Label>Project name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Deo Marketing" required />
            </div>
            <div className="min-w-40 flex-1">
              <Label>Client tag (optional)</Label>
              <Input value={clientTag} onChange={(e) => setClientTag(e.target.value)} placeholder="Acme Inc." />
            </div>
            <Button type="submit" disabled={creating}>
              {creating ? "Adding…" : "Add project"}
            </Button>
          </form>
        </Card>
      )}

      {loading ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : visible.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted">No {tab} projects{search ? " match your search" : ""}.</Card>
      ) : (
        <div className="space-y-5">
          {visible.map((p) => (
            <ProjectBoard key={p.id} project={p} onChange={load} archived={tab === "archived"} />
          ))}
        </div>
      )}
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
          <h2 className="text-lg">{project.name}</h2>
          {project.clientTag && <div className="text-xs text-muted">{project.clientTag}</div>}
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
                      className="group rounded-lg border border-border bg-surface px-3 py-2 text-sm shadow-sm"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className={t.status === "done" ? "text-muted line-through" : ""}>{t.title}</span>
                        <button onClick={() => delTask(t)} className="opacity-0 transition group-hover:opacity-100 text-muted hover:text-red-600" aria-label="Delete">
                          ×
                        </button>
                      </div>
                      <div className="mt-1.5 flex gap-1">
                        <button onClick={() => move(t, -1)} disabled={col.key === "todo"} className="rounded px-1.5 text-xs text-muted hover:bg-canvas disabled:opacity-30">
                          ←
                        </button>
                        <button onClick={() => move(t, 1)} disabled={col.key === "done"} className="rounded px-1.5 text-xs text-muted hover:bg-canvas disabled:opacity-30">
                          →
                        </button>
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
