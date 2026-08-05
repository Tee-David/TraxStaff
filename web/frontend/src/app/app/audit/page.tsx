"use client";

import { useCallback, useEffect, useState } from "react";
import { motion } from "motion/react";
import { api } from "@/lib/api";
import { Badge, Card, EmptyState, Input, PageHeader, Skeleton } from "@/components/ui";
import { Select } from "@/components/Select";
import {
  actionLabel,
  actionTone,
  actorOf,
  detailPairs,
  targetOf,
  timeAgo,
  type AuditRow,
} from "@/lib/audit";

/**
 * Org-wide trail of who did what. Admin-only (the API enforces it too).
 *
 * Pages backwards on a `createdAt` cursor rather than an offset, matching the
 * notifications list: an action landing while you read must not shift the page
 * boundary and push a row past one already loaded.
 *
 * Filters are sent to the API rather than applied here — the log grows without
 * bound, so narrowing it client-side would mean holding the whole history to
 * search it.
 */

const PAGE = 30;

/** Presets rather than a date picker: the real question is always "how recent". */
const RANGES = [
  { value: "", label: "Any time" },
  { value: "1", label: "Last 24 hours" },
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
  { value: "90", label: "Last 90 days" },
];

function sinceISO(days: string): string | null {
  if (!days) return null;
  return new Date(Date.now() - Number(days) * 86400000).toISOString();
}

export default function AuditLogPage() {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [actions, setActions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [more, setMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [action, setAction] = useState("");
  const [range, setRange] = useState("");
  const [search, setSearch] = useState("");
  /** Debounced copy of `search` — one request per pause, not per keystroke. */
  const [query, setQuery] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setQuery(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  // Only the actions this org has actually produced, so the dropdown never
  // offers a filter that returns nothing.
  useEffect(() => {
    api<string[]>("/audit-log/actions")
      .then(setActions)
      .catch(() => setActions([]));
  }, []);

  const buildQs = useCallback(
    (before?: string) => {
      const qs = new URLSearchParams({ limit: String(PAGE) });
      if (action) qs.set("action", action);
      if (query) qs.set("q", query);
      const from = sinceISO(range);
      if (from) qs.set("from", from);
      if (before) qs.set("before", before);
      return qs;
    },
    [action, query, range]
  );

  const loadFirst = useCallback(() => {
    setLoading(true);
    setError(null);
    api<{ rows: AuditRow[]; more: boolean }>(`/audit-log?${buildQs()}`)
      .then((r) => {
        setRows(r.rows);
        setMore(r.more);
      })
      .catch(() => setError("Couldn't load the audit log."))
      .finally(() => setLoading(false));
  }, [buildQs]);

  useEffect(() => {
    loadFirst();
  }, [loadFirst]);

  async function loadMore() {
    const last = rows[rows.length - 1];
    if (!last || loadingMore) return;
    setLoadingMore(true);
    try {
      const r = await api<{ rows: AuditRow[]; more: boolean }>(`/audit-log?${buildQs(last.createdAt)}`);
      setRows((s) => [...s, ...r.rows]);
      setMore(r.more);
    } catch {
      setError("Couldn't load more.");
    } finally {
      setLoadingMore(false);
    }
  }

  const filtered = Boolean(action || range || query);

  return (
    <div>
      <PageHeader
        title="Audit log"
        subtitle="Every membership change and destructive action, newest first"
      />

      {/* Filters. Stack on phones, sit inline from sm up. */}
      <Card className="mb-4 p-3 sm:p-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="sm:flex-1">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by person or target…"
              aria-label="Search the audit log"
            />
          </div>
          <div className="flex gap-2">
            <Select
              value={action}
              onChange={setAction}
              options={[
                { value: "", label: "All actions" },
                ...actions.map((a) => ({ value: a, label: actionLabel(a) })),
              ]}
              placeholder="All actions"
              minWidth={180}
            />
            <Select
              value={range}
              onChange={setRange}
              options={RANGES}
              placeholder="Any time"
              align="right"
              minWidth={160}
            />
          </div>
        </div>
        {filtered && (
          <button
            onClick={() => {
              setAction("");
              setRange("");
              setSearch("");
            }}
            className="mt-2 text-[12px] font-semibold text-brand hover:underline"
          >
            Clear filters
          </button>
        )}
      </Card>

      {loading ? (
        <Card className="overflow-hidden">
          <div className="space-y-2 p-4">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <Skeleton key={i} className="h-14" />
            ))}
          </div>
        </Card>
      ) : error && rows.length === 0 ? (
        <EmptyState icon="⚠️" title="Couldn't load the audit log" hint={error} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon="📋"
          title={filtered ? "Nothing matches those filters" : "No activity recorded yet"}
          hint={
            filtered
              ? "Try widening the date range or clearing the search."
              : "Membership changes and deletions will appear here as they happen."
          }
        />
      ) : (
        <Card className="overflow-hidden">
          {/* Table from sm up; the same rows become stacked cards on phones,
              because six columns cannot be read on a 375px screen. */}
          <div className="hidden overflow-x-auto sm:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/60 bg-canvas/30 text-[11px] font-semibold uppercase tracking-wide text-muted">
                  <th className="px-5 py-3 text-left">Action</th>
                  <th className="px-4 py-3 text-left">Who</th>
                  <th className="px-4 py-3 text-left">Target</th>
                  <th className="px-4 py-3 text-left hidden lg:table-cell">Details</th>
                  <th className="px-5 py-3 text-right w-40">When</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {rows.map((r, i) => (
                  <motion.tr
                    key={r.id}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ duration: 0.15, delay: Math.min(i, 10) * 0.015 }}
                    className="transition hover:bg-canvas/40"
                  >
                    <td className="px-5 py-3">
                      <Badge tone={actionTone(r.action)}>{actionLabel(r.action)}</Badge>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-[13px] font-medium text-ink">{actorOf(r)}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-[13px] text-muted">{targetOf(r)}</span>
                    </td>
                    <td className="px-4 py-3 hidden lg:table-cell">
                      <span className="text-[12px] text-muted">
                        {detailPairs(r)
                          .map((d) => `${d.key}: ${d.value}`)
                          .join(" · ") || "—"}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-right">
                      <span className="text-[12px] text-muted" title={new Date(r.createdAt).toLocaleString()}>
                        {timeAgo(r.createdAt)}
                      </span>
                    </td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Phone layout */}
          <ul className="divide-y divide-border/60 sm:hidden">
            {rows.map((r) => (
              <li key={r.id} className="px-4 py-3">
                <div className="flex items-start justify-between gap-2">
                  <Badge tone={actionTone(r.action)}>{actionLabel(r.action)}</Badge>
                  <span className="shrink-0 text-[11px] text-muted">{timeAgo(r.createdAt)}</span>
                </div>
                <div className="mt-1.5 text-[13px] font-medium text-ink break-all">{actorOf(r)}</div>
                {targetOf(r) !== "—" && (
                  <div className="text-[12px] text-muted break-all">→ {targetOf(r)}</div>
                )}
                {detailPairs(r).length > 0 && (
                  <div className="mt-1 text-[11px] text-muted">
                    {detailPairs(r)
                      .map((d) => `${d.key}: ${d.value}`)
                      .join(" · ")}
                  </div>
                )}
              </li>
            ))}
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
          {error && rows.length > 0 && (
            <p className="border-t border-border px-4 py-3 text-[12px] text-[var(--color-negative)]">{error}</p>
          )}
        </Card>
      )}
    </div>
  );
}
