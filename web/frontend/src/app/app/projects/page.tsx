"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { Project, Task } from "@/lib/types";
import { Badge, Button, Card, Input, Label } from "@/components/ui";

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [clientTag, setClientTag] = useState("");
  const [creating, setCreating] = useState(false);

  async function load() {
    const data = await api<Project[]>("/projects");
    setProjects(data);
    setLoading(false);
  }

  useEffect(() => {
    load().catch(() => setLoading(false));
  }, []);

  async function createProject(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    try {
      await api<Project>("/projects", {
        method: "POST",
        body: JSON.stringify({ name, clientTag: clientTag || undefined }),
      });
      setName("");
      setClientTag("");
      await load();
    } finally {
      setCreating(false);
    }
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl">Projects</h1>
        <p className="text-sm text-muted">Manage projects and their tasks</p>
      </div>

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

      {loading ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : projects.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted">No projects yet.</Card>
      ) : (
        <div className="space-y-4">
          {projects.map((p) => (
            <ProjectCard key={p.id} project={p} onChange={load} />
          ))}
        </div>
      )}
    </div>
  );
}

function ProjectCard({ project, onChange }: { project: Project; onChange: () => Promise<void> }) {
  const [title, setTitle] = useState("");
  const [adding, setAdding] = useState(false);

  async function addTask(e: React.FormEvent) {
    e.preventDefault();
    setAdding(true);
    try {
      await api<Task>(`/projects/${project.id}/tasks`, {
        method: "POST",
        body: JSON.stringify({ title }),
      });
      setTitle("");
      await onChange();
    } finally {
      setAdding(false);
    }
  }

  async function cycleStatus(task: Task) {
    const next = task.status === "todo" ? "in_progress" : task.status === "in_progress" ? "done" : "todo";
    await api(`/tasks/${task.id}`, { method: "PATCH", body: JSON.stringify({ status: next }) });
    await onChange();
  }

  const statusTone = { todo: "muted", in_progress: "brand", done: "green" } as const;

  return (
    <Card className="p-5">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h2 className="text-lg">{project.name}</h2>
          {project.clientTag && <div className="text-xs text-muted">{project.clientTag}</div>}
        </div>
        <Badge>{project.tasks?.length ?? 0} tasks</Badge>
      </div>

      <div className="space-y-1.5">
        {(project.tasks ?? []).map((t) => (
          <button
            key={t.id}
            onClick={() => cycleStatus(t)}
            className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm hover:bg-canvas"
          >
            <span className={t.status === "done" ? "text-muted line-through" : ""}>{t.title}</span>
            <Badge tone={statusTone[t.status]}>{t.status.replace("_", " ")}</Badge>
          </button>
        ))}
      </div>

      <form onSubmit={addTask} className="mt-3 flex gap-2">
        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Add a task…" required />
        <Button variant="ghost" type="submit" disabled={adding}>
          Add
        </Button>
      </form>
    </Card>
  );
}
