"use client";

import { motion } from "motion/react";
import { useMotionPresets } from "@/lib/motion";
import { SUPPORT_EMAIL } from "@/lib/site";
import { RELEASES_FALLBACK_URL } from "@/lib/releases";

/**
 * Only links to things that actually exist: there is no privacy policy, terms
 * page, or any other legal page in this app yet, so there is no "Legal" column
 * here — and no social icons, since none of those accounts are confirmed to
 * exist. Add both back once they're real.
 *
 * Sits on the deeper navy so it reads as a distinct band under the download
 * panel rather than one continuous slab.
 *
 * A client component only so its columns can fade up with the rest of the
 * page; there is no interactivity here beyond the links.
 */
const product = [
  { href: "#features", label: "Features" },
  { href: "#transparency", label: "Transparency" },
  { href: "#download", label: "Download" },
];

const platforms = [
  { label: "Windows", href: "#download" },
  { label: "Linux", href: "#download" },
  { label: "Android", href: "#download" },
];

function Column({
  title,
  children,
  item,
}: {
  title: string;
  children: React.ReactNode;
  item: Record<string, unknown>;
}) {
  return (
    <motion.div {...item}>
      <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/40">{title}</div>
      <ul className="mt-4 space-y-3">{children}</ul>
    </motion.div>
  );
}

export function Footer({ currentYear }: { currentYear: number }) {
  const { revealStagger, revealItem } = useMotionPresets();

  return (
    <footer className="mk-on-field bg-field-deep text-white">
      <div className="mx-auto max-w-6xl px-5 py-16 sm:px-8 lg:py-20">
        <motion.div
          {...revealStagger()}
          className="grid gap-12 sm:grid-cols-2 lg:grid-cols-[1.6fr_1fr_1fr_1fr]"
        >
          <motion.div {...revealItem}>
            <a href="#top" className="flex items-center gap-2.5" aria-label="TraxStaff — back to top">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/brand/icon-badge.svg" alt="" width={30} height={30} className="h-[1.875rem] w-[1.875rem]" />
              <span className="font-heading text-base font-bold tracking-[-0.03em]">TraxStaff</span>
            </a>
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-white/55">
              Visible time tracking for teams &mdash; on Windows, Linux and
              Android. Never covert, tamper-evident by design.
            </p>
          </motion.div>

          <Column title="Product" item={revealItem}>
            {product.map((l) => (
              <li key={l.href}>
                <a href={l.href} className="cursor-target inline-block py-1 text-sm text-white/60 transition hover:text-white">
                  {l.label}
                </a>
              </li>
            ))}
          </Column>

          <Column title="Platforms" item={revealItem}>
            {platforms.map((p) => (
              <li key={p.label}>
                <a href={p.href} className="cursor-target inline-block py-1 text-sm text-white/60 transition hover:text-white">
                  {p.label}
                </a>
              </li>
            ))}
            <li className="text-sm text-white/35">iOS &mdash; soon</li>
          </Column>

          <Column title="Contact" item={revealItem}>
            <li>
              <a
                href={`mailto:${SUPPORT_EMAIL}`}
                className="cursor-target inline-block py-1 text-sm text-white/60 transition hover:text-white"
              >
                {SUPPORT_EMAIL}
              </a>
            </li>
            <li>
              <a
                href={RELEASES_FALLBACK_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="cursor-target inline-block py-1 text-sm text-white/60 transition hover:text-white"
              >
                Releases
              </a>
            </li>
          </Column>
        </motion.div>

        <motion.div {...revealStagger()} className="mt-14 border-t border-white/10 pt-6">
          <motion.p {...revealItem} className="text-xs text-white/40">
            &copy; {currentYear} TraxStaff. All rights reserved.
          </motion.p>
        </motion.div>
      </div>
    </footer>
  );
}
