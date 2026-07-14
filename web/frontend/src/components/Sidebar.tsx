"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { api } from "@/lib/api";
import type { AuthUser } from "@/lib/api";
import { useTheme } from "@/lib/theme";
import {
  IconChart, IconChevron, IconClock, IconDashboard, IconHelp, IconImage,
  IconKanban, IconLogout, IconMoon, IconSearch, IconSettings, IconSidebar, IconSun, IconTrend, IconUsers,
} from "@/components/icons";

type Role = "owner" | "admin" | "member";
type Item = { href: string; label: string; icon: (p: { className?: string }) => React.ReactNode; roles: Role[] };

const MENU: Item[] = [
  { href: "/app", label: "Dashboard", icon: IconDashboard, roles: ["owner", "admin", "member"] },
  { href: "/app/timesheets", label: "Timesheets", icon: IconClock, roles: ["owner", "admin", "member"] },
  { href: "/app/reports", label: "Reports", icon: IconChart, roles: ["owner", "admin", "member"] },
  { href: "/app/screenshots", label: "Screenshots", icon: IconImage, roles: ["owner", "admin", "member"] },
  { href: "/app/insights", label: "Insights", icon: IconTrend, roles: ["owner", "admin"] },
  { href: "/app/projects", label: "Projects", icon: IconKanban, roles: ["owner", "admin"] },
  { href: "/app/members", label: "Members", icon: IconUsers, roles: ["owner", "admin"] },
];
const SECONDARY: Item[] = [
  { href: "/app/settings", label: "Settings", icon: IconSettings, roles: ["owner", "admin"] },
];

const DOTS = ["#000065", "#ff6600", "#12b5a5", "#8a5cf6", "#e0457b"];

export function Sidebar({
  user,
  onLogout,
  onNavigate,
  collapsed = false,
  onToggleCollapse,
}: {
  user: AuthUser;
  onLogout: () => void;
  onNavigate?: () => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}) {
  const pathname = usePathname();
  const [theme, setTheme] = useTheme();
  const [q, setQ] = useState("");
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([]);
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    api<{ id: string; name: string }[]>("/projects").then((p) => setProjects(p.slice(0, 4))).catch(() => {});
    api<{ readAt: string | null }[]>("/notifications").then((n) => setUnread(n.filter((x) => !x.readAt).length)).catch(() => {});
  }, []);

  const menu = MENU.filter((i) => i.roles.includes(user.role) && i.label.toLowerCase().includes(q.toLowerCase()));
  const secondary = SECONDARY.filter((i) => i.roles.includes(user.role) && i.label.toLowerCase().includes(q.toLowerCase()));

  const active = (href: string) => (href === "/app" ? pathname === "/app" : pathname.startsWith(href));

  function NavRow({ item }: { item: Item }) {
    const Icon = item.icon;
    const on = active(item.href);
    const badge = item.href === "/app/insights" ? unread : 0;
    return (
      <Link
        href={item.href}
        onClick={onNavigate}
        title={collapsed ? item.label : undefined}
        className={`relative flex items-center rounded-xl text-sm font-medium transition ${
          collapsed ? "justify-center px-0 py-2.5" : "gap-3 px-3 py-2.5"
        } ${on ? "bg-brand/10 text-brand" : "text-muted hover:bg-canvas hover:text-ink"}`}
      >
        <Icon className={on ? "text-brand" : "text-faint"} />
        {!collapsed && <span className="flex-1">{item.label}</span>}
        {badge > 0 &&
          (collapsed ? (
            <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-accent" />
          ) : (
            <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1.5 text-[11px] font-bold text-white">
              {badge}
            </span>
          ))}
      </Link>
    );
  }

  return (
    <div className="flex h-full flex-col bg-surface">
      {/* Brand + collapse toggle (opposite the logo) */}
      <div className={`flex items-center pb-4 pt-5 ${collapsed ? "justify-center px-2" : "gap-2.5 px-5"}`}>
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/icon-white.svg" alt="" className="h-5 w-5" />
        </span>
        {!collapsed && <span className="font-heading text-lg font-bold">Trax</span>}
        {!collapsed && onToggleCollapse && (
          <button
            onClick={onToggleCollapse}
            aria-label="Collapse sidebar"
            className="ml-auto rounded-lg p-1.5 text-faint transition hover:bg-canvas hover:text-ink"
          >
            <IconSidebar />
          </button>
        )}
      </div>

      {/* Search */}
      <div className={collapsed ? "flex justify-center px-2 pb-3" : "px-4 pb-3"}>
        {collapsed ? (
          <button
            aria-label="Search"
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-border bg-canvas text-faint transition hover:text-ink"
          >
            <IconSearch />
          </button>
        ) : (
          <div className="flex items-center gap-2 rounded-xl border border-border bg-canvas px-3 py-2 text-sm text-muted focus-within:border-brand">
            <IconSearch className="text-faint" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search…"
              className="w-full bg-transparent outline-none placeholder:text-faint"
            />
          </div>
        )}
      </div>

      <div className={`flex-1 overflow-y-auto ${collapsed ? "px-2" : "px-3"}`}>
        {!collapsed && <div className="px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-faint">Menu</div>}
        <div className="space-y-0.5">{menu.map((i) => <NavRow key={i.href} item={i} />)}</div>

        {secondary.length > 0 && (
          <>
            <div className="my-3 border-t border-border" />
            <div className="space-y-0.5">{secondary.map((i) => <NavRow key={i.href} item={i} />)}</div>
            <a
              href="mailto:support@trax.app"
              title={collapsed ? "Support" : undefined}
              className={`flex items-center rounded-xl text-sm font-medium text-muted transition hover:bg-canvas hover:text-ink ${
                collapsed ? "justify-center px-0 py-2.5" : "gap-3 px-3 py-2.5"
              }`}
            >
              <IconHelp className="text-faint" />
              {!collapsed && <span>Support</span>}
            </a>
          </>
        )}

        {/* Projects group — labels only make sense when expanded */}
        {!collapsed && projects.length > 0 && (
          <>
            <div className="px-2 pb-1 pt-4 text-[11px] font-semibold uppercase tracking-wider text-faint">Projects</div>
            <div className="space-y-0.5">
              {projects.map((p, i) => (
                <Link
                  key={p.id}
                  href="/app/projects"
                  onClick={onNavigate}
                  className="flex items-center gap-3 rounded-xl px-3 py-2 text-sm text-muted transition hover:bg-canvas hover:text-ink"
                >
                  <span className="h-2 w-2 rounded-full" style={{ background: DOTS[i % DOTS.length] }} />
                  <span className="flex-1 truncate">{p.name}</span>
                  <IconChevron className="h-4 w-4 text-faint" />
                </Link>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Theme toggle — hidden when collapsed (reachable on hover-expand) */}
      {!collapsed && (
        <div className="px-4 py-3">
          <div className="flex rounded-xl border border-border bg-canvas p-1">
            <button
              onClick={() => setTheme("light")}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-medium transition ${
                theme === "light" ? "bg-surface text-ink shadow-sm" : "text-muted"
              }`}
            >
              <IconSun className="h-4 w-4" /> Light
            </button>
            <button
              onClick={() => setTheme("dark")}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-medium transition ${
                theme === "dark" ? "bg-elevated text-ink shadow-sm" : "text-muted"
              }`}
            >
              <IconMoon className="h-4 w-4" /> Dark
            </button>
          </div>
        </div>
      )}

      {/* User */}
      <div className={`flex items-center border-t border-border ${collapsed ? "justify-center px-2 py-3.5" : "gap-3 px-4 py-3.5"}`}>
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand/10 text-sm font-semibold uppercase text-brand">
          {user.email.slice(0, 1)}
        </span>
        {!collapsed && (
          <>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{user.email.split("@")[0]}</div>
              <div className="truncate text-xs text-muted">{user.email}</div>
            </div>
            <button onClick={onLogout} aria-label="Sign out" className="rounded-lg p-1.5 text-faint transition hover:bg-canvas hover:text-ink">
              <IconLogout />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
