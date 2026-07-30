"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { APP_URL } from "@/lib/site";

const links = [
  { href: "#features", label: "Features" },
  { href: "#download", label: "Download" },
];

/** Small inline menu glyphs — just for this nav, not worth adding to the shared icon set. */
function IconMenu() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" aria-hidden>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  );
}
function IconClose() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" aria-hidden>
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

export function MarketingNav() {
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-surface/85 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5 sm:px-8">
        <a href="#top" className="flex items-center gap-2.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/icon-badge.svg" alt="" width={32} height={32} className="h-8 w-8" />
          <span className="font-heading text-lg font-bold tracking-tight text-ink">Trax</span>
        </a>

        <nav className="hidden items-center gap-8 md:flex">
          {links.map((l) => (
            <a key={l.href} href={l.href} className="text-sm font-medium text-muted transition hover:text-ink">
              {l.label}
            </a>
          ))}
        </nav>

        <div className="hidden items-center gap-2 md:flex">
          <a
            href={`${APP_URL}/login`}
            className="rounded-lg px-3.5 py-2 text-sm font-medium text-ink transition hover:bg-canvas"
          >
            Log In
          </a>
          <a
            href={`${APP_URL}/app`}
            className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-brand-fg transition hover:bg-brand-600"
          >
            Get Started
          </a>
        </div>

        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex h-9 w-9 items-center justify-center rounded-lg text-ink transition hover:bg-canvas md:hidden"
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
        >
          {open ? <IconClose /> : <IconMenu />}
        </button>
      </div>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.15 }}
            className="border-t border-border bg-surface px-5 pb-5 pt-3 md:hidden"
          >
            <nav className="flex flex-col gap-1">
              {links.map((l) => (
                <a
                  key={l.href}
                  href={l.href}
                  onClick={() => setOpen(false)}
                  className="rounded-lg px-3 py-2.5 text-sm font-medium text-ink transition hover:bg-canvas"
                >
                  {l.label}
                </a>
              ))}
            </nav>
            <div className="mt-3 flex flex-col gap-2 border-t border-border pt-3">
              <a
                href={`${APP_URL}/login`}
                className="rounded-lg border border-border px-4 py-2.5 text-center text-sm font-medium text-ink transition hover:bg-canvas"
              >
                Log In
              </a>
              <a
                href={`${APP_URL}/app`}
                className="rounded-lg bg-brand px-4 py-2.5 text-center text-sm font-semibold text-brand-fg transition hover:bg-brand-600"
              >
                Get Started
              </a>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}
