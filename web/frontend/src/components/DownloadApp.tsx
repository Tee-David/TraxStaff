"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Badge, Button } from "@/components/ui";
import {
  IconDownload,
  IconWindows,
  IconLinux,
  IconAndroid,
  IconApple,
  IconExternalLink,
} from "@/components/icons";
import {
  RELEASES_FALLBACK_URL,
  detectDesktopPlatform,
  formatReleaseDate as formatDate,
  useLatestRelease,
} from "@/lib/releases";

/** A download row used for the non-primary platform options. */
function PlatformRow({
  icon,
  label,
  hint,
  href,
  disabled,
}: {
  icon: React.ReactNode;
  label: string;
  hint: string;
  href?: string | null;
  disabled?: boolean;
}) {
  const inner = (
    <>
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-canvas text-muted">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium text-ink">{label}</span>
        <span className="block truncate text-xs text-muted">{hint}</span>
      </span>
    </>
  );

  if (disabled || !href) {
    return (
      <div className="flex items-center gap-3 rounded-lg px-2.5 py-2 opacity-50">
        {inner}
      </div>
    );
  }

  return (
    <a
      href={href}
      rel="noopener noreferrer"
      className="flex items-center gap-3 rounded-lg px-2.5 py-2 transition hover:bg-canvas"
    >
      {inner}
    </a>
  );
}

export function DownloadApp() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Lazy-load: only hit the API the first time someone actually opens this,
  // rather than on every dashboard load — the route is cached server-side
  // too, but there's no reason to fetch for users who never click it.
  const { state, load } = useLatestRelease({ lazy: true });
  useEffect(() => {
    if (open && state.status === "idle") load();
  }, [open, state.status, load]);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const platform = detectDesktopPlatform();
  const primary: "windows" | "linux" = platform === "linux" ? "linux" : "windows";

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="relative flex items-center gap-1.5 rounded-lg p-2 text-muted transition hover:bg-canvas hover:text-ink"
        aria-label="Download app"
        title="Download app"
      >
        <IconDownload />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.15 }}
            className="absolute right-0 mt-2 w-[23rem] max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-border bg-surface shadow-lg"
          >
            {/* Header */}
            <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3.5">
              <div className="min-w-0">
                <div className="font-heading text-sm font-semibold">Download Trax</div>
                <div className="text-xs text-muted">Desktop tracker &amp; mobile app</div>
              </div>
              {state.status === "ready" && (
                <div className="flex shrink-0 flex-col items-end gap-0.5">
                  <Badge tone="brand">{state.data.version}</Badge>
                  {formatDate(state.data.publishedAt) && (
                    <span className="text-[11px] text-faint">{formatDate(state.data.publishedAt)}</span>
                  )}
                </div>
              )}
            </div>

            <div className="max-h-[28rem] overflow-y-auto p-4">
              {state.status === "loading" && (
                <div className="space-y-2.5">
                  <div className="skeleton h-11 w-full rounded-lg" />
                  <div className="skeleton h-9 w-full rounded-lg" />
                  <div className="skeleton h-9 w-2/3 rounded-lg" />
                </div>
              )}

              {state.status === "error" && (
                <div className="flex flex-col items-center gap-3 py-4 text-center">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--color-negative)]/10 text-[var(--color-negative)]">
                    <IconDownload />
                  </div>
                  <div>
                    <div className="text-sm font-medium text-ink">Couldn&rsquo;t check for the latest build</div>
                    <p className="mt-0.5 text-xs text-muted">{state.message}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button variant="ghost" className="px-3 py-1.5 text-xs" onClick={load}>
                      Try again
                    </Button>
                    <a
                      href={RELEASES_FALLBACK_URL}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-medium text-brand hover:underline"
                    >
                      GitHub releases <IconExternalLink width={13} height={13} />
                    </a>
                  </div>
                </div>
              )}

              {state.status === "ready" && (() => {
                const data = state.data;
                const primaryHref = primary === "windows" ? data.windows : data.linuxAppImage;
                const primaryLabel = primary === "windows" ? "Download for Windows" : "Download for Linux";
                const primaryHint =
                  primary === "windows" ? ".exe installer · 64-bit" : ".AppImage · 64-bit, portable";
                const PrimaryIcon = primary === "windows" ? IconWindows : IconLinux;

                return (
                  <div className="space-y-4">
                    {/* Primary CTA, matched to the detected OS */}
                    <div>
                      {primaryHref ? (
                        <a
                          href={primaryHref}
                          rel="noopener noreferrer"
                          className="flex w-full items-center gap-3 rounded-xl bg-brand px-4 py-3 text-brand-fg transition hover:bg-brand-600"
                        >
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/15">
                            <PrimaryIcon />
                          </span>
                          <span className="min-w-0 flex-1 text-left">
                            <span className="block text-sm font-semibold">{primaryLabel}</span>
                            <span className="block text-xs text-brand-fg/70">{primaryHint}</span>
                          </span>
                          <IconDownload />
                        </a>
                      ) : (
                        <div className="rounded-xl border border-dashed border-border px-4 py-3 text-center text-xs text-muted">
                          No {primary === "windows" ? "Windows" : "Linux"} build attached to this release yet.
                        </div>
                      )}
                      {primary === "linux" && data.linuxDeb && (
                        <a
                          href={data.linuxDeb}
                          rel="noopener noreferrer"
                          className="mt-1.5 inline-flex items-center gap-1 pl-1 text-xs font-medium text-brand hover:underline"
                        >
                          or get the .deb package instead
                        </a>
                      )}
                      {platform === "mac" && (
                        <p className="mt-2 text-xs text-muted">
                          Trax isn&rsquo;t packaged for macOS yet — Windows and Linux builds are ready below.
                        </p>
                      )}
                    </div>

                    {/* Other desktop platforms */}
                    <div>
                      <div className="mb-1 px-1 text-[11px] font-semibold uppercase tracking-wide text-faint">
                        Other platforms
                      </div>
                      <div className="space-y-0.5">
                        {primary !== "windows" && (
                          <PlatformRow icon={<IconWindows />} label="Windows" hint=".exe installer · 64-bit" href={data.windows} />
                        )}
                        {primary !== "linux" && (
                          <PlatformRow
                            icon={<IconLinux />}
                            label="Linux"
                            hint={data.linuxAppImage && data.linuxDeb ? "AppImage or .deb" : "AppImage · 64-bit"}
                            href={data.linuxAppImage ?? data.linuxDeb}
                          />
                        )}
                        <PlatformRow icon={<IconApple />} label="macOS" hint="Not available yet" disabled />
                      </div>
                    </div>

                    {/* Mobile — always secondary/explicit, never auto-selected */}
                    <div className="border-t border-border pt-3">
                      <div className="mb-1 px-1 text-[11px] font-semibold uppercase tracking-wide text-faint">
                        Mobile
                      </div>
                      {data.android ? (
                        <a
                          href={data.android}
                          rel="noopener noreferrer"
                          className="flex items-center gap-3 rounded-lg bg-accent/10 px-2.5 py-2 transition hover:bg-accent/15"
                        >
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-accent">
                            <IconAndroid />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-[13px] font-medium text-ink">Get the mobile app</span>
                            <span className="block truncate text-xs text-muted">Android APK · direct install</span>
                          </span>
                        </a>
                      ) : (
                        <PlatformRow icon={<IconAndroid />} label="Android" hint="Not available yet" disabled />
                      )}
                    </div>

                    {data.htmlUrl && (
                      <a
                        href={data.htmlUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center justify-center gap-1 text-xs font-medium text-muted hover:text-ink hover:underline"
                      >
                        Release notes <IconExternalLink width={13} height={13} />
                      </a>
                    )}
                  </div>
                );
              })()}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
