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
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/40">{title}</div>
      <ul className="mt-4 space-y-3">{children}</ul>
    </div>
  );
}

export function Footer({ currentYear }: { currentYear: number }) {
  return (
    <footer className="mk-on-field bg-field-deep text-white">
      <div className="mx-auto max-w-6xl px-5 py-16 sm:px-8 lg:py-20">
        <div className="grid gap-12 sm:grid-cols-2 lg:grid-cols-[1.6fr_1fr_1fr_1fr]">
          <div>
            <a href="#top" className="flex items-center gap-2.5" aria-label="TraxStaff — back to top">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/brand/icon-badge.svg" alt="" width={30} height={30} className="h-[1.875rem] w-[1.875rem]" />
              <span className="font-heading text-base font-bold tracking-[-0.03em]">TraxStaff</span>
            </a>
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-white/55">
              Visible time tracking for teams &mdash; on Windows, Linux and
              Android. Never covert, tamper-evident by design.
            </p>
          </div>

          <Column title="Product">
            {product.map((l) => (
              <li key={l.href}>
                <a href={l.href} className="text-sm text-white/60 transition hover:text-white">
                  {l.label}
                </a>
              </li>
            ))}
          </Column>

          <Column title="Platforms">
            {platforms.map((p) => (
              <li key={p.label}>
                <a href={p.href} className="text-sm text-white/60 transition hover:text-white">
                  {p.label}
                </a>
              </li>
            ))}
            <li className="text-sm text-white/35">iOS &mdash; soon</li>
          </Column>

          <Column title="Contact">
            <li>
              <a
                href={`mailto:${SUPPORT_EMAIL}`}
                className="text-sm text-white/60 transition hover:text-white"
              >
                {SUPPORT_EMAIL}
              </a>
            </li>
            <li>
              <a
                href={RELEASES_FALLBACK_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-white/60 transition hover:text-white"
              >
                Releases
              </a>
            </li>
          </Column>
        </div>

        <div className="mt-14 border-t border-white/10 pt-6">
          <p className="text-xs text-white/40">
            &copy; {currentYear} TraxStaff. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  );
}
