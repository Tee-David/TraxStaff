"use client";

import { useEffect, useState, type ReactNode } from "react";
import { motion } from "motion/react";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Button, Card, Input, PageHeader, Skeleton } from "@/components/ui";
import { Select } from "@/components/Select";
import { SettingsNav, type SettingsNavItem } from "@/components/SettingsNav";
import { SettingsPanel } from "@/components/SettingsPanel";
import { SettingsRow } from "@/components/SettingsRow";
import { Toggle } from "@/components/Toggle";
import { useTheme } from "@/lib/theme";
import { useMotionPresets } from "@/lib/motion";
import { toggleThemeWithTransition } from "@/lib/theme-transition";
import { IconClock, IconFlag, IconImage, IconMoon, IconSun, IconUser, IconUsers } from "@/components/icons";

interface OrgSettings {
  id: string;
  name: string;
  screenshotsPerBlock: number;
  blurScreenshots: boolean;
  idleTimeoutMinutes: number;
  keepIdleDefault: boolean;
  dailyTargetMinutes: number;
  weeklyTargetMinutes: number;
}

type SectionId = "account" | "appearance" | "screenshots" | "tracking" | "targets" | "organisation";

type Section = SettingsNavItem & {
  id: SectionId;
  title: string;
  subtitle: string;
  adminOnly: boolean;
};

const SECTIONS: Section[] = [
  {
    id: "account",
    label: "Account",
    icon: IconUser,
    title: "Account",
    subtitle: "Your name and password. Visible only to you.",
    adminOnly: false,
  },
  {
    id: "appearance",
    label: "Appearance",
    icon: IconSun,
    title: "Appearance",
    subtitle: "Personalise how Trax looks on this device. Saved locally, not shared with your team.",
    adminOnly: false,
  },
  {
    id: "screenshots",
    label: "Screenshots",
    icon: IconImage,
    title: "Screenshot capture",
    subtitle: "How often screenshots are taken, and how they are stored. Applies to every member.",
    adminOnly: true,
  },
  {
    id: "tracking",
    label: "Tracking",
    icon: IconClock,
    title: "Tracking behaviour",
    subtitle: "How the desktop tracker handles idle time during a session.",
    adminOnly: true,
  },
  {
    id: "targets",
    label: "Work targets",
    icon: IconFlag,
    title: "Work targets",
    subtitle: "Organisation-wide defaults. Members inherit these unless given their own target.",
    adminOnly: true,
  },
  {
    id: "organisation",
    label: "Organisation",
    icon: IconUsers,
    title: "Organisation",
    subtitle: "Your workspace details.",
    adminOnly: false,
  },
];

/** Small number input with a unit suffix — used by the tracking + target rows. */
function UnitField({
  value,
  onChange,
  unit,
  min,
  max,
  step,
  ariaLabel,
}: {
  value: number;
  onChange: (v: number) => void;
  unit: string;
  min: number;
  max: number;
  step?: number;
  ariaLabel: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="number"
        aria-label={ariaLabel}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-20 rounded-lg border border-border bg-surface px-3 py-2 text-center text-[13px] text-ink outline-none transition focus:border-brand"
      />
      <span className="text-[13px] text-muted">{unit}</span>
    </div>
  );
}

export default function SettingsPage() {
  const { user, refresh } = useAuth();
  const isAdmin = user?.role === "owner" || user?.role === "admin";
  const [settings, setSettings] = useState<OrgSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [active, setActive] = useState<SectionId>("account");
  const [theme, setTheme] = useTheme();
  const m = useMotionPresets();

  // Account section: display name.
  const [accountName, setAccountName] = useState(user?.name ?? "");
  const [savingName, setSavingName] = useState(false);
  const [savedName, setSavedName] = useState(false);

  // Account section: change password.
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [changingPassword, setChangingPassword] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSaved, setPasswordSaved] = useState(false);

  useEffect(() => {
    api<OrgSettings>("/orgs/settings")
      .then(setSettings)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // Keep the name field in sync once the user finishes loading (it starts
  // out null while /auth/me is still in flight).
  useEffect(() => {
    setAccountName(user?.name ?? "");
  }, [user?.name]);

  async function saveName() {
    setSavingName(true);
    setSavedName(false);
    try {
      await api("/auth/me", {
        method: "PATCH",
        body: JSON.stringify({ name: accountName.trim() }),
      });
      await refresh();
      setSavedName(true);
      setTimeout(() => setSavedName(false), 3000);
    } finally {
      setSavingName(false);
    }
  }

  async function changePassword() {
    setPasswordError(null);
    if (newPassword.length < 8) {
      setPasswordError("New password must be at least 8 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError("New passwords do not match.");
      return;
    }
    setChangingPassword(true);
    try {
      await api("/auth/change-password", {
        method: "POST",
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setPasswordSaved(true);
      setTimeout(() => setPasswordSaved(false), 3000);
    } catch (err) {
      setPasswordError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
    } finally {
      setChangingPassword(false);
    }
  }

  async function save() {
    if (!settings) return;
    setSaving(true);
    setSaved(false);
    try {
      const updated = await api<OrgSettings>("/orgs/settings", {
        method: "PATCH",
        body: JSON.stringify({
          name: settings.name.trim(),
          screenshotsPerBlock: settings.screenshotsPerBlock,
          blurScreenshots: settings.blurScreenshots,
          idleTimeoutMinutes: settings.idleTimeoutMinutes,
          keepIdleDefault: settings.keepIdleDefault,
          dailyTargetMinutes: settings.dailyTargetMinutes,
          weeklyTargetMinutes: settings.weeklyTargetMinutes,
        }),
      });
      setSettings(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div>
        <PageHeader title="Settings" subtitle="Workspace configuration" />
        <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
          <Skeleton className="h-11 w-full rounded-xl lg:h-64 lg:w-56 lg:shrink-0" />
          <Skeleton className="h-96 min-w-0 flex-1 rounded-[var(--radius-card)]" />
        </div>
      </div>
    );
  }
  if (!settings) return <p className="text-sm text-muted">Could not load settings.</p>;

  const sections = SECTIONS.filter((s) => isAdmin || !s.adminOnly);
  const current = sections.find((s) => s.id === active) ?? sections[0];

  const body: Record<SectionId, ReactNode> = {
    account: (
      <>
        <SettingsPanel title="Profile">
          <SettingsRow label="Display name" hint="Shown across the dashboard wherever your name appears.">
            <div className="flex flex-wrap items-center gap-3">
              <Input
                value={accountName}
                onChange={(e) => setAccountName(e.target.value)}
                maxLength={120}
                placeholder={user?.email ?? ""}
                className="sm:min-w-[220px]"
              />
              <Button
                onClick={saveName}
                disabled={savingName || accountName.trim().length === 0}
                variant="ghost"
                className="min-w-[92px]"
              >
                {savingName ? "Saving…" : "Save"}
              </Button>
              {savedName && (
                <span className="text-[13px] font-medium text-[var(--color-positive)]">Saved</span>
              )}
            </div>
          </SettingsRow>
        </SettingsPanel>

        <SettingsPanel title="Password">
          <SettingsRow label="Current password" hint="Confirm it's you before setting a new password.">
            <Input
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className="sm:min-w-[220px]"
            />
          </SettingsRow>
          <SettingsRow label="New password" hint="At least 8 characters.">
            <Input
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="sm:min-w-[220px]"
            />
          </SettingsRow>
          <SettingsRow label="Confirm new password" hint="Re-enter the new password to confirm.">
            <Input
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="sm:min-w-[220px]"
            />
          </SettingsRow>
          <div className="flex flex-wrap items-center gap-3 pt-1">
            <Button
              onClick={changePassword}
              disabled={changingPassword || !currentPassword || !newPassword || !confirmPassword}
              variant="ghost"
              className="min-w-[140px]"
            >
              {changingPassword ? "Updating…" : "Change password"}
            </Button>
            {passwordSaved && (
              <span className="text-[13px] font-medium text-[var(--color-positive)]">Password updated</span>
            )}
            {passwordError && (
              <span className="text-[13px] font-medium text-[var(--color-negative)]">{passwordError}</span>
            )}
          </div>
        </SettingsPanel>
      </>
    ),

    appearance: (
      <SettingsPanel title="Theme">
        <SettingsRow label="Colour mode" hint="Switch between light and dark. Applies to this browser only.">
          <div className="inline-flex rounded-full border border-border bg-canvas p-1">
            <button
              type="button"
              onClick={(e) => toggleThemeWithTransition(e, "light", setTheme)}
              className={`flex items-center gap-2 rounded-full px-3.5 py-1.5 text-[12px] font-semibold transition ${
                theme === "light" ? "bg-surface text-ink shadow-[var(--shadow-soft)]" : "text-muted hover:text-ink"
              }`}
            >
              <IconSun className="h-3.5 w-3.5" /> Light
            </button>
            <button
              type="button"
              onClick={(e) => toggleThemeWithTransition(e, "dark", setTheme)}
              className={`flex items-center gap-2 rounded-full px-3.5 py-1.5 text-[12px] font-semibold transition ${
                theme === "dark" ? "bg-elevated text-ink shadow-[var(--shadow-soft)]" : "text-muted hover:text-ink"
              }`}
            >
              <IconMoon className="h-3.5 w-3.5" /> Dark
            </button>
          </div>
        </SettingsRow>
      </SettingsPanel>
    ),

    screenshots: (
      <>
        <SettingsPanel title="Capture frequency">
          <SettingsRow
            label="Screenshots per 10-minute block"
            hint="Taken at random moments within each tracking block. Set to off to disable capture entirely."
          >
            <Select
              value={String(settings.screenshotsPerBlock)}
              onChange={(v) => setSettings({ ...settings, screenshotsPerBlock: Number(v) })}
              align="right"
              minWidth={220}
              options={[
                { value: "0", label: "Off — no screenshots" },
                { value: "1", label: "1 per block (default)" },
                { value: "2", label: "2 per block" },
                { value: "3", label: "3 per block" },
              ]}
            />
          </SettingsRow>
        </SettingsPanel>

        <SettingsPanel title="Privacy">
          <SettingsRow
            label="Blur screenshots"
            hint="Apply a privacy blur to every capture. Admins can still toggle blur off per screenshot."
          >
            <Toggle
              label="Blur screenshots"
              checked={settings.blurScreenshots}
              onChange={(v) => setSettings({ ...settings, blurScreenshots: v })}
            />
          </SettingsRow>
        </SettingsPanel>
      </>
    ),

    tracking: (
      <SettingsPanel title="Idle handling">
        <SettingsRow
          label="Idle timeout"
          hint="After this many consecutive idle minutes, the tracker prompts the member to keep or discard the idle time."
        >
          <UnitField
            ariaLabel="Idle timeout in minutes"
            value={settings.idleTimeoutMinutes}
            onChange={(v) => setSettings({ ...settings, idleTimeoutMinutes: v })}
            unit="minutes"
            min={1}
            max={60}
          />
        </SettingsRow>
        <SettingsRow
          label="Keep idle time by default"
          hint="When the idle prompt is dismissed or times out, keep the idle time instead of discarding it. Members can still choose per prompt."
        >
          <Toggle
            label="Keep idle time by default"
            checked={settings.keepIdleDefault}
            onChange={(v) => setSettings({ ...settings, keepIdleDefault: v })}
          />
        </SettingsRow>
      </SettingsPanel>
    ),

    targets: (
      <SettingsPanel title="Expected hours">
        <SettingsRow
          label="Daily target"
          hint="Hours a member is expected to track on a working day. Dashboard progress bars are measured against this."
        >
          <UnitField
            ariaLabel="Daily target in hours"
            value={settings.dailyTargetMinutes / 60}
            onChange={(v) => setSettings({ ...settings, dailyTargetMinutes: Math.round(v * 60) })}
            unit="hours"
            min={0}
            max={24}
            step={0.5}
          />
        </SettingsRow>
        <SettingsRow
          label="Weekly target"
          hint="Hours a member is expected to track across a full week. Set independently of the daily target."
        >
          <UnitField
            ariaLabel="Weekly target in hours"
            value={settings.weeklyTargetMinutes / 60}
            onChange={(v) => setSettings({ ...settings, weeklyTargetMinutes: Math.round(v * 60) })}
            unit="hours"
            min={0}
            max={168}
            step={0.5}
          />
        </SettingsRow>
      </SettingsPanel>
    ),

    organisation: (
      <SettingsPanel title="Details">
        <SettingsRow label="Organisation name" hint="The display name used across the dashboard.">
          <Input
            value={settings.name}
            onChange={(e) => setSettings({ ...settings, name: e.target.value })}
            maxLength={120}
            disabled={!isAdmin}
            className="sm:min-w-[220px] disabled:cursor-default disabled:opacity-70"
          />
        </SettingsRow>
      </SettingsPanel>
    ),
  };

  return (
    <div>
      <PageHeader title="Settings" subtitle={`Workspace configuration for ${settings.name}`} />

      <div className="flex flex-col gap-6 pb-8 lg:flex-row lg:items-start">
        <SettingsNav items={sections} active={current.id} onSelect={(id) => setActive(id as SectionId)} data-tour="settings-nav" />

        <div className="min-w-0 flex-1 lg:max-w-3xl">
          <motion.div key={current.id} initial={m.page.initial} animate={m.page.animate} transition={m.page.transition}>
            <Card className="p-5 sm:p-6" data-tour="settings-panel">
              <div className="mb-5">
                <h2 className="font-heading text-[18px] font-semibold text-ink">{current.title}</h2>
                <p className="mt-1 text-[13px] leading-relaxed text-muted">{current.subtitle}</p>
              </div>
              <div className="space-y-5">{body[current.id]}</div>
            </Card>
          </motion.div>

          {isAdmin && current.id !== "account" && (
            <div className="mt-6 flex flex-wrap items-center gap-4">
              <Button onClick={save} disabled={saving} className="min-w-[120px]">
                {saving ? "Saving…" : "Save changes"}
              </Button>
              {saved && (
                <span className="flex items-center gap-1.5 text-[13px] font-medium text-[var(--color-positive)]">
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 14 14"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M2.5 7.5L5.5 10.5L11.5 3.5" />
                  </svg>
                  Saved successfully
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
