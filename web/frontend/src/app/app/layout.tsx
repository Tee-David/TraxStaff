"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { AuthProvider, useAuth } from "@/lib/auth";
import { NotificationsBell } from "@/components/NotificationsBell";

type Role = "owner" | "admin" | "member";

const NAV: { href: string; label: string; icon: string; roles: Role[] }[] = [
  { href: "/app", label: "Dashboard", icon: "▦", roles: ["owner", "admin", "member"] },
  { href: "/app/timesheets", label: "Timesheets", icon: "🕐", roles: ["owner", "admin", "member"] },
  { href: "/app/reports", label: "Reports", icon: "📊", roles: ["owner", "admin", "member"] },
  { href: "/app/screenshots", label: "Screenshots", icon: "🖼", roles: ["owner", "admin", "member"] },
  { href: "/app/insights", label: "Insights", icon: "📈", roles: ["owner", "admin"] },
  { href: "/app/projects", label: "Projects", icon: "🗂", roles: ["owner", "admin"] },
  { href: "/app/members", label: "Members", icon: "👥", roles: ["owner", "admin"] },
  { href: "/app/settings", label: "Settings", icon: "⚙", roles: ["owner", "admin"] },
];

function NavLinks({ role, onNavigate }: { role: Role; onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav className="flex-1 space-y-1 px-3">
      {NAV.filter((i) => i.roles.includes(role)).map((item) => {
        const active = item.href === "/app" ? pathname === "/app" : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
              active ? "bg-brand/10 text-brand" : "text-ink hover:bg-canvas"
            }`}
          >
            <span className="w-5 text-center text-base leading-none">{item.icon}</span>
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

function UserBox({ email, role, onLogout }: { email: string; role: string; onLogout: () => void }) {
  return (
    <div className="border-t border-border px-4 py-4">
      <div className="mb-1 truncate text-sm font-medium">{email}</div>
      <div className="mb-3 text-xs capitalize text-muted">{role}</div>
      <button onClick={onLogout} className="text-sm text-muted underline-offset-2 hover:text-ink hover:underline">
        Sign out
      </button>
    </div>
  );
}

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
      <aside className="hidden w-60 flex-col border-r border-border bg-surface lg:flex">
        <div className="px-6 py-5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/logo-horizontal-color.svg" alt="Trax" className="h-7 w-auto" />
        </div>
        <NavLinks role={user.role} />
        <UserBox email={user.email} role={user.role} onLogout={logout} />
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
              className="fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-border bg-surface lg:hidden"
              initial={{ x: -280 }}
              animate={{ x: 0 }}
              exit={{ x: -280 }}
              transition={{ type: "spring", stiffness: 360, damping: 34 }}
            >
              <div className="px-6 py-5">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/brand/logo-horizontal-color.svg" alt="Trax" className="h-7 w-auto" />
              </div>
              <NavLinks role={user.role} onNavigate={() => setDrawer(false)} />
              <UserBox email={user.email} role={user.role} onLogout={logout} />
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      <div className="flex flex-1 flex-col">
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
