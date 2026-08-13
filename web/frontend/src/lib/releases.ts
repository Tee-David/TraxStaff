"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Shared with `src/app/api/releases/latest/route.ts` (kept as a plain
 * duplicate rather than a cross-boundary import: importing a type from
 * inside `app/api/**` into client components works today, but ties client
 * bundling to a route module for no benefit — this interface is the
 * contract between them, so it lives here and the route imports it back).
 */
export interface LatestRelease {
  version: string;
  publishedAt: string | null;
  htmlUrl: string | null;
  windows: string | null;
  linuxAppImage: string | null;
  linuxDeb: string | null;
  android: string | null;
}

export type ReleaseLoadState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: LatestRelease };

export type DesktopPlatform = "windows" | "linux" | "mac" | "unknown";

/**
 * Best-effort client-side OS sniff, used to pick which download a "primary"
 * CTA points at. Deliberately does NOT special-case Android here — the
 * Android UA also contains "Linux", and per design Android is always
 * offered as an explicit secondary option rather than something we try to
 * auto-select as the "primary" desktop download.
 */
export function detectDesktopPlatform(): DesktopPlatform {
  if (typeof navigator === "undefined") return "unknown";
  const ua = navigator.userAgent || "";
  const platformHint = navigator.platform || "";
  if (/android/i.test(ua)) return "unknown";
  if (/mac/i.test(platformHint) || /Mac OS X/i.test(ua)) return "mac";
  if (/win/i.test(platformHint) || /windows/i.test(ua)) return "windows";
  if (/linux/i.test(platformHint) || /linux/i.test(ua)) return "linux";
  return "unknown";
}

export function formatReleaseDate(iso: string | null): string | null {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return null;
  }
}

// Public fallback so a caller never dead-ends even if the API route itself
// is unreachable (not just GitHub) — this is just the releases page.
export const RELEASES_FALLBACK_URL = "https://github.com/Tee-David/TraxStaff/releases";

/**
 * Fetches `/api/releases/latest` and tracks load state. Both the dashboard
 * header's `DownloadApp` dropdown and the marketing landing page's download
 * section use this so there is exactly one fetch/cache/error-handling path
 * for "what's the latest release," not two copies that can drift.
 *
 * `lazy: true` (the header dropdown) waits for an explicit `load()` call —
 * no reason to hit the API for every dashboard visit when most users never
 * open the menu. `lazy: false` (the landing page CTA) fetches immediately,
 * since that section's whole job is to show real download links.
 */
export function useLatestRelease(options: { lazy?: boolean } = {}) {
  const { lazy = false } = options;
  const [state, setState] = useState<ReleaseLoadState>(lazy ? { status: "idle" } : { status: "loading" });

  const load = useCallback(async () => {
    setState({ status: "loading" });
    try {
      const res = await fetch("/api/releases/latest");
      const json = await res.json();
      if (!res.ok || json?.error) {
        throw new Error(json?.error || `Request failed (${res.status})`);
      }
      setState({ status: "ready", data: json as LatestRelease });
    } catch (err) {
      setState({
        status: "error",
        message: err instanceof Error ? err.message : "Something went wrong.",
      });
    }
  }, []);

  useEffect(() => {
    if (!lazy) load();
  }, [lazy, load]);

  return { state, load };
}
