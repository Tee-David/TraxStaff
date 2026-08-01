"use client";

import { useEffect, useState } from "react";
import { APP_URL, SUPPORT_EMAIL } from "@/lib/site";
import { RELEASES_FALLBACK_URL } from "@/lib/releases";
import { useTheme } from "@/lib/theme";
import { AnimatedThemeToggler } from "@/components/ui/animated-theme-toggler";
import { StaggeredMenu } from "./StaggeredMenu";
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

/**
 * Light/dark switch — MagicUI's animated toggler, driven by the app's own
 * theme state rather than its built-in one, so a visitor's choice here is the
 * `trax_theme` they land in once they sign in. The shape wipes across the
 * page from the button on toggle; see the component for the reduced-motion
 * and no-View-Transitions fallbacks.
 */
function ThemeToggle({ tone }: { tone: string }) {
  const [theme, setTheme] = useTheme();

  return (
    <AnimatedThemeToggler
      theme={theme}
      onThemeChange={setTheme}
      variant="circle"
      duration={520}
      className={`cursor-target flex h-11 w-11 items-center justify-center rounded-full border transition md:h-9 md:w-9 ${tone}`}
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
    // Must track `--mk-nav-h`: the h-[4.5rem] bar plus the 1px transparent
    // border the shell carries in its resting state.
    const NAV_H = 74;
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

  /* Two states now, and the transition between them is the whole effect: over
     the hero it's a full-width transparent bar, scrolled away it's an inset
     rounded pill with a blurred, translucent fill.

     The phone menu takes the bar back to the transparent state while it's open,
     whatever the scroll position. The menu panel is a navy sheet that slides in
     *under* this bar (see StaggeredMenu.css), so a pale pill sitting on it would
     read as a chip of the old page left behind — and the toggle inside the pill
     has to go white to stay legible against that sheet, which it can't do on a
     pale fill. */
  const lifted = scrolled && !open;

  /* Two independent reasons for the bar to go white, and they don't cover the
     same elements:
       - over the hero, but only below `sm`, where the hero stage is dark in both
         themes (see `.mk-hero` in globals.css). That's the wordmark's rule.
       - with the menu open, at any width the menu exists at, because both
         controls on the right sit over the navy panel by then. */
  const overDarkHero = !scrolled;
  const wordmarkTone = overDarkHero ? "text-white sm:text-ink" : "text-ink";
  const controlTone = open
    ? "border-white/25 bg-white/10 text-white hover:border-white/45"
    : overDarkHero
      ? "border-white/25 bg-white/10 text-white hover:border-white/45 sm:border-border sm:bg-surface/70 sm:text-ink sm:hover:border-border-strong"
      : "border-border bg-surface/70 text-ink hover:border-border-strong";

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
            ? "w-[calc(100%-1.25rem)] max-w-5xl rounded-full border border-border/70 bg-surface/70 shadow-[0_14px_44px_-20px_rgba(9,12,25,0.6)] backdrop-blur-xl sm:w-[calc(100%-3rem)]"
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
          <span className={`font-heading text-lg font-bold tracking-[-0.03em] transition-colors ${wordmarkTone}`}>
            TraxStaff
          </span>
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
              className="mk-nav-link cursor-target py-2.5 text-sm font-semibold transition-colors"
            >
              {l.label}
            </a>
          ))}
        </nav>

        {/* The switch sits outside the desktop-only group so it's reachable on
            a phone too, next to the menu button rather than buried inside it. */}
        <div className="flex items-center gap-2">
          <ThemeToggle tone={controlTone} />

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

          {/* The phone menu. The button is placed here, in the bar; the sheets
              and the panel it drives are portalled to the body — see the
              component for why. */}
          <div className="md:hidden">
            <StaggeredMenu
              items={links.map((l) => ({
                label: l.label,
                link: l.href,
                ariaLabel: `Go to ${l.label}`,
              }))}
              actions={[
                { label: "Log in", link: `${APP_URL}/login` },
                { label: "Start free", link: `${APP_URL}/app`, accent: true },
              ]}
              footerLinks={[
                { label: SUPPORT_EMAIL, link: `mailto:${SUPPORT_EMAIL}` },
                { label: "Releases", link: RELEASES_FALLBACK_URL, external: true },
              ]}
              onOpenChange={setOpen}
              toggleClassName={`cursor-target h-11 w-11 rounded-full border transition ${controlTone}`}
            />
          </div>
        </div>
      </div>

      </div>
    </header>
  );
}
