"use client";

import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Badge, Card } from "@/components/ui";
import { DateRange, MemberFilter, FilterBar, Pagination, paginate, rangeToParams, type RangeKey } from "@/components/filters";
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

const PER_PAGE = 12;

export default function ScreenshotsPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "owner" || user?.role === "admin";
  const [shots, setShots] = useState<Shot[]>([]);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState<RangeKey>("week");
  const [member, setMember] = useState("");
  const [page, setPage] = useState(0);
  const [lightbox, setLightbox] = useState<Shot | null>(null);

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

  useEffect(() => {
    load();
    setPage(0);
  }, [load]);

  async function del(id: string) {
    await api(`/screenshots/${id}`, { method: "DELETE" });
    setShots((s) => s.filter((x) => x.id !== id));
    setLightbox(null);
  }

  const pageShots = paginate(shots, page, PER_PAGE);

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-2xl">Screenshots</h1>
        <p className="text-sm text-muted">{isAdmin ? "Review captured screenshots" : "Your captured screenshots"}</p>
      </div>

      <FilterBar>
        <DateRange value={range} onChange={setRange} />
        <MemberFilter value={member} onChange={setMember} enabled={isAdmin} />
      </FilterBar>

      {loading ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : shots.length === 0 ? (
        <Card className="p-10 text-center">
          <p className="text-sm text-muted">
            No screenshots in this range. They appear automatically once the desktop tracker captures them.
          </p>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {pageShots.map((s, i) => (
              <motion.div
                key={s.id}
                initial={{ opacity: 0, scale: 0.97 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.22, delay: (i % PER_PAGE) * 0.02 }}
              >
                <Card className="overflow-hidden">
                  <button onClick={() => setLightbox(s)} className="relative block aspect-video w-full bg-canvas">
                    {s.url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={s.url} alt="screenshot" className={`h-full w-full object-cover ${s.blurred ? "blur-md" : ""}`} />
                    ) : (
                      <div className="flex h-full items-center justify-center text-xs text-muted">unavailable</div>
                    )}
                    <span className="absolute left-2 top-2">
                      <Badge tone={s.activityPct >= 50 ? "green" : "muted"}>{Math.round(s.activityPct)}%</Badge>
                    </span>
                  </button>
                  <div className="flex items-center justify-between p-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{s.project}</div>
                      <div className="truncate text-xs text-muted">
                        {isAdmin ? `${s.member} · ` : ""}
                        {formatDate(s.takenAt)} {formatTime(s.takenAt)}
                      </div>
                    </div>
                    {isAdmin && (
                      <button onClick={() => del(s.id)} className="text-xs text-red-600 hover:underline">
                        Delete
                      </button>
                    )}
                  </div>
                </Card>
              </motion.div>
            ))}
          </div>
          <Pagination page={page} pageSize={PER_PAGE} total={shots.length} onPage={setPage} />
        </>
      )}

      {/* Lightbox */}
      <AnimatePresence>
        {lightbox && (
          <motion.div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setLightbox(null)}
          >
            <motion.div
              className="max-h-[90vh] max-w-4xl overflow-hidden rounded-xl bg-surface"
              initial={{ scale: 0.95 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.95 }}
              onClick={(e) => e.stopPropagation()}
            >
              {lightbox.url && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={lightbox.url} alt="screenshot" className={`max-h-[75vh] w-full object-contain ${lightbox.blurred ? "blur-md" : ""}`} />
              )}
              <div className="flex items-center justify-between p-4">
                <div className="text-sm">
                  <span className="font-medium">{lightbox.project}</span>
                  <span className="text-muted">
                    {" "}
                    · {isAdmin ? `${lightbox.member} · ` : ""}
                    {formatDate(lightbox.takenAt)} {formatTime(lightbox.takenAt)} · monitor {lightbox.monitorIndex + 1} · {Math.round(lightbox.activityPct)}% active
                  </span>
                </div>
                {isAdmin && (
                  <button onClick={() => del(lightbox.id)} className="text-sm text-red-600 hover:underline">
                    Delete
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
