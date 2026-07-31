"use client";

import { useState } from "react";
import { motion } from "motion/react";
import { useMotionPresets } from "@/lib/motion";
import { SUPPORT_EMAIL } from "@/lib/site";
import { RELEASES_FALLBACK_URL } from "@/lib/releases";
import { IconMail } from "@/components/icons";

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

/**
 * Newsletter sign-up.
 *
 * Posts to `/api/newsletter`, which mails the address to the support inbox —
 * there is no list service behind it yet, so the copy promises only what that
 * can deliver: occasional product updates, nothing shared. It reports failure
 * rather than showing a thank-you regardless, since the visitor can act on
 * knowing it didn't go through.
 */
function NewsletterForm() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<
    { status: "idle" | "sending" | "done" } | { status: "error"; message: string }
  >({ status: "idle" });

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (state.status === "sending") return;
    setState({ status: "sending" });
    try {
      const res = await fetch("/api/newsletter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        setState({ status: "error", message: data?.error ?? "That didn't go through. Try again?" });
        return;
      }
      setEmail("");
      setState({ status: "done" });
    } catch {
      setState({ status: "error", message: "That didn't go through. Try again?" });
    }
  }

  return (
    <form onSubmit={onSubmit} className="mt-7 max-w-sm">
      <label htmlFor="newsletter-email" className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/40">
        Product updates
      </label>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <input
          id="newsletter-email"
          type="email"
          required
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            if (state.status !== "idle") setState({ status: "idle" });
          }}
          placeholder="you@company.com"
          autoComplete="email"
          className="min-w-0 flex-1 rounded-full border border-white/15 bg-white/5 px-4 py-2.5 text-sm text-white outline-none transition placeholder:text-white/35 focus:border-white/40"
        />
        <button
          type="submit"
          disabled={state.status === "sending"}
          className="mk-cta cursor-target flex shrink-0 items-center justify-center gap-2 rounded-full bg-accent px-5 py-2.5 text-sm font-bold transition hover:brightness-105 disabled:opacity-60"
        >
          <IconMail width={16} height={16} />
          {state.status === "sending" ? "Sending…" : "Subscribe"}
        </button>
      </div>
      <p aria-live="polite" className="mt-2.5 text-xs leading-relaxed text-white/45">
        {state.status === "done"
          ? "Thanks — we've got it. You'll hear from us when there's something worth sending."
          : state.status === "error"
            ? state.message
            : "Occasional product updates. No spam, and we don't pass your address on."}
      </p>
    </form>
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
            <a href="#top" className="flex items-center gap-3" aria-label="TraxStaff — back to top">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/brand/icon-badge.svg" alt="" width={44} height={44} className="h-10 w-10 sm:h-11 sm:w-11" />
              <span className="font-heading text-xl font-bold tracking-[-0.03em] sm:text-[1.375rem]">TraxStaff</span>
            </a>
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-white/55">
              Visible time tracking for teams &mdash; on Windows, Linux and
              Android. Never covert, tamper-evident by design.
            </p>
            <NewsletterForm />
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
