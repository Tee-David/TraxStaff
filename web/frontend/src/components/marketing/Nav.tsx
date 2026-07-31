"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { APP_URL } from "@/lib/site";
import { useTheme } from "@/lib/theme";
import { toggleThemeWithTransition } from "@/lib/theme-transition";
import { IconMoon, IconSun } from "@/components/icons";

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

/**
 * Light/dark switch, the same one the dashboard carries — same `trax_theme`
 * key, same circular view transition — so a visitor's choice here is the theme
 * they land in once they sign in.
 *
 * It shows the theme you'd switch *to*, and only after mount: the saved theme
 * isn't known during the server render, so drawing a sun before hydration
 * would flip to a moon in front of the visitor on every dark-theme load. The
 * button keeps its box either way, so nothing shifts when the icon arrives.
 */
function ThemeToggle() {
  const [theme, setTheme] = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  const next = theme === "dark" ? "light" : "dark";

  return (
    <button
      type="button"
      onClick={(e) => toggleThemeWithTransition(e, next, setTheme)}
      aria-label={`Switch to the ${next} theme`}
      title={`Switch to the ${next} theme`}
      className="cursor-target flex h-11 w-11 items-center justify-center rounded-full border border-border bg-surface text-ink transition hover:border-border-strong md:h-9 md:w-9"
    >
      {mounted &&
        (theme === "dark" ? <IconSun width={17} height={17} /> : <IconMoon width={17} height={17} />)}
    </button>
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

        {/* Tighter between `md` and `lg`: the centred links are positioned off
            the middle of the bar, so at 768px they run into the theme switch
            on the right. Back to the designed gap from `lg`, where there's
            room for both. */}
        <nav className="absolute left-1/2 hidden -translate-x-1/2 items-center gap-5 md:flex lg:gap-9">
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

        {/* The switch sits outside the desktop-only group so it's reachable on
            a phone too, next to the menu button rather than buried inside it. */}
        <div className="flex items-center gap-2">
          <ThemeToggle />

          <div className="hidden items-center gap-2 md:flex">
            <a
              href={`${APP_URL}/login`}
              className="cursor-target rounded-full border border-border bg-surface px-4 py-2 text-sm font-medium text-ink transition hover:border-border-strong"
            >
              Log in
            </a>
            <a
              href={`${APP_URL}/app`}
              className="mk-cta cursor-target rounded-full bg-accent px-4 py-2 text-sm font-bold transition hover:brightness-105"
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
                className="mk-cta rounded-full bg-accent px-4 py-2.5 text-center text-sm font-bold transition hover:brightness-105"
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
