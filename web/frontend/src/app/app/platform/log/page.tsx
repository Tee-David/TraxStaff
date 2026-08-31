"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError, asArray } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import {
  DESTRUCTIVE_ACTIONS,
  LOG_ACTION_LABELS,
  type PlatformLogRow,
  type SnapshotRow,
} from "@/lib/platform";
import { Badge, Button, Card, EmptyState, PageHeader, Skeleton } from "@/components/ui";

/**
 * What platform staff have done, and the undo buffer beside it.
 *
 * Only reachable here. The org-facing audit log filters out every row whose
 * actor is a super admin, so an org admin sees none of this — which is exactly
 * why it has to be visible somewhere, and why "somewhere" cannot be the org's
 * own page.
 */
export default function PlatformLogPage() {
  const { user: me } = useAuth();

  const [rows, setRows] = useState<PlatformLogRow[]>([]);
  const [snapshots, setSnapshots] = useState<SnapshotRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [log, snaps] = await Promise.all([
        api<{ rows: PlatformLogRow[] }>("/admin/log?limit=100"),
        api<SnapshotRow[]>("/admin/snapshots?limit=50"),
      ]);
      setRows(asArray<PlatformLogRow>(log.rows));
      setSnapshots(asArray<SnapshotRow>(snaps));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load the platform log");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (me && !me.isSuperAdmin) {
    return <EmptyState icon="🔒" title="Not available" hint="This area is for platform staff." />;
  }

  async function undo(id: string) {
    setBusy(id);
    setError(null);
    setNotice(null);
    try {
      const res = await api<{ sessions: number; activityBlocks: number; screenshots: number }>(
        `/admin/undo/${id}`,
        { method: "POST" }
      );
      setNotice(
        `Restored ${res.sessions} session(s), ${res.activityBlocks} activity block(s) and ${res.screenshots} screenshot(s).`
      );
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not restore that snapshot");
    } finally {
      setBusy(null);
    }
  }

  const restorable = snapshots.filter((s) => !s.restoredAt);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Platform log"
        subtitle="Cross-organization actions. Invisible to org admins."
      />

      {error && (
        <Card className="border-[var(--color-negative)]/30 bg-[var(--color-negative)]/5 p-4 text-sm text-[var(--color-negative)]">
          {error}
        </Card>
      )}
      {notice && (
        <Card className="border-[var(--color-positive)]/30 bg-[var(--color-positive)]/5 p-4 text-sm text-[var(--color-positive)]">
          {notice}
        </Card>
      )}

      <Card className="p-5">
        <h2 className="mb-1 font-heading text-base font-semibold">Undo</h2>
        <p className="mb-4 text-sm text-muted">
          Snapshots taken before a destructive write. Restoring works because deleting a screenshot
          row never deletes the image itself — the files are still in storage.
        </p>

        {loading ? (
          <Skeleton className="h-20 w-full" />
        ) : restorable.length === 0 ? (
          <p className="text-sm text-muted">Nothing to undo.</p>
        ) : (
          <div className="space-y-2">
            {restorable.map((s) => (
              <div
                key={s.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-sm">
                    <Badge tone="accent">{s.kind}</Badge>
                    <span className="text-muted">
                      {new Date(s.createdAt).toLocaleString("en-GB")}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-muted">
                    {s.counts.sessions} session(s), {s.counts.activityBlocks} block(s),{" "}
                    {s.counts.screenshots} screenshot(s) · expires{" "}
                    {new Date(s.expiresAt).toLocaleDateString("en-GB")}
                  </div>
                </div>
                <Button variant="ghost" disabled={busy === s.id} onClick={() => undo(s.id)}>
                  {busy === s.id ? "Restoring…" : "Restore"}
                </Button>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card className="p-0">
        <div className="border-b border-border px-5 py-4">
          <h2 className="font-heading text-base font-semibold">Activity</h2>
        </div>

        {loading ? (
          <div className="p-5">
            <Skeleton className="h-40 w-full" />
          </div>
        ) : rows.length === 0 ? (
          <div className="p-5 text-sm text-muted">Nothing recorded yet.</div>
        ) : (
          <div className="divide-y divide-border">
            {rows.map((r) => {
              const payload = r.payload ?? {};
              const actor = typeof payload.actorEmail === "string" ? payload.actorEmail : "system";
              const target =
                typeof payload.targetEmail === "string"
                  ? payload.targetEmail
                  : typeof payload.orgName === "string"
                    ? payload.orgName
                    : typeof payload.email === "string"
                      ? payload.email
                      : null;
              const destructive = DESTRUCTIVE_ACTIONS.has(r.action);

              return (
                <div key={r.id} className="flex flex-wrap items-start gap-3 px-5 py-3">
                  <span
                    className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                      destructive ? "bg-[var(--color-negative)]" : "bg-faint"
                    }`}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm">
                      <span className={destructive ? "font-semibold text-[var(--color-negative)]" : "font-medium"}>
                        {LOG_ACTION_LABELS[r.action] ?? r.action}
                      </span>
                      {target && <span className="text-muted"> — {target}</span>}
                    </div>
                    <div className="mt-0.5 text-xs text-muted">
                      {actor} · {new Date(r.createdAt).toLocaleString("en-GB")}
                    </div>
                    <LogDetails payload={payload} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}

/**
 * The interesting fields of a log payload, without dumping raw JSON at someone.
 *
 * An allowlist rather than "everything except actorEmail": payloads carry
 * different shapes per action and grow over time, and a blanket render would
 * eventually put something unhelpful — or something that should not be on a
 * screen — in front of whoever is reading the log.
 */
function LogDetails({ payload }: { payload: Record<string, unknown> }) {
  const bits: string[] = [];

  const num = (k: string, label: string) => {
    const v = payload[k];
    if (typeof v === "number" && v > 0) bits.push(`${label}: ${v}`);
  };
  const str = (k: string, label: string) => {
    const v = payload[k];
    if (typeof v === "string" && v) bits.push(`${label}: ${v}`);
  };

  num("supersededSessions", "sessions removed");
  num("supersededCaptured", "captured removed");
  num("blocksRemoved", "blocks removed");
  num("screenshotsRemoved", "screenshots removed");
  num("days", "days");
  num("updated", "sessions updated");
  num("rechained", "rewritten in place");
  num("members", "members");
  num("activityPct", "activity %");
  str("recordAs", "recorded as");
  str("fill", "mode");
  str("reason", "reason");

  const range = payload.range as { from?: string; to?: string } | undefined;
  if (range?.from) bits.push(`range: ${range.from}${range.to && range.to !== range.from ? ` to ${range.to}` : ""}`);

  const role = payload.role as { from?: string; to?: string } | undefined;
  if (role?.to) bits.push(`role: ${role.from} → ${role.to}`);

  const status = payload.status as { from?: string; to?: string } | undefined;
  if (status?.to) bits.push(`status: ${status.from} → ${status.to}`);

  if (payload.passwordSet === true) bits.push("password set");
  if (typeof payload.snapshotId === "string") bits.push("undo available");

  if (bits.length === 0) return null;
  return <div className="mt-1 text-xs text-faint">{bits.join(" · ")}</div>;
}
