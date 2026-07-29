"use client";

import { useCallback, useEffect, useState, useRef } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { api } from "@/lib/api";
import type { Project } from "@/lib/types";
import { Badge, Button, Card, EmptyState, Input } from "@/components/ui";
import { SearchInput } from "@/components/filters";
import { Select } from "@/components/Select";

const DOTS = ["var(--color-cat-focus)", "#ff6600", "#12b5a5", "#8a5cf6", "#e0457b"];

type Tab = "active" | "archived";

function ActionMenu({ project, onRefresh }: { project: Project, onRefresh: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  async function toggleArchive() {
    await api(`/projects/${project.id}`, { method: "PATCH", body: JSON.stringify({ archived: !project.archivedAt }) });
    setOpen(false);
    onRefresh();
  }

  return (
    <div className="relative inline-block text-left" ref={ref}>
      <button 
        onClick={() => setOpen(!open)}
        className="text-muted hover:text-ink hover:bg-canvas rounded-lg px-2 py-1 transition focus:outline-none focus:ring-2 focus:ring-brand"
      >
        ⋯
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: -10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -10 }}
            transition={{ duration: 0.15 }}
            className="absolute right-0 top-8 z-50 w-36 overflow-hidden rounded-xl border border-border bg-surface shadow-xl"
          >
            <div className="py-1">
              <Link
                href={`/app/projects/${project.id}`}
                className="block w-full px-4 py-2 text-left text-sm text-ink hover:bg-canvas transition"
              >
                View details
              </Link>
              <button 
                onClick={toggleArchive} 
                className="block w-full px-4 py-2 text-left text-sm text-ink hover:bg-canvas transition"
              >
                {project.archivedAt ? "Unarchive" : "Archive"}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("active");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("newest");
  
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
            <table className="w-full text-left border-collapse min-w-[800px]">
              <thead>
                <tr className="border-b border-border/80 bg-canvas/30 text-[12px] font-semibold text-ink">
                  <th className="px-6 py-4">Name</th>
                  <th className="px-4 py-4 w-32">Status</th>
                  <th className="px-4 py-4 w-64">Summary</th>
                  <th className="px-4 py-4 w-48">Progress</th>
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
                      <td className="px-4 py-4 text-center">
                        <ActionMenu project={p} onRefresh={load} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

