"use client";

import { motion } from "motion/react";
import { useMotionPresets } from "@/lib/motion";
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
  formatReleaseDate,
  useLatestRelease,
} from "@/lib/releases";

/** A real, working download button. */
function DownloadButton({
  icon,
  label,
  hint,
  href,
  primary,
}: {
  icon: React.ReactNode;
  label: string;
  hint: string;
  href: string;
  primary?: boolean;
}) {
  return (
    <a
      href={href}
      rel="noopener noreferrer"
      className={`flex items-center gap-3 rounded-xl border px-5 py-4 transition ${
        primary
          ? "border-transparent bg-brand text-brand-fg hover:bg-brand-600"
          : "border-border bg-surface text-ink hover:bg-canvas"
      }`}
    >
      <span
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${
          primary ? "bg-white/15" : "bg-canvas text-muted"
        }`}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1 text-left">
        <span className="block text-sm font-semibold">{label}</span>
        <span className={`block text-xs ${primary ? "text-brand-fg/70" : "text-muted"}`}>{hint}</span>
      </span>
      <IconDownload width={16} height={16} />
    </a>
  );
}

/** A visibly non-functional placeholder — never a dead link, never a fake store badge. */
function ComingSoonButton({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div
      className="flex cursor-not-allowed items-center gap-3 rounded-xl border border-dashed border-border px-5 py-4 opacity-60"
      aria-disabled="true"
      title="Not available yet"
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-canvas text-faint">
        {icon}
      </span>
      <span className="min-w-0 flex-1 text-left">
        <span className="block text-sm font-semibold text-muted">{label}</span>
        <span className="block text-xs text-faint">Coming soon</span>
      </span>
    </div>
  );
}

export function DownloadCta() {
  const { page } = useMotionPresets();
  const { state, load } = useLatestRelease();
  const platform = detectDesktopPlatform();
  const primary: "windows" | "linux" = platform === "linux" ? "linux" : "windows";

  return (
    <section id="download" className="mx-auto max-w-4xl px-5 py-20 sm:px-8">
      <motion.div {...page} className="rounded-3xl border border-border bg-surface p-8 shadow-[var(--shadow-lift)] sm:p-12">
        <div className="mx-auto max-w-xl text-center">
          <h2 className="font-heading text-3xl font-bold tracking-tight text-ink sm:text-4xl">
            Get Trax on your machine
          </h2>
          <p className="mt-3 text-base text-muted">
            Real builds from our latest GitHub release &mdash; the same one the
            dashboard&rsquo;s own download button uses.
          </p>
          {state.status === "ready" && (
            <div className="mt-4 flex items-center justify-center gap-2">
              <Badge tone="brand">{state.data.version}</Badge>
              {formatReleaseDate(state.data.publishedAt) && (
                <span className="text-xs text-faint">{formatReleaseDate(state.data.publishedAt)}</span>
              )}
            </div>
          )}
        </div>

        <div className="mt-8">
          {state.status === "loading" && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="skeleton h-[4.5rem] rounded-xl" />
              <div className="skeleton h-[4.5rem] rounded-xl" />
              <div className="skeleton h-[4.5rem] rounded-xl" />
              <div className="skeleton h-[4.5rem] rounded-xl" />
            </div>
          )}

          {state.status === "error" && (
            <div className="flex flex-col items-center gap-3 py-4 text-center">
              <p className="text-sm text-muted">{state.message}</p>
              <div className="flex items-center gap-3">
                <Button variant="ghost" onClick={load}>
                  Try again
                </Button>
                <a
                  href={RELEASES_FALLBACK_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-sm font-medium text-brand hover:underline"
                >
                  GitHub releases <IconExternalLink width={14} height={14} />
                </a>
              </div>
            </div>
          )}

          {state.status === "ready" &&
            (() => {
              const data = state.data;
              const primaryHref = primary === "windows" ? data.windows : data.linuxAppImage;
              const otherHref = primary === "windows" ? data.linuxAppImage ?? data.linuxDeb : data.windows;

              return (
                <div className="space-y-6">
                  <div>
                    <div className="mb-2.5 px-1 text-[11px] font-semibold uppercase tracking-wide text-faint">
                      Desktop
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      {primaryHref ? (
                        <DownloadButton
                          icon={primary === "windows" ? <IconWindows /> : <IconLinux />}
                          label={primary === "windows" ? "Download for Windows" : "Download for Linux"}
                          hint={primary === "windows" ? ".exe installer · 64-bit" : ".AppImage · 64-bit"}
                          href={primaryHref}
                          primary
                        />
                      ) : (
                        <ComingSoonButton
                          icon={primary === "windows" ? <IconWindows /> : <IconLinux />}
                          label={primary === "windows" ? "Windows" : "Linux"}
                        />
                      )}
                      {otherHref ? (
                        <DownloadButton
                          icon={primary === "windows" ? <IconLinux /> : <IconWindows />}
                          label={primary === "windows" ? "Download for Linux" : "Download for Windows"}
                          hint={primary === "windows" ? ".AppImage · 64-bit" : ".exe installer · 64-bit"}
                          href={otherHref}
                        />
                      ) : (
                        <ComingSoonButton
                          icon={primary === "windows" ? <IconLinux /> : <IconWindows />}
                          label={primary === "windows" ? "Linux" : "Windows"}
                        />
                      )}
                    </div>
                    {data.linuxDeb && (
                      <a
                        href={data.linuxDeb}
                        rel="noopener noreferrer"
                        className="mt-2 inline-block pl-1 text-xs font-medium text-brand hover:underline"
                      >
                        or get the .deb package instead
                      </a>
                    )}
                  </div>

                  <div>
                    <div className="mb-2.5 px-1 text-[11px] font-semibold uppercase tracking-wide text-faint">
                      Mobile
                    </div>
                    <div className="grid gap-3 sm:grid-cols-3">
                      {data.android ? (
                        <DownloadButton
                          icon={<IconAndroid />}
                          label="Download for Android"
                          hint="APK · direct install"
                          href={data.android}
                        />
                      ) : (
                        <ComingSoonButton icon={<IconAndroid />} label="Android" />
                      )}
                      <ComingSoonButton icon={<IconApple />} label="App Store (iOS)" />
                      <ComingSoonButton icon={<IconAndroid />} label="Google Play" />
                    </div>
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
    </section>
  );
}
