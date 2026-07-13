"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { api } from "@/lib/api";

interface Notification {
  id: string;
  type: string;
  payload: Record<string, unknown> | null;
  readAt: string | null;
  createdAt: string;
}

function describe(n: Notification): string {
  const p = n.payload ?? {};
  if (n.type === "unusual_activity") {
    const who = (p.memberEmail as string) ?? "A member";
    const kind = (p.type as string)?.replace(/_/g, " ") ?? "unusual activity";
    return `${who}: ${kind}`;
  }
  return n.type.replace(/_/g, " ");
}

export function NotificationsBell() {
  const [items, setItems] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  async function load() {
    try {
      setItems(await api<Notification[]>("/notifications"));
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
                      <div className="truncate text-sm font-medium capitalize">{describe(n)}</div>
                      <div className="text-xs text-muted">{new Date(n.createdAt).toLocaleString()}</div>
                    </div>
                  </button>
                ))
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
