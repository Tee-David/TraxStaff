"use client";

import { useEffect, useRef, useState } from "react";
import { useActingOrg } from "@/lib/acting-org";
import { useAuth } from "@/lib/auth";

/**
 * The org switcher, and the banner that keeps it honest.
 *
 * The switcher on its own would be a quiet way to do the wrong thing to the
 * wrong tenant: every page looks identical whichever org is selected, so the
 * only thing standing between "edit this member" and "edit a stranger" is
 * remembering what the dropdown said. Hence `ActingOrgBanner` below, which is
 * not dismissible and is loud on purpose.
 */

function IconBuilding({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}>
      <path d="M3 21h18M5 21V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16M15 21V9h2a2 2 0 0 1 2 2v10" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M9 7h2M9 11h2M9 15h2" strokeLinecap="round" />
    </svg>
  );
}

export function OrgSwitcher({
  variant = "topbar",
  collapsed = false,
}: {
  /**
   * `sidebar` sits in the left rail above the signed-in user, which is where
   * "which organization am I looking at" belongs — next to "who am I", not
   * among the bell and the download button. Its menu opens UPWARD, because at
   * the bottom of the rail there is nothing below it to open into.
   */
  variant?: "topbar" | "sidebar";
  /** Collapsed rail: icon only. The rail expands on hover, so the menu still fits. */
  collapsed?: boolean;
} = {}) {
  const { user } = useAuth();
  const { orgId, org, orgs, switchTo } = useActingOrg();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // Focus the box on open and clear it on close, so the switcher is usable from
  // the keyboard alone and never reopens showing a filter from last time.
  useEffect(() => {
    if (open) searchRef.current?.focus();
    else setQ("");
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function outside(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", outside);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", outside);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!user?.isSuperAdmin) return null;

  const label = org?.name ?? "Your organization";
  const elsewhere = Boolean(orgId);
  const needle = q.trim().toLowerCase();
  const shown = needle ? orgs.filter((o) => o.name.toLowerCase().includes(needle)) : orgs;

  const sidebar = variant === "sidebar";

  return (
    <div className={sidebar ? "relative" : "relative"} ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        title={sidebar && collapsed ? label : undefined}
        className={`flex items-center gap-2 rounded-lg border text-sm font-medium transition ${
          sidebar
            ? collapsed
              ? "w-full justify-center px-2 py-2"
              : "w-full px-3 py-2"
            : "px-3 py-1.5"
        } ${
          elsewhere
            ? "border-accent/40 bg-accent/10 text-accent"
            : "border-border bg-surface text-muted hover:bg-canvas"
        }`}
        aria-label="Switch organization"
      >
        <IconBuilding className="h-4 w-4 shrink-0" />
        {!(sidebar && collapsed) && (
          <>
            <span className={`truncate ${sidebar ? "flex-1 text-left" : "max-w-[10rem]"}`}>{label}</span>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-3.5 w-3.5 shrink-0">
              <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </>
        )}
      </button>

      {open && (
        <div
          className={`absolute z-50 overflow-hidden rounded-xl border border-border bg-surface shadow-lift ${
            sidebar ? "bottom-full left-0 mb-2 w-[17rem]" : "right-0 top-11 w-72"
          }`}
        >
          <div className="border-b border-border px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-faint">
            Operate as
          </div>

          {/* A deployment with fifty customers is a scroll, not a list. */}
          <div className="border-b border-border p-2">
            <input
              ref={searchRef}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search organizations…"
              className="w-full rounded-lg border border-border bg-canvas px-3 py-1.5 text-sm outline-none placeholder:text-faint focus:border-brand"
            />
          </div>

          <button
            onClick={() => {
              setOpen(false);
              switchTo(null);
            }}
            className={`flex w-full items-center justify-between px-4 py-2.5 text-left text-sm transition hover:bg-canvas ${
              !elsewhere ? "font-semibold text-brand" : ""
            }`}
          >
            <span>Your organization</span>
            {!elsewhere && <span className="text-xs text-faint">current</span>}
          </button>

          <div className="max-h-72 overflow-y-auto border-t border-border">
            {shown.length === 0 && (
              <div className="px-4 py-3 text-sm text-muted">
                {orgs.length === 0 ? "No organizations found." : `Nothing matches “${q.trim()}”.`}
              </div>
            )}
            {shown.map((o) => (
              <button
                key={o.id}
                onClick={() => {
                  setOpen(false);
                  switchTo(o.id);
                }}
                className={`flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left text-sm transition hover:bg-canvas ${
                  o.id === orgId ? "font-semibold text-brand" : ""
                }`}
              >
                <span className="min-w-0 flex-1 truncate">
                  {o.name}
                  {o.status === "suspended" && (
                    <span className="ml-2 rounded bg-[var(--color-negative)]/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-[var(--color-negative)]">
                      Suspended
                    </span>
                  )}
                </span>
                <span className="shrink-0 text-xs text-faint">
                  {o.memberCount} {o.memberCount === 1 ? "member" : "members"}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Shown across the top of every page while acting on another organization.
 *
 * Deliberately not dismissible, and deliberately the one loud thing on the
 * screen. Everything else in this app looks the same whichever org is selected,
 * so this strip is the only difference between reading a report and reading
 * somebody else's report — and between disabling your own colleague and
 * disabling a customer's.
 */
export function ActingOrgBanner() {
  const { user } = useAuth();
  const { orgId, org, switchTo } = useActingOrg();

  if (!user?.isSuperAdmin || !orgId) return null;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-accent/30 bg-accent/10 px-4 py-2 text-sm lg:px-8">
      <div className="flex min-w-0 items-center gap-2">
        <span className="relative flex h-2 w-2 shrink-0">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-60" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-accent" />
        </span>
        <span className="min-w-0 truncate text-accent">
          Operating as <strong className="font-semibold">{org?.name ?? "another organization"}</strong>
          {org?.status === "suspended" && " — this workspace is suspended"}
        </span>
      </div>
      <button
        onClick={() => switchTo(null)}
        className="shrink-0 rounded-lg border border-accent/40 px-3 py-1 text-xs font-semibold text-accent transition hover:bg-accent/10"
      >
        Return to your organization
      </button>
    </div>
  );
}
