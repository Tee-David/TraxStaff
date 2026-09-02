"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useAuth } from "@/lib/auth";
import { useInfiniteList } from "@/lib/use-infinite";
import { useUrlState } from "@/lib/url-state";
import { useMotionPresets } from "@/lib/motion";
import { Badge, Card, EmptyState, PageHeader, Skeleton } from "@/components/ui";
import {
  DateRange,
  DensityControl,
  DENSITY_CLASS,
  DENSITIES,
  MemberFilter,
  FilterBar,
  rangeToParams,
  rangeToQuery,
  rangeFromQuery,
  type Density,
  type DateRangeValue,
} from "@/components/filters";
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
  /**
   * Whether the server sent an actual image. Admins always. Staff get their own
   * captures too, unless the org has blur switched on — blur is a policy flag
   * rather than a pixel operation, so honouring it means withholding the URL
   * outright (a presigned URL is the unblurred original).
   */
  viewable: boolean;
}

/**
 * Shown where an image is withheld rather than merely obscured.
 *
 * The label has to name the real reason. A member only ever lists their own
 * captures, so if one is locked for them it is because the org has blur turned
 * on — not because of their role. Saying "Admin only" there was simply untrue,
 * and it hid the fact that an admin can lift it with one setting.
 */
function LockedTile({ className = "", reason = "Admin only" }: { className?: string; reason?: string }) {
  return (
    <div className={`flex h-full w-full flex-col items-center justify-center gap-1 bg-canvas ${className}`}>
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-faint">
        <rect x="3" y="7" width="10" height="6.5" rx="1.5" />
        <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
      </svg>
      <span className="text-[9px] font-medium text-faint text-center leading-tight">{reason}</span>
    </div>
  );
}

const DEFAULT_RANGE: DateRangeValue = { type: "preset", preset: "week" };
// One request per scroll boundary. Matches the server's default page size.
const PAGE_SIZE = 48;

function ActivityBar({ pct }: { pct: number }) {
  const color = pct >= 60 ? "bg-[var(--color-positive)]" : pct >= 30 ? "bg-accent" : "bg-border-strong";
  return (
    <div className="h-1 w-full rounded-full bg-canvas overflow-hidden">
      <div className={`h-full rounded-full transition-all duration-500 ${color}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

/** Placeholders shown while the next page is in flight, so the grid keeps its shape. */
function ShotSkeletons({ count, className }: { count: number; className: string }) {
  return (
    <div className={`grid gap-3 ${className}`} aria-hidden>
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} className="aspect-video rounded-xl" />
      ))}
    </div>
  );
}

export default function ScreenshotsPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "owner" || user?.role === "admin";
  const m = useMotionPresets();

  const [q, setQ] = useUrlState({ range: "week", member: "", view: "grid", cols: "4" });

  const range = useMemo(() => rangeFromQuery(q.range, DEFAULT_RANGE), [q.range]);
  const view = q.view === "list" ? "list" : "grid";
  const cols = (DENSITIES.includes(Number(q.cols) as Density) ? Number(q.cols) : 4) as Density;
  const gridClass = DENSITY_CLASS[cols];

  const [lightbox, setLightbox] = useState<Shot | null>(null);

  // Rebuilt whenever a filter changes, which resets the infinite list.
  const buildPath = useCallback(
    (cursor: string | null) => {
      const { from, to } = rangeToParams(range);
      const params = new URLSearchParams();
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      // "All members" (the default) previously meant "whole org" with no
      // userId sent at all. The backend now defaults a privileged caller to
      // "just me" unless told otherwise, so ask explicitly when no specific
      // member is picked — otherwise an admin's own default view silently
      // narrows to their own screenshots.
      if (q.member) params.set("userId", q.member);
      else if (isAdmin) params.set("scope", "team");
      params.set("limit", String(PAGE_SIZE));
      if (cursor) params.set("cursor", cursor);
      return `/screenshots?${params.toString()}`;
    },
    [range, q.member, isAdmin]
  );

  const { items: shots, loading, loadingMore, error, done, sentinelRef } = useInfiniteList<Shot>(buildPath);

  // Escape closes the lightbox — it previously had no keyboard exit at all.
  useEffect(() => {
    if (!lightbox) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setLightbox(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightbox]);

  const viewButton = (kind: "grid" | "list", label: string, icon: React.ReactNode) => (
    <button
      onClick={() => setQ({ view: kind })}
      aria-pressed={view === kind}
      className={`rounded-lg p-2 transition ${view === kind ? "bg-brand text-white" : "border border-border text-muted hover:bg-canvas"}`}
      title={label}
    >
      {icon}
    </button>
  );

  return (
    <motion.div {...m.page}>
      <PageHeader
        title="Screenshots"
        subtitle={isAdmin ? "Review captured screenshots across your team" : "Your captured screenshots"}
        actions={
          <div className="flex items-center gap-2" data-tour="screenshots-view-toggle">
            {view === "grid" && <DensityControl value={cols} onChange={(d) => setQ({ cols: String(d) })} />}
            {viewButton(
              "grid",
              "Grid view",
              <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
                <rect x="0" y="0" width="6" height="6" rx="1.5" />
                <rect x="8" y="0" width="6" height="6" rx="1.5" />
                <rect x="0" y="8" width="6" height="6" rx="1.5" />
                <rect x="8" y="8" width="6" height="6" rx="1.5" />
              </svg>
            )}
            {viewButton(
              "list",
              "List view",
              <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
                <rect x="0" y="1" width="14" height="2" rx="1" />
                <rect x="0" y="6" width="14" height="2" rx="1" />
                <rect x="0" y="11" width="14" height="2" rx="1" />
              </svg>
            )}
          </div>
        }
      />

      <div data-tour="screenshots-filter">
        <FilterBar>
          <DateRange value={range} onChange={(v) => setQ({ range: rangeToQuery(v) })} />
          <MemberFilter value={q.member} onChange={(id) => setQ({ member: id })} enabled={isAdmin} />
          {shots.length > 0 && (
            <span className="ml-auto text-[13px] text-muted tnum">
              {shots.length} loaded{done ? "" : "…"}
            </span>
          )}
        </FilterBar>
      </div>

      {loading ? (
        <ShotSkeletons count={cols * 3} className={gridClass} />
      ) : error ? (
        <EmptyState icon="⚠" title="Couldn't load screenshots" hint={error} />
      ) : shots.length === 0 ? (
        <EmptyState
          icon="🖼"
          title="No screenshots in this range"
          hint="They appear automatically once the desktop tracker captures them while a member is tracking."
        />
      ) : (
        <div data-tour="screenshots-results">
          {/* ── Grid view ── */}
          {view === "grid" && (
            <motion.div key={`grid-${cols}`} className={`grid gap-3 ${gridClass}`} {...m.stagger()}>
              {shots.map((s) => (
                <motion.div key={s.id} {...m.item}>
                  <Card className="group overflow-hidden cursor-pointer hover:shadow-[var(--shadow-lift)] transition-shadow" hover>
                    <button
                      onClick={() => s.viewable && setLightbox(s)}
                      disabled={!s.viewable}
                      className="relative block w-full aspect-video bg-canvas disabled:cursor-default"
                    >
                      {s.url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={s.url}
                          alt="screenshot"
                          loading="lazy"
                          decoding="async"
                          className={`h-full w-full object-cover transition group-hover:scale-[1.02] ${s.blurred ? "blur-sm" : ""}`}
                        />
                      ) : s.viewable ? (
                        <div className="flex h-full items-center justify-center text-xs text-faint">No image</div>
                      ) : (
                        <LockedTile reason={isAdmin ? "Admin only" : "Hidden — blur is on"} />
                      )}
                      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent px-2 pb-1.5 pt-4 opacity-0 group-hover:opacity-100 transition">
                        <ActivityBar pct={Math.round(s.activityPct)} />
                      </div>
                      <span className="absolute left-1.5 top-1.5">
                        <span className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-bold text-white ${s.activityPct >= 50 ? "bg-[var(--color-positive)]" : "bg-black/50"}`}>
                          {Math.round(s.activityPct)}%
                        </span>
                      </span>
                    </button>
                    <div className="px-2.5 py-2">
                      <div className="truncate text-[12px] font-semibold text-ink">{s.project}</div>
                      <div className="truncate text-[10px] text-muted">
                        {isAdmin && `${s.member.split("@")[0]} · `}{formatTime(s.takenAt)}
                      </div>
                    </div>
                  </Card>
                </motion.div>
              ))}
            </motion.div>
          )}

          {/* ── List view ── */}
          {view === "list" && (
            <Card className="overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-canvas text-[11px] font-semibold uppercase tracking-wide text-muted">
                      <th className="px-5 py-3 text-left w-20">Preview</th>
                      <th className="px-4 py-3 text-left">Project</th>
                      {isAdmin && <th className="px-4 py-3 text-left">Member</th>}
                      <th className="px-4 py-3 text-left">Date</th>
                      <th className="px-4 py-3 text-left">Time</th>
                      <th className="px-4 py-3 text-left w-36">Activity</th>
                      <th className="px-4 py-3 text-center w-16">Monitor</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {shots.map((s) => (
                      <tr key={s.id} className="hover:bg-canvas transition group">
                        <td className="px-5 py-3">
                          <button
                            onClick={() => s.viewable && setLightbox(s)}
                            disabled={!s.viewable}
                            className="block h-10 w-16 overflow-hidden rounded-lg bg-canvas ring-1 ring-border transition enabled:hover:ring-brand disabled:cursor-default"
                          >
                            {s.url ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={s.url} alt="" loading="lazy" decoding="async" className={`h-full w-full object-cover ${s.blurred ? "blur-sm" : ""}`} />
                            ) : s.viewable ? (
                              <div className="flex h-full items-center justify-center text-[9px] text-faint">N/A</div>
                            ) : (
                              <LockedTile reason={isAdmin ? "Admin only" : "Hidden — blur is on"} />
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
                            <span className="text-[12px] font-semibold text-muted w-8 tnum">{Math.round(s.activityPct)}%</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <Badge tone="muted">#{s.monitorIndex + 1}</Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {/* Next-page skeletons, shown in place so the scroll position is stable. */}
          {loadingMore && (
            <div className="mt-3">
              <ShotSkeletons count={view === "grid" ? cols : 3} className={view === "grid" ? gridClass : "grid-cols-1"} />
            </div>
          )}

          {/* Sentinel: entering the viewport requests the next page. */}
          {!done && <div ref={sentinelRef} className="h-px w-full" aria-hidden />}

          {done && shots.length > 0 && (
            <p className="mt-6 text-center text-[13px] text-muted">That&rsquo;s everything in this range.</p>
          )}
        </div>
      )}

      {/* Lightbox */}
      <AnimatePresence>
        {lightbox && (
          <motion.div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
            role="dialog"
            aria-modal="true"
            aria-label="Screenshot detail"
            {...m.backdrop}
            onClick={() => setLightbox(null)}
          >
            <motion.div
              className="relative max-h-[90vh] max-w-5xl w-full overflow-hidden rounded-2xl bg-surface shadow-2xl"
              {...m.dialog}
              onClick={(e) => e.stopPropagation()}
            >
              <button
                onClick={() => setLightbox(null)}
                aria-label="Close"
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
                    <span className="text-[12px] font-semibold tnum">{Math.round(lightbox.activityPct)}% active</span>
                  </div>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
