"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { LeaderRow, PresenceRow, UnusualFlag } from "@/lib/reports";
import { Badge, Card } from "@/components/ui";
import { formatDurationShort } from "@/lib/format";

const FLAG_LABELS: Record<string, string> = {
  sustained_high_activity: "Sustained high activity",
  low_variance_robotic: "Robotic / low variance",
  input_channel_imbalance: "Input channel imbalance",
  jiggler_process_detected: "Mouse-jiggler detected",
};

export default function InsightsPage() {
  const [presence, setPresence] = useState<PresenceRow[]>([]);
  const [flags, setFlags] = useState<UnusualFlag[]>([]);
  const [board, setBoard] = useState<LeaderRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api<PresenceRow[]>("/insights/presence"),
      api<UnusualFlag[]>("/insights/unusual-activity"),
      api<LeaderRow[]>("/insights/leaderboard"),
    ])
      .then(([p, f, b]) => {
        setPresence(p);
        setFlags(f);
        setBoard(b);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl">Insights</h1>
        <p className="text-sm text-muted">Presence, unusual activity, and team ranking</p>
      </div>

      {loading ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          {/* Who's online */}
          <Card className="p-5">
            <h2 className="mb-4 text-lg">Who&rsquo;s online</h2>
            <div className="space-y-2">
              {presence.map((m) => (
                <div key={m.userId} className="flex items-center justify-between rounded-lg px-2 py-2 hover:bg-canvas">
                  <div className="flex items-center gap-2">
                    <span className={`h-2.5 w-2.5 rounded-full ${m.online ? "bg-green-500" : "bg-border"}`} />
                    <span className="text-sm font-medium">{m.email}</span>
                  </div>
                  <span className="text-xs text-muted">
                    {m.tracking ? `Tracking · ${m.tracking.project}` : m.online ? "Online" : "Offline"}
                  </span>
                </div>
              ))}
              {presence.length === 0 && <p className="text-sm text-muted">No members.</p>}
            </div>
          </Card>

          {/* Leaderboard */}
          <Card className="p-5">
            <h2 className="mb-4 text-lg">Leaderboard</h2>
            <div className="space-y-2">
              {board.map((r, i) => (
                <div key={r.userId} className="flex items-center justify-between rounded-lg px-2 py-2 hover:bg-canvas">
                  <div className="flex items-center gap-3">
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-brand/10 text-xs font-bold text-brand">
                      {i + 1}
                    </span>
                    <span className="text-sm font-medium">{r.email}</span>
                  </div>
                  <span className="text-sm text-muted">
                    {formatDurationShort(r.totalSeconds)}
                    {r.avgActivityPct > 0 && ` · ${r.avgActivityPct}%`}
                  </span>
                </div>
              ))}
              {board.length === 0 && <p className="text-sm text-muted">No tracked time yet.</p>}
            </div>
          </Card>

          {/* Unusual activity */}
          <Card className="p-5 lg:col-span-2">
            <h2 className="mb-4 text-lg">Unusual activity</h2>
            {flags.length === 0 ? (
              <p className="text-sm text-muted">No unusual activity flagged. 🎉</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                    <th className="pb-2 font-medium">Member</th>
                    <th className="pb-2 font-medium">Project</th>
                    <th className="pb-2 font-medium">Signal</th>
                    <th className="pb-2 font-medium">Detected</th>
                  </tr>
                </thead>
                <tbody>
                  {flags.map((f) => (
                    <tr key={f.id} className="border-b border-border/60 last:border-0">
                      <td className="py-2.5 font-medium">{f.session.user.email}</td>
                      <td className="py-2.5 text-muted">{f.session.project.name}</td>
                      <td className="py-2.5">
                        <Badge tone="red">{FLAG_LABELS[f.type] ?? f.type}</Badge>
                      </td>
                      <td className="py-2.5 text-muted">{new Date(f.detectedAt).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
