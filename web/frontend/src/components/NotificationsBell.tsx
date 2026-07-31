"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { api } from "@/lib/api";
import { describeNotification, timeAgo, type AppNotification } from "@/lib/notifications";

/**
 * The header bell: the most recent notifications only. Anything older lives on
 * /app/notifications, which this links to — the dropdown is 320px wide and used
 * to be the only way to see any of this, so a long history was unreachable.
 *
 * Labelling comes from lib/notifications so the bell and the page can't drift
 * apart on what a given flag is called.
 */
const PREVIEW = 8;

export function NotificationsBell() {
  const [items, setItems] = useState<AppNotification[]>([]);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  async function load() {
    try {
      setItems(await api<AppNotification[]>(`/notifications?limit=${PREVIEW}`));
    } catch {
      /* ignore */
    }
  }

  useEffect(() => {
    load();
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const unread = items.filter((n) => !n.readAt).length;

  async function markRead(id: string) {
    await api(`/notifications/${id}/read`, { method: "POST" }).catch(() => {});
    setItems((s) => s.map((n) => (n.id === id ? { ...n, readAt: new Date().toISOString() } : n)));
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="relative rounded-lg p-2 text-lg hover:bg-canvas"
        aria-label="Notifications"
      >
        🔔
        {unread > 0 && (
          <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-bold text-white">
            {unread}
          </span>
        )}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.15 }}
            className="absolute right-0 mt-2 w-80 overflow-hidden rounded-xl border border-border bg-surface shadow-lg"
          >
            <div className="border-b border-border px-4 py-3 text-sm font-semibold">Notifications</div>
            <div className="max-h-96 overflow-y-auto">
              {items.length === 0 ? (
                <div className="px-4 py-6 text-center text-sm text-muted">You&rsquo;re all caught up.</div>
              ) : (
                items.map((n) => (
                  <button
                    key={n.id}
                    onClick={() => markRead(n.id)}
                    className={`flex w-full items-start gap-2 border-b border-border/60 px-4 py-3 text-left last:border-0 hover:bg-canvas ${
                      n.readAt ? "opacity-60" : ""
                    }`}
                  >
                    {!n.readAt && <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-accent" />}
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{describeNotification(n)}</div>
                      <div className="text-xs text-muted">{timeAgo(n.createdAt)}</div>
                    </div>
                  </button>
                ))
              )}
            </div>
            {/* The way out of a 320px dropdown — the full history is a page. */}
            <Link
              href="/app/notifications"
              onClick={() => setOpen(false)}
              className="block border-t border-border px-4 py-2.5 text-center text-[12px] font-semibold text-brand hover:bg-canvas"
            >
              See all notifications
            </Link>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
