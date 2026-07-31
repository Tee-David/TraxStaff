"use client";

import { motion } from "motion/react";
import { useMotionPresets } from "@/lib/motion";
import { Mark } from "./Mark";
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

/* This section sits on the navy field, so every control below is styled
   against it rather than against the page canvas. */

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
  const { press } = useMotionPresets();

  return (
    <motion.a
      {...press}
      href={href}
      rel="noopener noreferrer"
      className={`cursor-target flex items-center gap-3 rounded-2xl border px-5 py-4 transition ${
        primary
          ? "border-transparent bg-white text-field hover:bg-white/90"
          : "border-white/25 bg-white/[0.09] text-white hover:bg-white/[0.14]"
      }`}
    >
      <span
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
          primary ? "bg-field/10" : "bg-white/10"
        }`}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1 text-left">
        <span className="block text-sm font-semibold">{label}</span>
        <span className={`block text-xs ${primary ? "text-field/60" : "text-white/55"}`}>{hint}</span>
      </span>
      <IconDownload width={16} height={16} />
    </motion.a>
  );
}

/** A visibly non-functional placeholder — never a dead link, never a fake store badge. */
function ComingSoonButton({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div
      className="flex cursor-not-allowed items-center gap-3 rounded-2xl border border-dashed border-white/25 px-5 py-4"
      aria-disabled="true"
      title="Not available yet"
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/[0.06] text-white/40">
        {icon}
      </span>
      <span className="min-w-0 flex-1 text-left">
        <span className="block text-sm font-semibold text-white/65">{label}</span>
        <span className="block text-xs text-white/45">Coming soon</span>
      </span>
    </div>
  );
}

export function DownloadCta() {
  const { revealStagger, revealItem } = useMotionPresets();
  const { state, load } = useLatestRelease();
  const platform = detectDesktopPlatform();
  const primary: "windows" | "linux" = platform === "linux" ? "linux" : "windows";

  return (
    <section id="download" className="bg-surface px-5 pb-24 sm:px-8 lg:pb-28">
      <motion.div
        {...revealStagger()}
        className="mk-on-field mk-grid mk-grid-invert relative mx-auto max-w-5xl overflow-hidden rounded-[2rem] bg-field px-6 py-16 text-white sm:px-12 lg:py-20"
      >
        <div className="mx-auto max-w-xl text-center">
          <motion.h2 {...revealItem} className="font-heading text-[clamp(2rem,3.8vw,3rem)] font-bold leading-[1.06] tracking-[-0.035em]">
            Put it on your <Mark>machine</Mark>
          </motion.h2>
          <motion.p {...revealItem} className="mt-5 text-base leading-relaxed text-white/70">
            Real builds from the latest GitHub release &mdash; the same one the
            dashboard&rsquo;s own download button uses.
          </motion.p>
          {state.status === "ready" && (
            <div className="mt-5 flex items-center justify-center gap-2">
              <span className="rounded-full border border-white/20 bg-white/10 px-2.5 py-1 text-xs font-semibold text-white">
                {state.data.version}
              </span>
              {formatReleaseDate(state.data.publishedAt) && (
                <span className="text-xs text-white/50">{formatReleaseDate(state.data.publishedAt)}</span>
              )}
            </div>
          )}
        </div>

        <motion.div {...revealItem} className="mt-10">
          {/* The shared `.skeleton` shimmer is tuned for the light canvas and
              disappears on navy, so the placeholders get their own here. */}
          {state.status === "loading" && (
            <div className="grid gap-3 sm:grid-cols-2">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="h-[4.5rem] animate-pulse rounded-2xl bg-white/[0.07]" />
              ))}
            </div>
          )}

          {state.status === "error" && (
            <div className="flex flex-col items-center gap-4 py-4 text-center">
              <p className="text-sm text-white/70">{state.message}</p>
              <div className="flex flex-wrap items-center justify-center gap-3">
                <button
                  type="button"
                  onClick={load}
                  className="rounded-full border border-white/20 bg-white/[0.06] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-white/10"
                >
                  Try again
                </button>
                <a
                  href={RELEASES_FALLBACK_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-sm font-medium text-white/70 transition hover:text-white"
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
                    <div className="mb-2.5 px-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-white/55">
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
                        className="mt-1 inline-block px-1 py-2.5 text-xs font-medium text-white/70 transition hover:text-white hover:underline"
                      >
                        or get the .deb package instead
                      </a>
                    )}
                  </div>

                  <div>
                    <div className="mb-2.5 px-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-white/55">
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
                      className="flex items-center justify-center gap-1.5 py-2.5 text-xs font-medium text-white/65 transition hover:text-white hover:underline"
                    >
                      Release notes <IconExternalLink width={13} height={13} />
                    </a>
                  )}
                </div>
              );
            })()}
        </motion.div>
      </motion.div>
    </section>
  );
}
