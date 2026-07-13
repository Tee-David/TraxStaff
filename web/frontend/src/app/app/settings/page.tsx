"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Button, Card, Label } from "@/components/ui";

interface OrgSettings {
  id: string;
  name: string;
  screenshotsPerBlock: number;
  blurScreenshots: boolean;
  idleTimeoutMinutes: number;
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<OrgSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api<OrgSettings>("/orgs/settings")
      .then(setSettings)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function save() {
    if (!settings) return;
    setSaving(true);
    setSaved(false);
    try {
      const updated = await api<OrgSettings>("/orgs/settings", {
        method: "PATCH",
        body: JSON.stringify({
          screenshotsPerBlock: settings.screenshotsPerBlock,
          blurScreenshots: settings.blurScreenshots,
          idleTimeoutMinutes: settings.idleTimeoutMinutes,
        }),
      });
      setSettings(updated);
      setSaved(true);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p className="text-sm text-muted">Loading…</p>;
  if (!settings) return <p className="text-sm text-muted">Could not load settings.</p>;

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl">Settings</h1>
        <p className="text-sm text-muted">Tracking &amp; capture policy for {settings.name}</p>
      </div>

      <Card className="max-w-lg space-y-5 p-6">
        <div>
          <Label>Screenshots per 10-minute block</Label>
          <select
            value={settings.screenshotsPerBlock}
            onChange={(e) => setSettings({ ...settings, screenshotsPerBlock: Number(e.target.value) })}
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-brand"
          >
            <option value={0}>Off — no screenshots</option>
            <option value={1}>1 × per 10 min (default)</option>
            <option value={2}>2 × per 10 min</option>
            <option value={3}>3 × per 10 min</option>
          </select>
          <p className="mt-1 text-xs text-muted">Captured at a random moment within each block, all monitors.</p>
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={settings.blurScreenshots}
            onChange={(e) => setSettings({ ...settings, blurScreenshots: e.target.checked })}
            className="accent-brand"
          />
          Blur screenshots (privacy)
        </label>

        <div>
          <Label>Idle timeout (minutes)</Label>
          <input
            type="number"
            min={1}
            max={60}
            value={settings.idleTimeoutMinutes}
            onChange={(e) => setSettings({ ...settings, idleTimeoutMinutes: Number(e.target.value) })}
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-brand"
          />
          <p className="mt-1 text-xs text-muted">After this much inactivity, the tracker prompts to keep or discard idle time.</p>
        </div>

        <div className="flex items-center gap-3">
          <Button onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save settings"}
          </Button>
          {saved && <span className="text-sm text-green-600">Saved ✓</span>}
        </div>
      </Card>
    </div>
  );
}
