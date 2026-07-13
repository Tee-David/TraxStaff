"use client";

import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Badge, Card } from "@/components/ui";
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

export default function ScreenshotsPage() {
  const { user } = useAuth();
  const [shots, setShots] = useState<Shot[]>([]);
  const [loading, setLoading] = useState(true);
  const isAdmin = user?.role === "owner" || user?.role === "admin";

  function load() {
    api<Shot[]>("/screenshots")
      .then(setShots)
      .catch(() => setShots([]))
      .finally(() => setLoading(false));
  }
  useEffect(load, []);

  async function del(id: string) {
    await api(`/screenshots/${id}`, { method: "DELETE" });
    setShots((s) => s.filter((x) => x.id !== id));
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl">Screenshots</h1>
        <p className="text-sm text-muted">
          {isAdmin ? "Review captured screenshots across the team" : "Your captured screenshots"}
        </p>
      </div>

      {loading ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : shots.length === 0 ? (
        <Card className="p-10 text-center">
          <p className="text-sm text-muted">
            No screenshots yet. They appear here automatically once the desktop tracker captures them
            (org setting: screenshots per 10-minute block).
          </p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {shots.map((s, i) => (
            <motion.div
              key={s.id}
              initial={{ opacity: 0, scale: 0.97 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.25, delay: (i % 12) * 0.03 }}
            >
              <Card className="overflow-hidden">
                <div className="relative aspect-video bg-canvas">
                  {s.url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={s.url} alt="screenshot" className={`h-full w-full object-cover ${s.blurred ? "blur-md" : ""}`} />
                  ) : (
                    <div className="flex h-full items-center justify-center text-xs text-muted">unavailable</div>
                  )}
                  <span className="absolute left-2 top-2">
                    <Badge tone={s.activityPct >= 50 ? "green" : "muted"}>{Math.round(s.activityPct)}%</Badge>
                  </span>
                </div>
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
      )}
    </div>
  );
}
