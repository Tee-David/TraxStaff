"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { APP_URL } from "@/lib/site";

/**
 * Only sections that actually exist on the page — there is no pricing,
 * solutions or customers page to link to, so the nav doesn't pretend there is.
 */
const links = [
  { href: "#features", label: "Features" },
  { href: "#transparency", label: "Transparency" },
  { href: "#download", label: "Download" },
];

/** Small inline menu glyphs — just for this nav, not worth adding to the shared icon set. */
function IconMenu() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" aria-hidden>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  );
}
function IconClose() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" aria-hidden>
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

export function MarketingNav() {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  // The bar starts flush with the hero and only grows a border/shadow once
  // you've left the top, so the first screen reads as one uninterrupted field.
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={`sticky top-0 z-40 transition-colors duration-200 ${
        scrolled || open
          ? "border-b border-border bg-surface/85 backdrop-blur-md"
          : "border-b border-transparent bg-transparent"
      }`}
    >
      <div className="mx-auto flex h-[4.5rem] max-w-6xl items-center justify-between px-5 sm:px-8">
        <a href="#top" className="flex items-center gap-2.5" aria-label="TraxStaff — home">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/icon-badge.svg" alt="" width={32} height={32} className="h-8 w-8" />
          <span className="font-heading text-lg font-bold tracking-[-0.03em] text-ink">TraxStaff</span>
        </a>

        <nav className="absolute left-1/2 hidden -translate-x-1/2 items-center gap-9 md:flex">
          {links.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className="cursor-target py-2.5 text-sm font-medium text-muted transition-colors hover:text-ink"
            >
              {l.label}
            </a>
          ))}
        </nav>

        <div className="hidden items-center gap-2 md:flex">
          <a
            href={`${APP_URL}/login`}
            className="cursor-target rounded-full border border-border bg-surface px-4 py-2 text-sm font-medium text-ink transition hover:border-border-strong"
          >
            Log in
          </a>
          <a
            href={`${APP_URL}/app`}
            className="cursor-target rounded-full bg-accent px-4 py-2 text-sm font-bold text-field transition hover:brightness-105"
          >
            Start free
          </a>
        </div>

        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex h-11 w-11 items-center justify-center rounded-full border border-border bg-surface text-ink transition hover:border-border-strong md:hidden"
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
                  className="rounded-xl px-3 py-2.5 text-sm font-medium text-ink transition hover:bg-canvas"
                >
                  {l.label}
                </a>
              ))}
            </nav>
            <div className="mt-3 flex flex-col gap-2 border-t border-border pt-3">
              <a
                href={`${APP_URL}/login`}
                className="rounded-full border border-border px-4 py-2.5 text-center text-sm font-medium text-ink transition hover:bg-canvas"
              >
                Log in
              </a>
              <a
                href={`${APP_URL}/app`}
                className="rounded-full bg-accent px-4 py-2.5 text-center text-sm font-bold text-field transition hover:brightness-105"
              >
                Start free
              </a>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}
