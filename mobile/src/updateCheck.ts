import Application from "expo-application";

// The web dashboard already exposes this for its own download button (see
// web/frontend/src/app/api/releases/latest/route.ts); mobile just reads the
// same endpoint rather than talking to GitHub's API directly.
//
// Password reset uses the same host/constant pattern — see app/login.tsx.
const APP_WEB_URL = "https://app.traxstaff.com";

export type ReleaseInfo = {
  version: string;
  publishedAt: string;
  htmlUrl: string;
  windows: string | null;
  linuxAppImage: string | null;
  linuxDeb: string | null;
  android: string | null;
};

export type UpdateCheckResult = {
  updateAvailable: boolean;
  latestVersion: string;
  downloadUrl: string | null;
};

const NO_UPDATE: UpdateCheckResult = { updateAvailable: false, latestVersion: "", downloadUrl: null };

/** Strip a leading "v" ("v0.1.14" -> "0.1.14") so it lines up with the bare
 *  X.Y.Z that `Application.nativeApplicationVersion` reports. */
function stripV(version: string): string {
  return version.startsWith("v") || version.startsWith("V") ? version.slice(1) : version;
}

/**
 * Numeric, not lexicographic: "0.1.9" vs "0.1.10" must resolve to 10 > 9, which
 * string/array comparison would get backwards. Missing or non-numeric segments
 * count as 0 so uneven-length versions ("0.1" vs "0.1.0") still compare sanely.
 */
function isNewer(latest: string, installed: string): boolean {
  const a = latest.split(".").map((n) => parseInt(n, 10));
  const b = installed.split(".").map((n) => parseInt(n, 10));
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const av = Number.isFinite(a[i]) ? a[i] : 0;
    const bv = Number.isFinite(b[i]) ? b[i] : 0;
    if (av !== bv) return av > bv;
  }
  return false;
}

/**
 * Checks the latest GitHub Release (via the web dashboard's proxy route) for a
 * newer Android build than the one currently installed.
 *
 * This is a "check once, notify" feature, not a background poller or an
 * auto-updater: it never touches the filesystem and never triggers an
 * install. The caller is expected to hand `downloadUrl` to
 * `Linking.openURL()`, which routes the user through the OS's own
 * install-unknown-apps flow — same as tapping the link in a browser.
 *
 * Fails silently on any error (offline, GitHub down, malformed response) since
 * a missed update notice is a nice-to-have miss, never something worth
 * surfacing as a screen-breaking error.
 */
export async function checkForUpdate(): Promise<UpdateCheckResult> {
  try {
    const installed = Application.nativeApplicationVersion;
    if (!installed) return NO_UPDATE;

    const res = await fetch(`${APP_WEB_URL}/api/releases/latest`);
    if (!res.ok) return NO_UPDATE;

    const data = (await res.json()) as Partial<ReleaseInfo> | null;
    if (!data || typeof data.version !== "string" || !data.android) {
      // No release info, or no APK asset on the latest release yet — nothing
      // to point the user at, so there's nothing to announce either.
      return NO_UPDATE;
    }

    const latestVersion = stripV(data.version);
    if (!isNewer(latestVersion, installed)) return NO_UPDATE;

    return { updateAvailable: true, latestVersion, downloadUrl: data.android };
  } catch {
    // Offline, GitHub down, unexpected response shape — none of it is worth
    // crashing a screen over.
    return NO_UPDATE;
  }
}
