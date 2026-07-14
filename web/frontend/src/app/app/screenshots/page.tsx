"use client";

import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Badge, Card, EmptyState, PageHeader, Skeleton } from "@/components/ui";
import { DateRange, MemberFilter, FilterBar, Pagination, paginate, rangeToParams, type DateRangeValue } from "@/components/filters";
import { formatTime, formatDate } from "@/lib/format";

interface Shot {
  id: string;
  takenAt: string;
  monitorIndex: number;
  blurred: boolean;
  activityPct: number;
  member: string;
  project: string;
  url: string | null;
}

const PER_PAGE = 18;

function ActivityBar({ pct }: { pct: number }) {
  const color = pct >= 60 ? "bg-[var(--color-positive)]" : pct >= 30 ? "bg-accent" : "bg-border-strong";
  return (
    <div className="h-1 w-full rounded-full bg-canvas overflow-hidden">
      <div className={`h-full rounded-full transition-all duration-500 ${color}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

export default function ScreenshotsPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "owner" || user?.role === "admin";
  const [shots, setShots] = useState<Shot[]>([]);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState<DateRangeValue>({ type: "preset", preset: "week" });
  const [member, setMember] = useState("");
  const [page, setPage] = useState(0);
  const [lightbox, setLightbox] = useState<Shot | null>(null);
  const [view, setView] = useState<"grid" | "list">("grid");

  const load = useCallback(() => {
    setLoading(true);
    const { from, to } = rangeToParams(range);
    const qs = new URLSearchParams();
    if (from) qs.set("from", from);
    if (to) qs.set("to", to);
    if (member) qs.set("userId", member);
    api<Shot[]>(`/screenshots?${qs.toString()}`)
      .then(setShots)
      .catch(() => setShots([]))
      .finally(() => setLoading(false));
  }, [range, member]);

  useEffect(() => { load(); setPage(0); }, [load]);

  async function del(id: string) {
    await api(`/screenshots/${id}`, { method: "DELETE" });
    setShots((s) => s.filter((x) => x.id !== id));
    setLightbox(null);
  }

  const pageShots = paginate(shots, page, PER_PAGE);
  const onlineCount = shots.filter((s) => s.activityPct >= 50).length;

  return (
    <div>
      <PageHeader
        title="Screenshots"
        subtitle={isAdmin ? "Review captured screenshots across your team" : "Your captured screenshots"}
        actions={
          <div className="flex items-center gap-2">
            <button
              onClick={() => setView("grid")}
              className={`rounded-lg p-2 transition ${view === "grid" ? "bg-brand text-white" : "border border-border text-muted hover:bg-canvas"}`}
              title="Grid view"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
                <rect x="0" y="0" width="6" height="6" rx="1.5" />
                <rect x="8" y="0" width="6" height="6" rx="1.5" />
                <rect x="0" y="8" width="6" height="6" rx="1.5" />
                <rect x="8" y="8" width="6" height="6" rx="1.5" />
              </svg>
            </button>
            <button
              onClick={() => setView("list")}
              className={`rounded-lg p-2 transition ${view === "list" ? "bg-brand text-white" : "border border-border text-muted hover:bg-canvas"}`}
              title="List view"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
                <rect x="0" y="1" width="14" height="2" rx="1" />
                <rect x="0" y="6" width="14" height="2" rx="1" />
                <rect x="0" y="11" width="14" height="2" rx="1" />
              </svg>
            </button>
          </div>
        }
      />

      <FilterBar>
        <DateRange value={range} onChange={setRange} />
        <MemberFilter value={member} onChange={setMember} enabled={isAdmin} />
        {shots.length > 0 && (
          <span className="ml-auto text-[13px] text-muted">
            {shots.length} screenshot{shots.length !== 1 ? "s" : ""}
          </span>
        )}
      </FilterBar>

      {loading ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
          {Array.from({ length: 12 }).map((_, i) => (
            <Skeleton key={i} className="aspect-video rounded-xl" />
          ))}
        </div>
      ) : shots.length === 0 ? (
        <EmptyState
          icon="🖼"
          title="No screenshots in this range"
          hint="They appear automatically once the desktop tracker captures them while a member is tracking."
        />
      ) : (
        <>
          {/* ── Grid view ── */}
          {view === "grid" && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
              {pageShots.map((s, i) => (
                <motion.div
                  key={s.id}
                  initial={{ opacity: 0, scale: 0.96 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ duration: 0.2, delay: (i % PER_PAGE) * 0.02 }}
                >
                  <Card className="group overflow-hidden cursor-pointer hover:shadow-[var(--shadow-lift)] transition-shadow" hover>
                    {/* Thumbnail */}
                    <button onClick={() => setLightbox(s)} className="relative block w-full aspect-video bg-canvas">
                      {s.url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={s.url}
                          alt="screenshot"
                          className={`h-full w-full object-cover transition group-hover:scale-[1.02] ${s.blurred ? "blur-sm" : ""}`}
                        />
                      ) : (
                        <div className="flex h-full items-center justify-center text-xs text-faint">No image</div>
                      )}
                      {/* Activity badge overlay */}
                      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent px-2 pb-1.5 pt-4 opacity-0 group-hover:opacity-100 transition">
                        <ActivityBar pct={Math.round(s.activityPct)} />
                      </div>
                      <span className="absolute left-1.5 top-1.5">
                        <span className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-bold text-white ${s.activityPct >= 50 ? "bg-[var(--color-positive)]" : "bg-black/50"}`}>
                          {Math.round(s.activityPct)}%
                        </span>
                      </span>
                    </button>
                    {/* Footer */}
                    <div className="px-2.5 py-2">
                      <div className="truncate text-[12px] font-semibold text-ink">{s.project}</div>
                      <div className="truncate text-[10px] text-muted">
                        {isAdmin && `${s.member.split("@")[0]} · `}{formatTime(s.takenAt)}
                      </div>
                      {isAdmin && (
                        <button
                          onClick={(e) => { e.stopPropagation(); del(s.id); }}
                          className="mt-1 text-[10px] text-faint hover:text-[var(--color-negative)] transition opacity-0 group-hover:opacity-100"
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  </Card>
                </motion.div>
              ))}
            </div>
          )}

          {/* ── List view ── */}
          {view === "list" && (
            <Card className="overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-canvas/30 text-[11px] font-semibold uppercase tracking-wide text-muted">
                      <th className="px-5 py-3 text-left w-20">Preview</th>
                      <th className="px-4 py-3 text-left">Project</th>
                      {isAdmin && <th className="px-4 py-3 text-left">Member</th>}
                      <th className="px-4 py-3 text-left">Date</th>
                      <th className="px-4 py-3 text-left">Time</th>
                      <th className="px-4 py-3 text-left w-36">Activity</th>
                      <th className="px-4 py-3 text-center w-16">Monitor</th>
                      {isAdmin && <th className="px-4 py-3 text-center w-16"></th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {pageShots.map((s) => (
                      <tr key={s.id} className="hover:bg-canvas/40 transition group">
                        <td className="px-5 py-3">
                          <button
                            onClick={() => setLightbox(s)}
                            className="block h-10 w-16 overflow-hidden rounded-lg bg-canvas ring-1 ring-border hover:ring-brand transition"
                          >
                            {s.url ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={s.url} alt="" className={`h-full w-full object-cover ${s.blurred ? "blur-sm" : ""}`} />
                            ) : (
                              <div className="flex h-full items-center justify-center text-[9px] text-faint">N/A</div>
                            )}
                          </button>
                        </td>
                        <td className="px-4 py-3 font-medium">{s.project}</td>
                        {isAdmin && <td className="px-4 py-3 text-muted text-[12px]">{s.member.split("@")[0]}</td>}
                        <td className="px-4 py-3 text-muted text-[12px]">{formatDate(s.takenAt)}</td>
                        <td className="px-4 py-3 text-muted text-[12px]">{formatTime(s.takenAt)}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <div className="flex-1 h-1.5 rounded-full bg-canvas overflow-hidden">
                              <div
                                className={`h-full rounded-full ${s.activityPct >= 60 ? "bg-[var(--color-positive)]" : s.activityPct >= 30 ? "bg-accent" : "bg-border-strong"}`}
                                style={{ width: `${s.activityPct}%` }}
                              />
                            </div>
                            <span className="text-[12px] font-semibold text-muted w-8">{Math.round(s.activityPct)}%</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <Badge tone="muted">#{s.monitorIndex + 1}</Badge>
                        </td>
                        {isAdmin && (
                          <td className="px-4 py-3 text-center">
                            <button
                              onClick={() => del(s.id)}
                              className="text-faint hover:text-[var(--color-negative)] transition opacity-0 group-hover:opacity-100"
                              title="Delete"
                            >
                              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                                <path d="M2 3.5h10M5 3.5V2.5a.5.5 0 0 1 .5-.5h3a.5.5 0 0 1 .5.5v1M5.5 6v4.5M8.5 6v4.5M3 3.5l.7 8a.5.5 0 0 0 .5.5h5.6a.5.5 0 0 0 .5-.5l.7-8" />
                              </svg>
                            </button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          <Pagination page={page} pageSize={PER_PAGE} total={shots.length} onPage={setPage} />
        </>
      )}

      {/* Lightbox */}
      <AnimatePresence>
        {lightbox && (
          <motion.div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setLightbox(null)}
          >
            <motion.div
              className="relative max-h-[90vh] max-w-5xl w-full overflow-hidden rounded-2xl bg-surface shadow-2xl"
              initial={{ scale: 0.94, y: 16 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.94, y: 16 }}
              transition={{ type: "spring", damping: 24, stiffness: 260 }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Close */}
              <button
                onClick={() => setLightbox(null)}
                className="absolute right-4 top-4 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-black/50 text-white hover:bg-black/70 transition"
              >
                ×
              </button>

              {lightbox.url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={lightbox.url}
                  alt="screenshot"
                  className={`max-h-[75vh] w-full object-contain ${lightbox.blurred ? "blur-md" : ""}`}
                />
              ) : (
                <div className="flex h-64 items-center justify-center text-muted">Image unavailable</div>
              )}

              <div className="flex items-center justify-between border-t border-border px-5 py-4">
                <div className="flex items-center gap-4">
                  <div>
                    <div className="font-semibold text-[14px]">{lightbox.project}</div>
                    <div className="text-[12px] text-muted">
                      {isAdmin && `${lightbox.member} · `}
                      {formatDate(lightbox.takenAt)} at {formatTime(lightbox.takenAt)} · Monitor {lightbox.monitorIndex + 1}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 rounded-full bg-canvas px-3 py-1.5">
                    <div className={`h-2 w-2 rounded-full ${lightbox.activityPct >= 50 ? "bg-[var(--color-positive)]" : "bg-border-strong"}`} />
                    <span className="text-[12px] font-semibold">{Math.round(lightbox.activityPct)}% active</span>
                  </div>
                </div>
                {isAdmin && (
                  <button
                    onClick={() => del(lightbox.id)}
                    className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-[12px] font-medium text-[var(--color-negative)] hover:bg-canvas transition"
                  >
                    Delete screenshot
                  </button>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
