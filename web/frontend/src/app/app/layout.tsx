"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { AuthProvider, useAuth } from "@/lib/auth";
import { Sidebar } from "@/components/Sidebar";
import { NotificationsBell } from "@/components/NotificationsBell";

function Shell({ children }: { children: React.ReactNode }) {
  const { user, loading, logout } = useAuth();
  const pathname = usePathname();
  const [drawer, setDrawer] = useState(false);

  if (loading) {
    return <div className="flex min-h-screen items-center justify-center text-muted">Loading…</div>;
  }
  if (!user) {
    if (typeof window !== "undefined") window.location.href = "/login";
    return null;
  }

  return (
    <div className="flex min-h-screen">
      {/* Desktop sidebar */}
      <aside className="hidden w-64 shrink-0 border-r border-border lg:block">
        <div className="sticky top-0 h-screen">
          <Sidebar user={user} onLogout={logout} />
        </div>
      </aside>

      {/* Mobile drawer */}
      <AnimatePresence>
        {drawer && (
          <>
            <motion.div
              className="fixed inset-0 z-40 bg-black/40 lg:hidden"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setDrawer(false)}
            />
            <motion.aside
              className="fixed inset-y-0 left-0 z-50 w-64 border-r border-border lg:hidden"
              initial={{ x: -288 }}
              animate={{ x: 0 }}
              exit={{ x: -288 }}
              transition={{ type: "spring", stiffness: 360, damping: 34 }}
            >
              <Sidebar user={user} onLogout={logout} onNavigate={() => setDrawer(false)} />
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top bar */}
        <header className="sticky top-0 z-30 flex items-center justify-between border-b border-border bg-surface/80 px-4 py-3 backdrop-blur lg:px-8">
          <div className="flex items-center gap-3">
            <button
              className="rounded-lg p-1.5 text-xl hover:bg-canvas lg:hidden"
              onClick={() => setDrawer(true)}
              aria-label="Open menu"
            >
              ☰
            </button>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/icon-badge.svg" alt="" className="h-7 w-7 lg:hidden" />
          </div>
          <NotificationsBell />
        </header>

        <main className="flex-1 overflow-auto">
          <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
            <AnimatePresence mode="wait">
              <motion.div
                key={pathname}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
              >
                {children}
              </motion.div>
            </AnimatePresence>
          </div>
        </main>
      </div>
    </div>
  );
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <Shell>{children}</Shell>
    </AuthProvider>
  );
}
