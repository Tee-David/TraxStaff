import { useEffect, useState } from "react";
import { api, CONSENT_VERSION } from "./api";

// First-run (per consent-version) disclosure. Capture is structurally
// unreachable until this is accepted — the Tracker never mounts otherwise.
export default function Consent({ onAccept, onDecline }: { onAccept: () => void; onDecline: () => void }) {
  const [perBlock, setPerBlock] = useState<number | null>(null);
  const [blur, setBlur] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ screenshotsPerBlock: number; blurScreenshots: boolean }>("/orgs/settings")
      .then((o) => { setPerBlock(o.screenshotsPerBlock); setBlur(o.blurScreenshots); })
      .catch(() => {});
  }, []);

  const shotLine =
    perBlock === 0
      ? "Screenshots are turned off for your organization."
      : `${perBlock ?? 1} screenshot${(perBlock ?? 1) > 1 ? "s" : ""} of all your monitors per 10-minute block${blur ? ", blurred" : ""}.`;

  async function accept() {
    setBusy(true); setError(null);
    try {
      await api("/auth/consent", { method: "POST", body: JSON.stringify({ version: CONSENT_VERSION }) });
      onAccept();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save your consent. Check your connection.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="consent-screen">
      <div className="consent-card">
        <img src="/brand/icon-badge.svg" alt="TraxStaff" className="consent-badge" />
        <h1 className="consent-title">Before you start tracking</h1>
        <p className="consent-sub">
          TraxStaff records work activity only while the timer is running. It is never
          hidden — you can always see when it&rsquo;s on. Here&rsquo;s exactly what&rsquo;s collected:
        </p>

        <ul className="consent-list">
          <li>
            <span className="consent-ic" aria-hidden>🖥️</span>
            <div><strong>Screenshots.</strong> {shotLine}</div>
          </li>
          <li>
            <span className="consent-ic" aria-hidden>⌨️</span>
            <div>
              <strong>Activity level.</strong> How often you use the keyboard and
              mouse — timing and intensity only. TraxStaff <em>never</em> records what
              you type or your keystrokes.
            </div>
          </li>
          <li>
            <span className="consent-ic" aria-hidden>🪟</span>
            <div><strong>Apps &amp; websites.</strong> The names of the apps you use and the domains of the websites you visit while tracking (not full URLs).</div>
          </li>
          <li>
            <span className="consent-ic" aria-hidden>💻</span>
            <div><strong>Device.</strong> A device identifier so your time is attributed to this computer.</div>
          </li>
        </ul>

        <p className="consent-fine">
          This data is visible to your organization&rsquo;s admins on the TraxStaff
          dashboard and is used to measure worked time and productivity. Capture
          stops the moment you stop the timer or quit the app.
        </p>

        {error && <div className="error">{error}</div>}

        <div className="consent-actions">
          <button className="consent-decline" onClick={onDecline} disabled={busy}>Decline &amp; sign out</button>
          <button className="consent-accept" onClick={accept} disabled={busy || perBlock === null}>
            {busy ? "Saving…" : "I understand and agree"}
          </button>
        </div>
      </div>
    </div>
  );
}
