"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Badge, Button, Card, PageHeader, Skeleton } from "@/components/ui";
import { useTheme } from "@/lib/theme";
import { toggleThemeWithTransition } from "@/lib/theme-transition";
import { IconMoon, IconSun } from "@/components/icons";

interface OrgSettings {
  id: string;
  name: string;
  screenshotsPerBlock: number;
  blurScreenshots: boolean;
  idleTimeoutMinutes: number;
  keepIdleDefault: boolean;
}

function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => !disabled && onChange(!checked)}
      disabled={disabled}
      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus:outline-none disabled:opacity-40 ${
        checked ? "bg-brand" : "bg-border-strong"
      }`}
    >
      <span
        className={`inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${checked ? "translate-x-5" : "translate-x-0.5"}`}
      />
    </button>
  );
}

function SettingRow({
  title,
  description,
  children,
  noBorder,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  noBorder?: boolean;
}) {
  return (
    <div className={`flex flex-col sm:flex-row sm:items-center justify-between gap-4 py-5 ${noBorder ? "" : "border-b border-border"}`}>
      <div className="min-w-0 flex-1">
        <div className="text-[14px] font-semibold text-ink">{title}</div>
        {description && <div className="mt-0.5 text-[12px] text-muted leading-relaxed max-w-md">{description}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function SectionHeader({ icon, title, description }: { icon: string; title: string; description?: string }) {
  return (
    <div className="mb-1 flex items-start gap-3 pb-4 border-b border-border">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand/10 text-lg">{icon}</span>
      <div>
        <h2 className="font-heading text-[15px] font-semibold text-ink">{title}</h2>
        {description && <p className="text-[12px] text-muted">{description}</p>}
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "owner" || user?.role === "admin";
  const [settings, setSettings] = useState<OrgSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [theme, setTheme] = useTheme();

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
          keepIdleDefault: settings.keepIdleDefault,
        }),
      });
      setSettings(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <Skeleton className="h-96 max-w-2xl" />;
  if (!settings) return <p className="text-sm text-muted">Could not load settings.</p>;

  return (
    <div>
      <PageHeader title="Settings" subtitle={`Workspace configuration for ${settings.name}`} />

      <div className="max-w-2xl space-y-6">

        {/* ── Appearance ── */}
        <Card className="p-6">
          <SectionHeader icon="🎨" title="Appearance" description="Personalise how Trax looks on your device" />
          <SettingRow title="Theme" description="Switch between light and dark mode." noBorder>
            <div className="inline-flex rounded-full border border-border bg-canvas p-1">
              <button
                onClick={(e) => toggleThemeWithTransition(e, "light", setTheme)}
                className={`flex items-center gap-2 rounded-full px-3.5 py-1.5 text-[12px] font-semibold transition ${
                  theme === "light" ? "bg-surface shadow-[var(--shadow-soft)] text-ink" : "text-muted hover:text-ink"
                }`}
              >
                <IconSun className="h-3.5 w-3.5" /> Light
              </button>
              <button
                onClick={(e) => toggleThemeWithTransition(e, "dark", setTheme)}
                className={`flex items-center gap-2 rounded-full px-3.5 py-1.5 text-[12px] font-semibold transition ${
                  theme === "dark" ? "bg-elevated shadow-[var(--shadow-soft)] text-ink" : "text-muted hover:text-ink"
                }`}
              >
                <IconMoon className="h-3.5 w-3.5" /> Dark
              </button>
            </div>
          </SettingRow>
        </Card>

        {/* ── Screenshot capture policy (admin only) ── */}
        {isAdmin && (
          <Card className="p-6">
            <SectionHeader
              icon="📸"
              title="Screenshot Capture"
              description="Controls how often screenshots are taken across the organisation. These settings apply to all members."
            />

            <SettingRow
              title="Screenshots per 10-minute block"
              description="Random moments within each tracking block. Set to 0 to disable capture entirely."
            >
              <select
                value={settings.screenshotsPerBlock}
                onChange={(e) => setSettings({ ...settings, screenshotsPerBlock: Number(e.target.value) })}
                className="rounded-lg border border-border bg-surface px-3 py-2 text-[13px] text-ink outline-none focus:border-brand transition min-w-[180px]"
              >
                <option value={0}>Off — no screenshots</option>
                <option value={1}>1 per block (default)</option>
                <option value={2}>2 per block</option>
                <option value={3}>3 per block</option>
              </select>
            </SettingRow>

            <SettingRow
              title="Blur screenshots"
              description="Apply a privacy blur to all captured screenshots. Admins can still toggle blur off per screenshot."
            >
              <Toggle
                checked={settings.blurScreenshots}
                onChange={(v) => setSettings({ ...settings, blurScreenshots: v })}
              />
            </SettingRow>
          </Card>
        )}

        {/* ── Tracking behaviour (admin only) ── */}
        {isAdmin && (
          <Card className="p-6">
            <SectionHeader
              icon="⏱"
              title="Tracking Behaviour"
              description="Configure how the desktop app handles idle time and tracking sessions."
            />

            <SettingRow
              title="Idle timeout"
              description="After this many consecutive idle minutes, the tracker prompts the member to keep or discard the idle time."
            >
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={1}
                  max={60}
                  value={settings.idleTimeoutMinutes}
                  onChange={(e) => setSettings({ ...settings, idleTimeoutMinutes: Number(e.target.value) })}
                  className="w-20 rounded-lg border border-border bg-surface px-3 py-2 text-[13px] text-ink outline-none focus:border-brand transition text-center"
                />
                <span className="text-[13px] text-muted">minutes</span>
              </div>
            </SettingRow>

            <SettingRow
              title="Keep idle time by default"
              description="When the idle prompt is dismissed or times out, keep the idle time instead of discarding it. Members can still choose per prompt."
              noBorder
            >
              <Toggle
                checked={settings.keepIdleDefault}
                onChange={(v) => setSettings({ ...settings, keepIdleDefault: v })}
              />
            </SettingRow>
          </Card>
        )}

        {/* ── Account info ── */}
        <Card className="p-6">
          <SectionHeader icon="🏢" title="Organisation" description="Your organisation details." />
          <SettingRow title="Organisation name" description="The display name used across the dashboard." noBorder>
            <div className="rounded-lg border border-border bg-canvas px-3 py-2 text-[13px] font-medium text-ink min-w-[180px]">
              {settings.name}
            </div>
          </SettingRow>
        </Card>

        {/* ── Save ── */}
        {isAdmin && (
          <div className="flex items-center gap-4 pb-8">
            <Button onClick={save} disabled={saving} className="min-w-[120px]">
              {saving ? "Saving…" : "Save changes"}
            </Button>
            {saved && (
              <span className="flex items-center gap-1.5 text-[13px] font-medium text-[var(--color-positive)]">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M2.5 7.5L5.5 10.5L11.5 3.5" />
                </svg>
                Saved successfully
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
