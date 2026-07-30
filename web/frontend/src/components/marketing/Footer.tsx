import { SUPPORT_EMAIL } from "@/lib/site";

/**
 * Only links to pages that actually exist: there is no privacy policy,
 * terms page, or any other legal page in this app yet, so there is no
 * "Legal" column here — and no social icons, since none of those accounts
 * are confirmed to exist. Add both back once they're real.
 */
export function Footer({ currentYear }: { currentYear: number }) {
  return (
    <footer className="border-t border-border bg-canvas/60">
      <div className="mx-auto max-w-6xl px-5 py-14 sm:px-8">
        <div className="grid gap-10 sm:grid-cols-[1.4fr_1fr_1fr]">
          <div>
            <a href="#top" className="flex items-center gap-2.5">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/brand/icon-badge.svg" alt="" width={28} height={28} className="h-7 w-7" />
              <span className="font-heading text-base font-bold tracking-tight text-ink">Trax</span>
            </a>
            <p className="mt-3 max-w-xs text-sm text-muted">
              Visible time tracking for teams &mdash; on Windows, Linux and Android.
            </p>
          </div>

          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-faint">Product</div>
            <ul className="mt-3 space-y-2.5">
              <li>
                <a href="#features" className="text-sm text-muted transition hover:text-ink">
                  Features
                </a>
              </li>
              <li>
                <a href="#download" className="text-sm text-muted transition hover:text-ink">
                  Download
                </a>
              </li>
            </ul>
          </div>

          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-faint">Company</div>
            <ul className="mt-3 space-y-2.5">
              <li>
                <a href={`mailto:${SUPPORT_EMAIL}`} className="text-sm text-muted transition hover:text-ink">
                  {SUPPORT_EMAIL}
                </a>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-12 border-t border-border pt-6">
          <p className="text-xs text-faint">&copy; {currentYear} Trax. All rights reserved.</p>
        </div>
      </div>
    </footer>
  );
}
