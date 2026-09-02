"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { api } from "@/lib/api";
import type { AuthUser } from "@/lib/api";
import { SUPPORT_EMAIL } from "@/lib/site";
import { useTheme } from "@/lib/theme";
import { OrgSwitcher } from "@/components/OrgSwitcher";
import { toggleThemeWithTransition } from "@/lib/theme-transition";
import {
  IconAudit, IconBell, IconChart, IconChevron, IconClock, IconDashboard, IconHelp, IconImage,
  IconKanban, IconLogout, IconMoon, IconSearch, IconSettings, IconSidebar, IconSun, IconTrend, IconUsers,
} from "@/components/icons";

/** A globe, for the cross-org console. Local because icons.tsx has no such glyph. */
function IconGlobe({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={`h-[18px] w-[18px] ${className}`}>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18" strokeLinecap="round" />
    </svg>
  );
}

type Role = "owner" | "admin" | "member";
type Item = { href: string; label: string; icon: (p: { className?: string }) => React.ReactNode; roles: Role[]; tourId: string };

/**
 * Platform staff navigation.
 *
 * A separate list rather than a `superAdminOnly` flag on `Item`, because these
 * are not gated by org role at all — `roles` is meaningless for them, and giving
 * every entry a role array it does not use would invite someone to filter on it
 * later and quietly hide the console from the only people who can see it.
 */
type PlatformItem = { href: string; label: string; icon: (p: { className?: string }) => React.ReactNode };

const PLATFORM: PlatformItem[] = [
  { href: "/app/platform", label: "Organizations", icon: IconGlobe },
  { href: "/app/platform/users", label: "All users", icon: IconUsers },
  { href: "/app/platform/time", label: "Time & activity", icon: IconClock },
  { href: "/app/platform/log", label: "Platform log", icon: IconAudit },
];

const MENU: Item[] = [
  { href: "/app", label: "Dashboard", icon: IconDashboard, roles: ["owner", "admin", "member"], tourId: "dashboard" },
  { href: "/app/timesheets", label: "Timesheets", icon: IconClock, roles: ["owner", "admin", "member"], tourId: "timesheets" },
  { href: "/app/reports", label: "Reports", icon: IconChart, roles: ["owner", "admin", "member"], tourId: "reports" },
  { href: "/app/screenshots", label: "Screenshots", icon: IconImage, roles: ["owner", "admin", "member"], tourId: "screenshots" },
  { href: "/app/insights", label: "Insights", icon: IconTrend, roles: ["owner", "admin"], tourId: "insights" },
  { href: "/app/projects", label: "Projects", icon: IconKanban, roles: ["owner", "admin"], tourId: "projects" },
  { href: "/app/members", label: "Members", icon: IconUsers, roles: ["owner", "admin"], tourId: "members" },
  // Every role gets this: a member has their own notifications even though the
  // org-wide flags are admin-only (the API scopes the list per role).
  { href: "/app/notifications", label: "Notifications", icon: IconBell, roles: ["owner", "admin", "member"], tourId: "notifications" },
  // Admin-only, and the API enforces that independently — an audit log a member
  // could read (or narrow to their own actions) is not an audit log.
  { href: "/app/audit", label: "Audit log", icon: IconAudit, roles: ["owner", "admin"], tourId: "audit" },
];
const SECONDARY: Item[] = [
  { href: "/app/settings", label: "Settings", icon: IconSettings, roles: ["owner", "admin", "member"], tourId: "settings" },
];

const DOTS = ["var(--color-cat-focus)", "#ff6600", "#12b5a5", "#8a5cf6", "#e0457b"];

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

  // Counted server-side rather than by pulling a page of rows and filtering it:
  // the old version fetched 100 notifications to produce one integer, and capped
  // the badge at whatever happened to be in that page.
  useEffect(() => {
    api<{ count: number }>("/notifications/unread-count")
      .then((r) => setUnread(r.count))
      .catch(() => {});
  }, [pathname]);

  const menu = MENU.filter((i) => i.roles.includes(user.role) && i.label.toLowerCase().includes(q.toLowerCase()));
  const platform = user.isSuperAdmin
    ? PLATFORM.filter((i) => i.label.toLowerCase().includes(q.toLowerCase()))
    : [];
  const secondary = SECONDARY.filter((i) => i.roles.includes(user.role) && i.label.toLowerCase().includes(q.toLowerCase()));

  const active = (href: string) => (href === "/app" ? pathname === "/app" : pathname.startsWith(href));

  function NavRow({ item }: { item: Item }) {
    const Icon = item.icon;
    const on = active(item.href);
    // The unread count belongs on Notifications. It used to sit on Insights,
    // which read as "25 insights" rather than "25 unread notifications".
    const badge = item.href === "/app/notifications" ? unread : 0;
    return (
      <Link
        href={item.href}
        onClick={onNavigate}
        title={collapsed ? item.label : undefined}
        data-tour={`nav-${item.tourId}`}
        className={`relative flex items-center rounded-xl text-sm font-medium transition ${
          collapsed ? "justify-center px-0 py-2.5" : "gap-3 px-3 py-2.5"
        } ${on ? "bg-brand-soft text-brand" : "text-muted hover:bg-canvas hover:text-ink"}`}
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
      {/* Brand + collapse toggle (opposite the logo). When collapsed, the logo
          itself becomes the expand button so the rail can be re-opened without
          relying on hover. */}
      <div className={`flex items-center pb-4 pt-5 ${collapsed ? "justify-center px-2" : "gap-2.5 px-5"}`}>
        {collapsed && onToggleCollapse ? (
          <button
            onClick={onToggleCollapse}
            aria-label="Expand sidebar"
            title="Expand sidebar"
            className="group relative flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand transition hover:brightness-110"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/icon-white.svg" alt="" className="h-5 w-5 transition group-hover:opacity-0" />
            <span className="absolute inset-0 flex items-center justify-center text-white opacity-0 transition group-hover:opacity-100">
              <IconChevron />
            </span>
          </button>
        ) : (
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/icon-white.svg" alt="" className="h-5 w-5" />
          </span>
        )}
        {!collapsed && <span className="font-heading text-lg font-bold">TraxStaff</span>}
        {!collapsed && onToggleCollapse && (
          <button
            onClick={onToggleCollapse}
            aria-label="Collapse sidebar"
            data-tour="sidebar-collapse"
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

        {platform.length > 0 && (
          <>
            <div className="my-3 border-t border-border" />
            {!collapsed && (
              <div className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-accent">
                Platform
              </div>
            )}
            <div className="space-y-0.5">
              {platform.map((i) => {
                const Icon = i.icon;
                // `/app/platform` is the index, so it must match exactly —
                // otherwise it stays highlighted on every child page, the same
                // trap `active()` already handles for `/app`.
                const on =
                  i.href === "/app/platform" ? pathname === i.href : pathname.startsWith(i.href);
                return (
                  <Link
                    key={i.href}
                    href={i.href}
                    onClick={onNavigate}
                    title={collapsed ? i.label : undefined}
                    className={`relative flex items-center rounded-xl text-sm font-medium transition ${
                      collapsed ? "justify-center px-0 py-2.5" : "gap-3 px-3 py-2.5"
                    } ${on ? "bg-accent-soft text-accent" : "text-muted hover:bg-canvas hover:text-ink"}`}
                  >
                    <Icon className={on ? "text-accent" : "text-faint"} />
                    {!collapsed && <span className="flex-1">{i.label}</span>}
                  </Link>
                );
              })}
            </div>
          </>
        )}

        {secondary.length > 0 && (
          <>
            <div className="my-3 border-t border-border" />
            <div className="space-y-0.5">{secondary.map((i) => <NavRow key={i.href} item={i} />)}</div>
            <a
              href={`mailto:${SUPPORT_EMAIL}`}
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

      </div>

      {/* Theme toggle — hidden when collapsed (reachable on hover-expand) */}
      {!collapsed && (
        <div className="px-4 py-3 flex justify-center">
          <div className="inline-flex rounded-full border border-border bg-canvas p-1 w-full max-w-[200px]">
            <button
              onClick={(e) => toggleThemeWithTransition(e, "light", setTheme)}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-full py-1.5 text-xs font-semibold transition ${
                theme === "light" ? "bg-surface text-brand shadow-[var(--shadow-soft)]" : "text-muted hover:text-ink hover:bg-canvas"
              }`}
            >
              <span className="scale-90"><IconSun /></span> Light
            </button>
            <button
              onClick={(e) => toggleThemeWithTransition(e, "dark", setTheme)}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-full py-1.5 text-xs font-semibold transition ${
                theme === "dark" ? "bg-elevated text-brand shadow-[var(--shadow-soft)]" : "text-muted hover:text-ink hover:bg-canvas"
              }`}
            >
              <span className="scale-90"><IconMoon /></span> Dark
            </button>
          </div>
        </div>
      )}

      {/* Which organization am I looking at — directly above who am I, because
          the two answer the same question about the current session. Renders
          nothing at all unless the account is a super admin, so an ordinary
          user never sees that this exists. */}
      <div className={`border-t border-border ${collapsed ? "px-2 py-2" : "px-4 py-2.5"}`}>
        <OrgSwitcher variant="sidebar" collapsed={collapsed} />
      </div>

      {/* User */}
      <div className={`flex items-center border-t border-border ${collapsed ? "justify-center px-2 py-3.5" : "gap-3 px-4 py-3.5"}`}>
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-soft text-sm font-semibold uppercase text-brand">
          {(user.name?.trim() || user.email).slice(0, 1)}
        </span>
        {!collapsed && (
          <>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{user.name?.trim() || user.email.split("@")[0]}</div>
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

