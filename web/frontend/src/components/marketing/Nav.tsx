"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { APP_URL } from "@/lib/site";
import { useTheme } from "@/lib/theme";
import { AnimatedThemeToggler } from "@/components/ui/animated-theme-toggler";
import { IconLogin, IconArrowRight } from "@/components/icons";

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
 * Light/dark switch — MagicUI's animated toggler, driven by the app's own
 * theme state rather than its built-in one, so a visitor's choice here is the
 * `trax_theme` they land in once they sign in. The shape wipes across the
 * page from the button on toggle; see the component for the reduced-motion
 * and no-View-Transitions fallbacks.
 */
function ThemeToggle() {
  const [theme, setTheme] = useTheme();

  return (
    <AnimatedThemeToggler
      theme={theme}
      onThemeChange={setTheme}
      variant="circle"
      duration={520}
      className="cursor-target flex h-11 w-11 items-center justify-center rounded-full border border-border bg-surface/70 text-ink transition hover:border-border-strong md:h-9 md:w-9"
    />
  );
}

export function MarketingNav() {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  /* Flush and completely invisible over the hero; once you've left it, the bar
     pulls in off the edges and becomes a floating glass pill.

     The threshold is the hero's own height rather than a fixed 24px, because
     the hero fills the viewport and its background runs up behind this bar (it
     carries a negative top margin of `--mk-nav-h`, see globals.css). While any
     part of the hero is still behind the header there is nothing to separate
     from, so a fill there would read as a band drawn across the artwork. The
     switch happens at `heroHeight - navHeight`, which is the exact scroll
     position where the hero's bottom edge clears the bottom of the bar — so the
     fill arrives as the hero leaves, not before or after it.

     Measured from the DOM rather than assumed: the hero is `100svh`, and `svh`
     can't be computed in JS. Re-measured on resize and orientation change. */
  useEffect(() => {
    const NAV_H = 72; // `--mk-nav-h` / the bar's h-[4.5rem] in its resting state
    let threshold = 24;

    const measure = () => {
      const hero = document.querySelector<HTMLElement>(".mk-hero");
      // Fall back to the old near-immediate lift on any page that reuses this
      // nav without a hero, rather than never lifting at all.
      threshold = hero ? Math.max(0, hero.offsetHeight - NAV_H) : 24;
    };
    const onScroll = () => setScrolled(window.scrollY > threshold);
    const onResize = () => {
      measure();
      onScroll();
    };

    measure();
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  /* Three states, and the transition between them is the whole effect:
     over the hero it's a full-width transparent bar; scrolled away it's an
     inset rounded pill with a blurred, translucent fill; with the phone menu
     open it keeps the fill but squares off enough to hold the panel. */
  const lifted = scrolled || open;

  /* The gap above the pill is padding on the sticky header rather than a
     margin on the pill: a top margin here collapses through the header and the
     pill ends up flush against the viewport edge. */
  return (
    <header
      className={`sticky top-0 z-40 transition-[padding] duration-300 ease-[cubic-bezier(0.22,0.61,0.36,1)] ${
        lifted ? "pt-2.5 sm:pt-3.5" : "pt-0"
      }`}
    >
      <div
        className={`mx-auto transition-all duration-300 ease-[cubic-bezier(0.22,0.61,0.36,1)] ${
          lifted
            ? `w-[calc(100%-1.25rem)] max-w-5xl border border-border/70 bg-surface/70 shadow-[0_14px_44px_-20px_rgba(9,12,25,0.6)] backdrop-blur-xl sm:w-[calc(100%-3rem)] ${
                open ? "rounded-[1.75rem]" : "rounded-full"
              }`
            : "w-full max-w-6xl rounded-none border border-transparent bg-transparent"
        }`}
      >
        <div
          className={`flex items-center justify-between transition-all duration-300 ease-[cubic-bezier(0.22,0.61,0.36,1)] ${
            lifted ? "h-16 px-3.5 sm:h-[4.25rem] sm:px-5" : "h-[4.5rem] px-5 sm:px-8"
          }`}
        >
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
              className="cursor-target inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-4 py-2 text-sm font-medium text-ink transition hover:border-border-strong"
            >
              <IconLogin width={15} height={15} />
              Log in
            </a>
            <a
              href={`${APP_URL}/app`}
              className="mk-cta cursor-target inline-flex items-center gap-1.5 rounded-full bg-accent px-4 py-2 text-sm font-bold transition hover:brightness-105"
            >
              Start free
              <IconArrowRight width={15} height={15} />
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

      {/* Inside the shell, so the panel is part of the same pill rather than a
          separate slab under it. */}
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.22, ease: [0.22, 0.61, 0.36, 1] }}
            className="overflow-hidden border-t border-border/70 px-3.5 pb-4 pt-3 md:hidden"
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
            <div className="mt-3 flex flex-col gap-2 border-t border-border/70 pt-3">
              <a
                href={`${APP_URL}/login`}
                className="flex items-center justify-center gap-2 rounded-full border border-border px-4 py-2.5 text-center text-sm font-medium text-ink transition hover:bg-canvas"
              >
                <IconLogin width={16} height={16} />
                Log in
              </a>
              <a
                href={`${APP_URL}/app`}
                className="mk-cta flex items-center justify-center gap-2 rounded-full bg-accent px-4 py-2.5 text-center text-sm font-bold transition hover:brightness-105"
              >
                Start free
                <IconArrowRight width={16} height={16} />
              </a>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      </div>
    </header>
  );
}
