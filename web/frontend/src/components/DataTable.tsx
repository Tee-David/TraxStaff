"use client";

import { useMemo, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Card } from "@/components/ui";

export interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  sortValue?: (row: T) => string | number;
  className?: string;
}

export function DataTable<T>({
  rows,
  columns,
  rowId,
  selectable = false,
  bulkActions,
  rowActions,
  pageSize = 10,
  empty,
}: {
  rows: T[];
  columns: Column<T>[];
  rowId: (row: T) => string;
  selectable?: boolean;
  bulkActions?: (ids: string[], clear: () => void) => ReactNode;
  rowActions?: (row: T) => ReactNode;
  pageSize?: number;
  empty?: ReactNode;
}) {
  const [page, setPage] = useState(0);
  const [size, setSize] = useState(pageSize);
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const sorted = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.key === sort.key);
    if (!col?.sortValue) return rows;
    return [...rows].sort((a, b) => {
      const av = col.sortValue!(a);
      const bv = col.sortValue!(b);
      return (av < bv ? -1 : av > bv ? 1 : 0) * sort.dir;
    });
  }, [rows, sort, columns]);

  const pages = Math.max(1, Math.ceil(sorted.length / size));
  const pageRows = sorted.slice(page * size, page * size + size);
  const pageIds = pageRows.map(rowId);
  const allOnPage = pageIds.length > 0 && pageIds.every((id) => selected.has(id));

  function toggleAll() {
    const next = new Set(selected);
    if (allOnPage) pageIds.forEach((id) => next.delete(id));
    else pageIds.forEach((id) => next.add(id));
    setSelected(next);
  }
  function toggle(id: string) {
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelected(next);
  }
  function clear() {
    setSelected(new Set());
  }
  function toggleSort(key: string) {
    setSort((s) => (s?.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: 1 }));
  }

  if (rows.length === 0 && empty) return <>{empty}</>;

  const pageNumbers = pageWindow(page, pages);

  return (
    <Card className="overflow-hidden">
      {/* Bulk actions bar */}
      <AnimatePresence>
        {selectable && selected.size > 0 && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="flex items-center justify-between gap-3 border-b border-border bg-brand-soft px-5 py-2.5"
          >
            <span className="text-sm font-medium text-brand">{selected.size} selected</span>
            <div className="flex items-center gap-2">
              {bulkActions?.([...selected], clear)}
              <button onClick={clear} className="text-sm text-muted hover:text-ink">Clear</button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-faint">
              {selectable && (
                <th className="w-10 px-5 py-3">
                  <input type="checkbox" checked={allOnPage} onChange={toggleAll} className="accent-brand" aria-label="Select all" />
                </th>
              )}
              {columns.map((c) => (
                <th key={c.key} className={`px-5 py-3 font-medium ${c.className ?? ""}`}>
                  {c.sortValue ? (
                    <button onClick={() => toggleSort(c.key)} className="inline-flex items-center gap-1 hover:text-muted">
                      {c.header}
                      <span className="text-[9px]">{sort?.key === c.key ? (sort.dir === 1 ? "▲" : "▼") : "↕"}</span>
                    </button>
                  ) : (
                    c.header
                  )}
                </th>
              ))}
              {rowActions && <th className="px-5 py-3" />}
            </tr>
          </thead>
          <tbody>
            {pageRows.map((row) => {
              const id = rowId(row);
              return (
                <tr key={id} className={`border-b border-border/60 transition last:border-0 hover:bg-canvas ${selected.has(id) ? "bg-brand-soft" : ""}`}>
                  {selectable && (
                    <td className="px-5 py-3">
                      <input type="checkbox" checked={selected.has(id)} onChange={() => toggle(id)} className="accent-brand" aria-label="Select row" />
                    </td>
                  )}
                  {columns.map((c) => (
                    <td key={c.key} className={`px-5 py-3 ${c.className ?? ""}`}>{c.render(row)}</td>
                  ))}
                  {rowActions && <td className="px-5 py-3 text-right">{rowActions(row)}</td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Footer: page size + numbered pagination */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-3 text-sm text-muted">
        <div className="flex items-center gap-2">
          <select
            value={size}
            onChange={(e) => { setSize(Number(e.target.value)); setPage(0); }}
            className="rounded-lg border border-border bg-surface px-2 py-1 text-xs outline-none focus:border-brand"
          >
            {[10, 25, 50].map((n) => <option key={n} value={n}>{n} / page</option>)}
          </select>
          <span className="tnum">{sorted.length} total</span>
        </div>
        {pages > 1 && (
          <div className="flex items-center gap-1">
            <PageBtn disabled={page === 0} onClick={() => setPage(page - 1)}>Prev</PageBtn>
            {pageNumbers.map((n, i) =>
              n === -1 ? (
                <span key={`e${i}`} className="px-1 text-faint">…</span>
              ) : (
                <button
                  key={n}
                  onClick={() => setPage(n)}
                  className={`h-8 min-w-8 rounded-lg px-2 text-sm tnum transition ${n === page ? "bg-brand text-brand-fg" : "hover:bg-canvas"}`}
                >
                  {n + 1}
                </button>
              )
            )}
            <PageBtn disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>Next</PageBtn>
          </div>
        )}
      </div>
    </Card>
  );
}

function PageBtn({ children, disabled, onClick }: { children: ReactNode; disabled?: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} disabled={disabled} className="rounded-lg border border-border px-3 py-1 text-sm transition hover:bg-canvas disabled:opacity-40">
      {children}
    </button>
  );
}

// 1 2 … 8 9 10 style window around the current page
function pageWindow(current: number, total: number): number[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i);
  const out: number[] = [0];
  const start = Math.max(1, current - 1);
  const end = Math.min(total - 2, current + 1);
  if (start > 1) out.push(-1);
  for (let i = start; i <= end; i++) out.push(i);
  if (end < total - 2) out.push(-1);
  out.push(total - 1);
  return out;
}
