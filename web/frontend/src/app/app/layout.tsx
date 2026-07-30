"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { AuthProvider, useAuth } from "@/lib/auth";
import type { AuthUser } from "@/lib/api";
import { Sidebar } from "@/components/Sidebar";
import { NotificationsBell } from "@/components/NotificationsBell";
import { DownloadApp } from "@/components/DownloadApp";
import { TourProvider } from "@/components/tour/tour-provider";
import { TourLauncher } from "@/components/tour/tour-launcher";

// Top-bar profile: avatar (uploaded picture if present, else initials) with a
// menu to jump to Settings or sign out.
function ProfileMenu({ user, onLogout }: { user: AuthUser; onLogout: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const initial = user.email.slice(0, 1).toUpperCase();
  const avatarUrl = (user as { avatarUrl?: string }).avatarUrl;
  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="Account"
        className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-full bg-brand/10 text-sm font-semibold text-brand ring-offset-2 ring-offset-surface transition hover:ring-2 hover:ring-brand/30"
      >
        {avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={avatarUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          initial
        )}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-11 z-50 w-56 overflow-hidden rounded-xl border border-border bg-surface py-1 shadow-lift">
            <div className="flex items-center gap-3 border-b border-border px-4 py-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-brand/10 text-sm font-semibold uppercase text-brand">
                {avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={avatarUrl} alt="" className="h-full w-full object-cover" />
                ) : (
                  initial
                )}
              </span>
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{user.email.split("@")[0]}</div>
                <div className="truncate text-xs capitalize text-muted">{user.role}</div>
              </div>
            </div>
            <Link href="/app/settings" onClick={() => setOpen(false)} className="block px-4 py-2.5 text-sm transition hover:bg-canvas">
              Settings
            </Link>
            <button onClick={onLogout} className="block w-full px-4 py-2.5 text-left text-sm text-[var(--color-negative)] transition hover:bg-canvas">
              Sign out
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  const { user, loading, logout } = useAuth();
  const [drawer, setDrawer] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [hovered, setHovered] = useState(false);
  // After clicking "collapse", the cursor is still over the rail — suppress the
  // hover-peek until the pointer actually leaves, so collapsing visibly sticks.
  const [suppressPeek, setSuppressPeek] = useState(false);

  // Persist the collapsed preference across sessions.
  useEffect(() => {
    setCollapsed(localStorage.getItem("trax_sidebar_collapsed") === "1");
  }, []);
  function toggleCollapsed() {
    setCollapsed((c) => {
      const next = !c;
      try { localStorage.setItem("trax_sidebar_collapsed", next ? "1" : "0"); } catch {}
      if (next) { setHovered(false); setSuppressPeek(true); }
      return next;
    });
  }
  // Expanded whenever not collapsed, or while peeking a collapsed rail on hover.
  const expandedNow = !collapsed || (hovered && !suppressPeek);

  // No loading screen — render nothing until auth resolves, then the app.
  if (loading) return null;
  if (!user) {
    if (typeof window !== "undefined") window.location.href = "/login";
    return null;
  }

  return (
    <TourProvider role={user.role}>
    <div className="flex min-h-screen">
      {/* Desktop sidebar: spacer reserves width so content reflows; the panel
          is fixed so a collapsed rail can expand over the content on hover. */}
      <div className={`hidden shrink-0 transition-[width] duration-200 lg:block ${collapsed ? "w-[76px]" : "w-64"}`} />
      <div
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => { setHovered(false); setSuppressPeek(false); }}
        className={`fixed inset-y-0 left-0 z-40 hidden h-screen border-r border-border bg-surface transition-[width] duration-200 lg:block ${
          expandedNow ? "w-64" : "w-[76px]"
        } ${collapsed && expandedNow ? "shadow-lift" : ""}`}
      >
        <Sidebar user={user} onLogout={logout} collapsed={!expandedNow} onToggleCollapse={toggleCollapsed} />
      </div>

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
              data-tour="mobile-menu"
            >
              ☰
            </button>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/icon-badge.svg" alt="" className="h-7 w-7 lg:hidden" />
          </div>
          <div className="flex items-center gap-1.5">
            <TourLauncher />
            <DownloadApp />
            <NotificationsBell />
            <ProfileMenu user={user} onLogout={logout} />
          </div>
        </header>

        {/* The page entrance animation lives in template.tsx — wrapping children
            in AnimatePresence here left pages blank until a reload. */}
        <main className="flex-1 overflow-auto">
          <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</div>
        </main>
      </div>
    </div>
    </TourProvider>
  );
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <Shell>{children}</Shell>
    </AuthProvider>
  );
}
