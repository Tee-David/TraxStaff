import { NextResponse } from "next/server";
import type { LatestRelease } from "@/lib/releases";

/**
 * Surfaces the latest GitHub Release for the "Download app" feature, so the
 * dashboard never hardcodes a version or a download URL.
 *
 * desktop-build.yml and mobile-android.yml attach these assets to a tagged
 * release (verified against a live release response, not just the workflow
 * YAML):
 *   Trax_<version>_x64-setup.exe    — Windows installer (NSIS)
 *   Trax_<version>_amd64.AppImage   — Linux, portable
 *   Trax_<version>_amd64.deb        — Linux, Debian/Ubuntu package
 *   trax-<version>-android.apk      — Android, sideload install
 *   latest.json                     — Tauri auto-updater manifest (not a download)
 *
 * GitHub's unauthenticated API is capped at 60 req/hr per source IP, and this
 * route has no token. A per-instance in-memory cache plus Next's own fetch
 * cache keep normal traffic to roughly one upstream call every few minutes,
 * and a stale cached copy is served if GitHub is down or rate-limited rather
 * than breaking the download button.
 */

const REPO = "Tee-David/trax";
const RELEASES_URL = `https://api.github.com/repos/${REPO}/releases/latest`;
const CACHE_TTL_MS = 5 * 60 * 1000;

export type { LatestRelease };

interface GithubAsset {
  name: string;
  browser_download_url: string;
}

interface GithubRelease {
  tag_name: string;
  published_at: string | null;
  html_url: string | null;
  assets: GithubAsset[];
}

let cache: { data: LatestRelease; expiresAt: number } | null = null;

function findAsset(assets: GithubAsset[], ...patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const hit = assets.find((a) => pattern.test(a.name));
    if (hit) return hit.browser_download_url;
  }
  return null;
}

function parseRelease(release: GithubRelease): LatestRelease {
  const assets = release.assets ?? [];
  return {
    version: release.tag_name,
    publishedAt: release.published_at,
    htmlUrl: release.html_url,
    windows: findAsset(assets, /_x64-setup\.exe$/i, /\.exe$/i),
    linuxAppImage: findAsset(assets, /\.AppImage$/i),
    linuxDeb: findAsset(assets, /\.deb$/i),
    // Prefer a properly release-signed apk; never surface a debug-signed one
    // (mobile-android.yml only attaches the signed apk to a release anyway,
    // but the name pattern is deliberately specific rather than `\.apk$`).
    android: findAsset(assets, /-android\.apk$/i),
  };
}

async function fetchLatestRelease(): Promise<LatestRelease> {
  const res = await fetch(RELEASES_URL, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "trax-web-download-widget",
    },
    // Next's own fetch cache, in addition to the in-memory cache below — belt
    // and suspenders across cold starts / different serverless instances.
    next: { revalidate: 300 },
  });

  if (res.status === 404) {
    throw new Error("No releases have been published yet.");
  }
  if (res.status === 403 || res.status === 429) {
    throw new Error("GitHub API rate limit reached. Try again shortly.");
  }
  if (!res.ok) {
    throw new Error(`GitHub API responded with ${res.status}.`);
  }

  const json = (await res.json()) as GithubRelease;
  return parseRelease(json);
}

export async function GET() {
  const now = Date.now();
  if (cache && cache.expiresAt > now) {
    return NextResponse.json(cache.data, {
      headers: { "Cache-Control": "public, max-age=60, stale-while-revalidate=300" },
    });
  }

  try {
    const data = await fetchLatestRelease();
    cache = { data, expiresAt: now + CACHE_TTL_MS };
    return NextResponse.json(data, {
      headers: { "Cache-Control": "public, max-age=60, stale-while-revalidate=300" },
    });
  } catch (err) {
    // Serve a stale cached copy rather than a dead button, if we have one.
    if (cache) {
      return NextResponse.json(cache.data, {
        headers: { "Cache-Control": "public, max-age=30" },
      });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to reach GitHub" },
      { status: 502 }
    );
  }
}
