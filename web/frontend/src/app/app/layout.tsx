"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { AuthProvider, useAuth } from "@/lib/auth";

type Role = "owner" | "admin" | "member";

const NAV: { href: string; label: string; roles: Role[] }[] = [
  { href: "/app", label: "Dashboard", roles: ["owner", "admin", "member"] },
  { href: "/app/timesheets", label: "Timesheets", roles: ["owner", "admin", "member"] },
  { href: "/app/reports", label: "Reports", roles: ["owner", "admin", "member"] },
  { href: "/app/screenshots", label: "Screenshots", roles: ["owner", "admin", "member"] },
  { href: "/app/insights", label: "Insights", roles: ["owner", "admin"] },
  { href: "/app/projects", label: "Projects", roles: ["owner", "admin"] },
  { href: "/app/members", label: "Members", roles: ["owner", "admin"] },
  { href: "/app/settings", label: "Settings", roles: ["owner", "admin"] },
];

function Shell({ children }: { children: React.ReactNode }) {
  const { user, loading, logout } = useAuth();
  const pathname = usePathname();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-muted">
        Loading…
      </div>
    );
  }

  if (!user) {
    if (typeof window !== "undefined") window.location.href = "/login";
    return null;
  }

  const nav = NAV.filter((item) => item.roles.includes(user.role));

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-60 flex-col border-r border-border bg-surface">
        <div className="px-6 py-5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/logo-horizontal-color.svg" alt="Trax" className="h-7 w-auto" />
        </div>
        <nav className="flex-1 space-y-1 px-3">
          {nav.map((item) => {
            const active =
              item.href === "/app"
                ? pathname === "/app"
                : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`block rounded-lg px-3 py-2 text-sm font-medium transition ${
                  active ? "bg-brand/10 text-brand" : "text-ink hover:bg-canvas"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-border px-4 py-4">
          <div className="mb-2 truncate text-sm font-medium">{user.email}</div>
          <div className="mb-3 text-xs capitalize text-muted">{user.role}</div>
          <button
            onClick={logout}
            className="text-sm text-muted underline-offset-2 hover:text-ink hover:underline"
          >
            Sign out
          </button>
        </div>
      </aside>
      <main className="flex-1 overflow-auto">
        <div className="mx-auto max-w-6xl px-8 py-8">
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
  );
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <Shell>{children}</Shell>
    </AuthProvider>
  );
}
