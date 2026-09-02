"use client";

import { useCallback, useEffect, useState } from "react";
import { motion } from "motion/react";
import { api } from "@/lib/api";
import { Badge, Card, EmptyState, PageHeader, Skeleton } from "@/components/ui";
import {
  notificationWhat,
  notificationWho,
  timeAgo,
  type AppNotification,
} from "@/lib/notifications";

/**
 * The whole notification history, which the header bell can't show — it holds
 * one page in a 320px dropdown and there was no way to reach anything older.
 *
 * Pages backwards on a `createdAt` cursor rather than an offset, so a
 * notification arriving while you read doesn't shift the page boundary and push
 * a row past the one you already loaded.
 */

const PAGE = 30;

/** Tone for the flag kind carried in the payload — mirrors the Insights page. */
const SEVERE = new Set([
  "low_variance_robotic",
  "input_channel_imbalance",
  "jiggler_process_detected",
  "exceeds_elapsed_cap",
]);

function toneFor(n: AppNotification): "red" | "accent" | "muted" {
  // Anything waiting on a person reads amber — a pending approval is the one
  // notification here that someone else is actually blocked on.
  if (n.type === "manual_time_submitted") return "accent";
  if (n.type === "manual_time_decided") {
    return n.payload?.decision === "rejected" ? "red" : "muted";
  }
  if (n.type !== "unusual_activity") return "muted";
  const kind = typeof n.payload?.type === "string" ? n.payload.type : "";
  return SEVERE.has(kind) ? "red" : "accent";
}

export default function NotificationsPage() {
  const [items, setItems] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  /** False once a page comes back short — that's the end of the history. */
  const [more, setMore] = useState(true);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadFirst = useCallback(() => {
    setLoading(true);
    setError(null);
    const qs = new URLSearchParams({ limit: String(PAGE) });
    if (unreadOnly) qs.set("unread", "1");
    api<AppNotification[]>(`/notifications?${qs}`)
      .then((rows) => {
        setItems(rows);
        setMore(rows.length === PAGE);
      })
      .catch(() => setError("Couldn't load notifications."))
      .finally(() => setLoading(false));
  }, [unreadOnly]);

  useEffect(() => {
    loadFirst();
  }, [loadFirst]);

  async function loadMore() {
    const last = items[items.length - 1];
    if (!last || loadingMore) return;
    setLoadingMore(true);
    const qs = new URLSearchParams({ limit: String(PAGE), before: last.createdAt });
    if (unreadOnly) qs.set("unread", "1");
    try {
      const rows = await api<AppNotification[]>(`/notifications?${qs}`);
      setItems((s) => [...s, ...rows]);
      setMore(rows.length === PAGE);
    } catch {
      setError("Couldn't load more.");
    } finally {
      setLoadingMore(false);
    }
  }

  async function markRead(id: string) {
    // Optimistic: the row is already visibly read before the request lands, and
    // a failure only costs a stale dot that the next load corrects.
    setItems((s) => s.map((n) => (n.id === id ? { ...n, readAt: new Date().toISOString() } : n)));
    await api(`/notifications/${id}/read`, { method: "POST" }).catch(() => {});
  }

  async function markAllRead() {
    const now = new Date().toISOString();
    setItems((s) => s.map((n) => (n.readAt ? n : { ...n, readAt: now })));
    await api("/notifications/read-all", { method: "POST" }).catch(() => {});
    if (unreadOnly) loadFirst();
  }

  const unread = items.filter((n) => !n.readAt).length;

  return (
    <div>
      <PageHeader
        title="Notifications"
        subtitle="Everything the tracker has flagged, newest first"
        actions={
          <div className="flex items-center gap-2">
            <button
              onClick={() => setUnreadOnly((v) => !v)}
              className={`rounded-xl border px-3.5 py-2 text-sm font-medium transition ${
                unreadOnly
                  ? "border-brand bg-brand-soft text-brand"
                  : "border-border text-muted hover:bg-canvas hover:text-ink"
              }`}
            >
              Unread only
            </button>
            <button
              onClick={markAllRead}
              disabled={unread === 0}
              className="rounded-xl border border-border px-3.5 py-2 text-sm font-medium text-muted transition hover:bg-canvas hover:text-ink disabled:pointer-events-none disabled:opacity-40"
            >
              Mark all read
            </button>
          </div>
        }
      />

      {/* EmptyState brings its own Card, so the empty and error branches sit
          outside the list's card rather than nested inside one. */}
      {loading ? (
        <Card className="overflow-hidden">
          <div className="space-y-2 p-4">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <Skeleton key={i} className="h-16" />
            ))}
          </div>
        </Card>
      ) : error && items.length === 0 ? (
        <EmptyState icon="⚠️" title="Couldn't load notifications" hint={error} />
      ) : items.length === 0 ? (
        <EmptyState
          icon="🔔"
          title={unreadOnly ? "Nothing unread" : "No notifications yet"}
          hint={
            unreadOnly
              ? "Everything here has been read."
              : "Flags raised by the tracker will appear here as they happen."
          }
        />
      ) : (
        <Card className="overflow-hidden">
            <ul className="divide-y divide-border">
              {items.map((n, i) => {
                const who = notificationWho(n);
                return (
                  <motion.li
                    key={n.id}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ duration: 0.15, delay: Math.min(i, 10) * 0.015 }}
                    className={`flex items-start gap-3 px-4 py-3.5 transition sm:px-5 ${
                      n.readAt ? "opacity-55" : "bg-canvas"
                    }`}
                  >
                    <span
                      aria-hidden
                      className={`mt-2 h-2 w-2 shrink-0 rounded-full ${n.readAt ? "bg-transparent" : "bg-accent"}`}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone={toneFor(n)}>{notificationWhat(n)}</Badge>
                        {who && <span className="text-sm font-semibold text-ink">{who}</span>}
                      </div>
                      <div className="mt-1 text-[12px] text-muted">
                        {timeAgo(n.createdAt)} · {new Date(n.createdAt).toLocaleString()}
                      </div>
                    </div>
                    {!n.readAt && (
                      <button
                        onClick={() => markRead(n.id)}
                        className="shrink-0 whitespace-nowrap pt-0.5 text-[12px] font-semibold text-brand hover:underline"
                      >
                        Mark read
                      </button>
                    )}
                  </motion.li>
                );
              })}
            </ul>

            {more && (
              <div className="border-t border-border p-3">
                <button
                  onClick={loadMore}
                  disabled={loadingMore}
                  className="w-full rounded-xl border border-border py-2.5 text-[13px] font-semibold text-brand transition hover:bg-canvas disabled:opacity-50"
                >
                  {loadingMore ? "Loading…" : "More"}
                </button>
              </div>
            )}
            {error && items.length > 0 && (
              <p className="border-t border-border px-4 py-3 text-[12px] text-[var(--color-negative)]">{error}</p>
            )}
        </Card>
      )}
    </div>
  );
}
