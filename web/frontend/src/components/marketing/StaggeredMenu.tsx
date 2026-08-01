"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { gsap } from "gsap";
import "./StaggeredMenu.css";

/**
 * The phone menu: ReactBits' StaggeredMenu, in our colours.
 *
 * Two coloured sheets sweep in from the right, one after the other, and the
 * panel lands on top of them; the items then rise into place one at a time with
 * their numbers fading up behind them. The toggle's plus rotates to a cross and
 * its label cycles Menu → Close on the way.
 *
 * Two things differ from the published component, both because this one has to
 * live inside a nav that already exists:
 *
 *  1. It renders no header of its own. The upstream version ships a logo and a
 *     toggle in an absolutely-positioned bar; here the toggle is returned as a
 *     plain button for `MarketingNav` to place inside its pill, and the logo is
 *     the one already in that bar.
 *  2. The sheets and the panel go through a portal to `document.body`. The nav
 *     applies `backdrop-filter` once it lifts, and a filtered ancestor becomes
 *     the containing block for `position: fixed` — a panel rendered inside it
 *     would be clipped to the nav pill instead of covering the screen.
 *
 * The overlay deliberately sits *below* the nav (z-index 30 against the header's
 * 40, see the CSS) so the bar — and with it the toggle you press to close —
 * stays on top of the panel, which is how the upstream layout behaves too.
 */

/** How far the outer bars of the hamburger sit from the middle one, in px.
 *  Matches the icon box in StaggeredMenu.css — change both together. */
const BAR_OFFSET = 5;

export type StaggeredMenuItem = {
  label: string;
  link: string;
  ariaLabel?: string;
};

export type StaggeredMenuLink = {
  label: string;
  link: string;
  /** Renders as the filled accent button at the foot of the panel. */
  accent?: boolean;
  external?: boolean;
};

type Props = {
  items: StaggeredMenuItem[];
  /** The two CTAs under the list — log in, start free. */
  actions?: StaggeredMenuLink[];
  /** Small print links under those. */
  footerLinks?: StaggeredMenuLink[];
  footerTitle?: string;
  /** Sheets that sweep in ahead of the panel, in arrival order. */
  colors?: string[];
  position?: "left" | "right";
  displayItemNumbering?: boolean;
  /** Classes for the toggle button, so it can match the bar it sits in. */
  toggleClassName?: string;
  /** Width at which the bar shows its own links and hides the toggle; the menu
   *  closes itself there rather than being left open with no way back. */
  autoCloseAbove?: number;
  onOpenChange?: (open: boolean) => void;
};

export function StaggeredMenu({
  items,
  actions = [],
  footerLinks = [],
  footerTitle = "Get in touch",
  colors = ["#ff6600", "#000065"],
  position = "right",
  displayItemNumbering = true,
  toggleClassName = "",
  autoCloseAbove = 768,
  onOpenChange,
}: Props) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [textLines, setTextLines] = useState(["Menu", "Close"]);

  const openRef = useRef(false);
  const panelRef = useRef<HTMLElement | null>(null);
  const preLayersRef = useRef<HTMLDivElement | null>(null);
  const preLayerElsRef = useRef<HTMLElement[]>([]);
  const barTopRef = useRef<HTMLSpanElement | null>(null);
  const barMidRef = useRef<HTMLSpanElement | null>(null);
  const barBottomRef = useRef<HTMLSpanElement | null>(null);
  const iconRef = useRef<HTMLSpanElement | null>(null);
  const textInnerRef = useRef<HTMLSpanElement | null>(null);
  const toggleBtnRef = useRef<HTMLButtonElement | null>(null);

  const openTlRef = useRef<gsap.core.Timeline | null>(null);
  const closeTweenRef = useRef<gsap.core.Tween | null>(null);
  const iconTlRef = useRef<gsap.core.Timeline | null>(null);
  const textCycleAnimRef = useRef<gsap.core.Tween | null>(null);
  const busyRef = useRef(false);

  useEffect(() => setMounted(true), []);

  /* Motion is the whole component, so under prefers-reduced-motion it doesn't
     animate — it cuts. Durations are scaled by this rather than the timeline
     being skipped, so the same code sets the same final state either way. */
  const reduceRef = useRef(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => {
      reduceRef.current = mq.matches;
    };
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  const d = useCallback((seconds: number) => (reduceRef.current ? 0 : seconds), []);

  /* Park everything off-screen once the portal exists. `mounted` is in the deps
     because on the first render there is no panel to place. */
  useLayoutEffect(() => {
    if (!mounted) return;
    const ctx = gsap.context(() => {
      const panel = panelRef.current;
      const preContainer = preLayersRef.current;
      const top = barTopRef.current;
      const mid = barMidRef.current;
      const bottom = barBottomRef.current;
      const icon = iconRef.current;
      const textInner = textInnerRef.current;
      if (!panel || !top || !mid || !bottom || !icon || !textInner) return;

      const preLayers = preContainer
        ? (Array.from(preContainer.querySelectorAll(".sm-prelayer")) as HTMLElement[])
        : [];
      preLayerElsRef.current = preLayers;

      const offscreen = position === "left" ? -100 : 100;
      gsap.set([panel, ...preLayers], { xPercent: offscreen, opacity: 1 });
      if (preContainer) gsap.set(preContainer, { xPercent: 0, opacity: 1 });
      // Three bars at rest: the middle one on the centre line, the other two a
      // bar-and-a-half above and below it.
      gsap.set([top, mid, bottom], { transformOrigin: "50% 50%", rotate: 0 });
      gsap.set(top, { y: -BAR_OFFSET });
      gsap.set(mid, { y: 0, opacity: 1, scaleX: 1 });
      gsap.set(bottom, { y: BAR_OFFSET });
      gsap.set(icon, { rotate: 0, transformOrigin: "50% 50%" });
      gsap.set(textInner, { yPercent: 0 });
    });
    return () => ctx.revert();
  }, [mounted, position]);

  const buildOpenTimeline = useCallback(() => {
    const panel = panelRef.current;
    const layers = preLayerElsRef.current;
    if (!panel) return null;

    openTlRef.current?.kill();
    closeTweenRef.current?.kill();
    closeTweenRef.current = null;

    const itemEls = Array.from(panel.querySelectorAll(".sm-panel-itemLabel")) as HTMLElement[];
    const numberEls = Array.from(
      panel.querySelectorAll(".sm-panel-list[data-numbering] .sm-panel-item")
    ) as HTMLElement[];
    const tailTitle = panel.querySelector(".sm-socials-title");
    const tailLinks = Array.from(panel.querySelectorAll(".sm-socials-link")) as HTMLElement[];

    const offscreen = position === "left" ? -100 : 100;

    if (itemEls.length) gsap.set(itemEls, { yPercent: 140, rotate: 10 });
    if (numberEls.length) gsap.set(numberEls, { "--sm-num-opacity": 0 });
    if (tailTitle) gsap.set(tailTitle, { opacity: 0 });
    if (tailLinks.length) gsap.set(tailLinks, { y: 25, opacity: 0 });

    const tl = gsap.timeline({ paused: true });

    layers.forEach((el, i) => {
      tl.fromTo(
        el,
        { xPercent: offscreen },
        { xPercent: 0, duration: d(0.5), ease: "power4.out" },
        i * d(0.07)
      );
    });
    const lastTime = layers.length ? (layers.length - 1) * d(0.07) : 0;
    const panelInsertTime = lastTime + (layers.length ? d(0.08) : 0);
    const panelDuration = d(0.65);
    tl.fromTo(
      panel,
      { xPercent: offscreen },
      { xPercent: 0, duration: panelDuration, ease: "power4.out" },
      panelInsertTime
    );

    if (itemEls.length) {
      const itemsStart = panelInsertTime + panelDuration * 0.15;
      tl.to(
        itemEls,
        {
          yPercent: 0,
          rotate: 0,
          duration: d(1),
          ease: "power4.out",
          stagger: { each: d(0.1), from: "start" },
        },
        itemsStart
      );
      if (numberEls.length) {
        tl.to(
          numberEls,
          {
            duration: d(0.6),
            ease: "power2.out",
            "--sm-num-opacity": 1,
            stagger: { each: d(0.08), from: "start" },
          },
          itemsStart + d(0.1)
        );
      }
    }

    if (tailTitle || tailLinks.length) {
      const tailStart = panelInsertTime + panelDuration * 0.4;
      if (tailTitle) {
        tl.to(tailTitle, { opacity: 1, duration: d(0.5), ease: "power2.out" }, tailStart);
      }
      if (tailLinks.length) {
        tl.to(
          tailLinks,
          {
            y: 0,
            opacity: 1,
            duration: d(0.55),
            ease: "power3.out",
            stagger: { each: d(0.08), from: "start" },
            onComplete: () => gsap.set(tailLinks, { clearProps: "opacity" }),
          },
          tailStart + d(0.04)
        );
      }
    }

    openTlRef.current = tl;
    return tl;
  }, [d, position]);

  const playOpen = useCallback(() => {
    if (busyRef.current) return;
    busyRef.current = true;
    const tl = buildOpenTimeline();
    if (!tl) {
      busyRef.current = false;
      return;
    }
    tl.eventCallback("onComplete", () => {
      busyRef.current = false;
    });
    tl.play(0);
  }, [buildOpenTimeline]);

  const playClose = useCallback(() => {
    openTlRef.current?.kill();
    openTlRef.current = null;

    const panel = panelRef.current;
    if (!panel) return;

    closeTweenRef.current?.kill();
    const offscreen = position === "left" ? -100 : 100;
    closeTweenRef.current = gsap.to([...preLayerElsRef.current, panel], {
      xPercent: offscreen,
      duration: d(0.32),
      ease: "power3.in",
      overwrite: "auto",
      onComplete: () => {
        const itemEls = Array.from(panel.querySelectorAll(".sm-panel-itemLabel"));
        if (itemEls.length) gsap.set(itemEls, { yPercent: 140, rotate: 10 });
        const numberEls = Array.from(
          panel.querySelectorAll(".sm-panel-list[data-numbering] .sm-panel-item")
        );
        if (numberEls.length) gsap.set(numberEls, { "--sm-num-opacity": 0 });
        const tailTitle = panel.querySelector(".sm-socials-title");
        const tailLinks = Array.from(panel.querySelectorAll(".sm-socials-link"));
        if (tailTitle) gsap.set(tailTitle, { opacity: 0 });
        if (tailLinks.length) gsap.set(tailLinks, { y: 25, opacity: 0 });
        busyRef.current = false;
      },
    });
  }, [d, position]);

  /* Hamburger to cross and back: the outer bars slide onto the centre line and
     tip 45° apart while the middle one drops out from the middle, and the whole
     glyph turns a half-circle as it goes, so the two states are one movement
     rather than a swap. */
  const animateIcon = useCallback(
    (opening: boolean) => {
      const icon = iconRef.current;
      const top = barTopRef.current;
      const mid = barMidRef.current;
      const bottom = barBottomRef.current;
      if (!icon || !top || !mid || !bottom) return;

      iconTlRef.current?.kill();
      const tl = gsap.timeline({ defaults: { overwrite: "auto" } });
      iconTlRef.current = tl;

      tl.to(
        mid,
        { opacity: opening ? 0 : 1, scaleX: opening ? 0.4 : 1, duration: d(0.2), ease: "power2.out" },
        0
      )
        .to(
          top,
          {
            y: opening ? 0 : -BAR_OFFSET,
            rotate: opening ? 45 : 0,
            duration: d(0.4),
            ease: "power3.inOut",
          },
          opening ? d(0.06) : 0
        )
        .to(
          bottom,
          {
            y: opening ? 0 : BAR_OFFSET,
            rotate: opening ? -45 : 0,
            duration: d(0.4),
            ease: "power3.inOut",
          },
          opening ? d(0.06) : 0
        )
        .to(icon, { rotate: opening ? 180 : 0, duration: d(0.5), ease: "power3.inOut" }, 0);
    },
    [d]
  );

  /* The label doesn't swap, it rolls: a short stack of alternating Menu/Close
     lines is built and the column slides to the last one, so the word flickers
     between the two states before settling on the right one. */
  const animateText = useCallback(
    (opening: boolean) => {
      const inner = textInnerRef.current;
      if (!inner) return;
      textCycleAnimRef.current?.kill();

      const target = opening ? "Close" : "Menu";
      const seq = [opening ? "Menu" : "Close"];
      let last = seq[0];
      for (let i = 0; i < 3; i++) {
        last = last === "Menu" ? "Close" : "Menu";
        seq.push(last);
      }
      if (last !== target) seq.push(target);
      seq.push(target);
      setTextLines(seq);

      gsap.set(inner, { yPercent: 0 });
      const finalShift = ((seq.length - 1) / seq.length) * 100;
      textCycleAnimRef.current = gsap.to(inner, {
        yPercent: -finalShift,
        duration: d(0.5 + seq.length * 0.07),
        ease: "power4.out",
      });
    },
    [d]
  );

  const setOpenState = useCallback(
    (target: boolean) => {
      if (openRef.current === target) return;
      openRef.current = target;
      setOpen(target);
      onOpenChange?.(target);
      if (target) playOpen();
      else playClose();
      animateIcon(target);
      animateText(target);
    },
    [animateIcon, animateText, onOpenChange, playClose, playOpen]
  );

  const close = useCallback(() => setOpenState(false), [setOpenState]);

  /* Escape closes it, and the page underneath doesn't scroll while it's up —
     the panel has its own scroll for when the list outgrows a short screen. */
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    const onResize = () => {
      if (window.innerWidth >= autoCloseAbove) close();
    };
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onResize);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onResize);
      document.body.style.overflow = previous;
    };
  }, [open, close, autoCloseAbove]);

  const overlay = (
    <div
      className="staggered-menu-wrapper"
      data-position={position}
      data-open={open || undefined}
    >
      {/* Tapping the page beside the panel closes it. Only present while open,
          so it never sits over the page otherwise. */}
      {open && <button type="button" className="sm-scrim" aria-label="Close menu" onClick={close} />}

      <div ref={preLayersRef} className="sm-prelayers" aria-hidden="true">
        {colors.map((c, i) => (
          <div key={i} className="sm-prelayer" style={{ background: c }} />
        ))}
      </div>

      <aside
        id="staggered-menu-panel"
        ref={panelRef}
        className="staggered-menu-panel"
        aria-hidden={!open}
        inert={!open || undefined}
        aria-label="Menu"
      >
        <div className="sm-panel-inner">
          <ul className="sm-panel-list" role="list" data-numbering={displayItemNumbering || undefined}>
            {items.map((it, idx) => (
              <li className="sm-panel-itemWrap" key={it.label + idx}>
                <a
                  className="sm-panel-item"
                  href={it.link}
                  aria-label={it.ariaLabel ?? it.label}
                  data-index={idx + 1}
                  onClick={close}
                >
                  <span className="sm-panel-itemLabel">{it.label}</span>
                </a>
              </li>
            ))}
          </ul>

          {/* The tail sits on the bottom edge of the panel — the list above it
              takes the room it needs and the space left over falls between the
              two, rather than the CTAs floating directly under the last link.
              Contact first, then the buttons, so the thing you press is the
              thing closest to your thumb. */}
          {footerLinks.length > 0 && (
            <div className="sm-socials" aria-label={footerTitle}>
              <h3 className="sm-socials-title">{footerTitle}</h3>
              <ul className="sm-socials-list" role="list">
                {footerLinks.map((s) => (
                  <li key={s.label} className="sm-socials-item">
                    <a
                      href={s.link}
                      onClick={close}
                      target={s.external ? "_blank" : undefined}
                      rel={s.external ? "noopener noreferrer" : undefined}
                      className="sm-socials-link"
                    >
                      {s.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {actions.length > 0 && (
            <div className="sm-actions">
              {actions.map((a) => (
                <a
                  key={a.label}
                  href={a.link}
                  onClick={close}
                  className={`sm-action${a.accent ? " sm-action--accent" : ""}`}
                >
                  {a.label}
                </a>
              ))}
            </div>
          )}
        </div>
      </aside>
    </div>
  );

  return (
    <>
      <button
        ref={toggleBtnRef}
        type="button"
        className={`sm-toggle ${toggleClassName}`}
        aria-label={open ? "Close menu" : "Open menu"}
        aria-expanded={open}
        aria-controls="staggered-menu-panel"
        onClick={() => setOpenState(!openRef.current)}
      >
        <span className="sm-toggle-textWrap" aria-hidden="true">
          <span ref={textInnerRef} className="sm-toggle-textInner">
            {textLines.map((l, i) => (
              <span className="sm-toggle-line" key={i}>
                {l}
              </span>
            ))}
          </span>
        </span>
        <span ref={iconRef} className="sm-icon" aria-hidden="true">
          <span ref={barTopRef} className="sm-icon-line" />
          <span ref={barMidRef} className="sm-icon-line" />
          <span ref={barBottomRef} className="sm-icon-line" />
        </span>
      </button>

      {mounted ? createPortal(overlay, document.body) : null}
    </>
  );
}

export default StaggeredMenu;
