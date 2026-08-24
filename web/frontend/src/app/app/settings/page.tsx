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
import { IconBell, IconChart, IconClock, IconFlag, IconImage, IconMail, IconMoon, IconSun, IconUser, IconUsers } from "@/components/icons";

interface OrgSettings {
  id: string;
  name: string;
  screenshotsPerBlock: number;
  blurScreenshots: boolean;
  idleTimeoutMinutes: number;
  keepIdleDefault: boolean;
  showWebsiteUsage: boolean;
  dailyTargetMinutes: number;
  weeklyTargetMinutes: number;
  timezone: string;
  emailsEnabled: boolean;
  notifyDailyShortfall: boolean;
  notifyWeeklyShortfall: boolean;
  notifyUnusualActivity: boolean;
  notifyMemberWeeklySummary: boolean;
}

/**
 * Two layers, deliberately.
 *
 * `EMAIL_KINDS` below is the ORG's switchboard: whether this workspace sends a
 * given email at all. The per-person toggles in the Notifications section are
 * the second layer — of the emails the org does send, which ones reach *your*
 * inbox. An email needs both to be on, so an admin can silence a digest for
 * everyone, and each person can still opt themselves out of one that stays on.
 */
type SectionId =
  | "account"
  | "notifications"
  | "appearance"
  | "screenshots"
  | "tracking"
  | "reports"
  | "targets"
  | "emails"
  | "organisation";

/** One email a person can opt out of for themselves, as described by the server. */
interface EmailType {
  type: string;
  label: string;
  description: string;
  adminOnly: boolean;
  default: boolean;
  /** False when the org has switched this email off for everyone. */
  orgEnabled: boolean;
}

interface EmailPrefsResponse {
  preferences: Record<string, boolean>;
  types: EmailType[];
}

/**
 * Every email the org can switch off, in the order they appear. Kept as data so
 * the panel and the master switch stay in step — adding a kind here is the only
 * change a new digest needs on this page.
 */
const EMAIL_KINDS: {
  key: "notifyDailyShortfall" | "notifyWeeklyShortfall" | "notifyUnusualActivity" | "notifyMemberWeeklySummary";
  label: string;
  hint: string;
}[] = [
  {
    key: "notifyDailyShortfall",
    label: "Daily shortfall digest",
    hint: "To admins each morning, listing anyone who finished the previous day below the daily target. One digest per day, never one per member.",
  },
  {
    key: "notifyWeeklyShortfall",
    label: "Weekly shortfall digest",
    hint: "To admins on Monday morning, covering the week just ended. Independent of the daily digest.",
  },
  {
    key: "notifyUnusualActivity",
    label: "Unusual activity digest",
    hint: "To admins the morning after a session is flagged — jiggler detection, clock changes, and the rest. Sent only on days something was actually flagged.",
  },
  {
    key: "notifyMemberWeeklySummary",
    label: "Member weekly summary",
    hint: "The only email here that goes to every member rather than to admins: their own hours against their own target, the same figure you see for them.",
  },
];

/** IANA zones for the org picker. Falls back to a short list on older browsers. */
function timezoneOptions(): { value: string; label: string }[] {
  const supported = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] })
    .supportedValuesOf;
  const zones = supported
    ? supported("timeZone")
    : ["UTC", "Africa/Lagos", "Europe/London", "America/New_York", "America/Los_Angeles", "Asia/Dubai"];
  return zones.map((z) => ({ value: z, label: z.replace(/_/g, " ") }));
}


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
    id: "notifications",
    label: "Notifications",
    icon: IconBell,
    title: "Email notifications",
    subtitle:
      "Which emails land in your inbox. Yours alone — muting one here never hides it from anyone else, and every event still shows in your notifications.",
    adminOnly: false,
  },
  {
    id: "appearance",
    label: "Appearance",
    icon: IconSun,
    title: "Appearance",
    subtitle: "Personalise how TraxStaff looks on this device. Saved locally, not shared with your team.",
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
    id: "reports",
    label: "Reports",
    icon: IconChart,
    title: "Reports",
    subtitle: "Which breakdowns appear on the Reports page. Applies to everyone who can view reports.",
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
    id: "emails",
    label: "Emails",
    icon: IconMail,
    title: "Emails",
    subtitle: "Which emails TraxStaff sends on your organisation's behalf, and to whom.",
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
  // Notifications section: per-user email opt-outs.
  const [emailPrefs, setEmailPrefs] = useState<EmailPrefsResponse | null>(null);
  const [savingPref, setSavingPref] = useState<string | null>(null);
  const [prefError, setPrefError] = useState<string | null>(null);

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

  // Loaded from the server rather than hard-coded here: the labels, the copy and
  // which types a role can even receive all live beside the code that sends the
  // mail, so a new email can't ship without a way to turn it off.
  useEffect(() => {
    api<EmailPrefsResponse>("/auth/me/email-preferences")
      .then(setEmailPrefs)
      .catch(() => setPrefError("Couldn't load your email preferences."));
  }, []);

  /**
   * Saved per toggle, optimistically. A preference is a small, independent fact
   * and a Save button for a screen of switches invites walking away without
   * pressing it. On failure the switch goes back and says so, rather than
   * showing a state the server never accepted.
   */
  async function setEmailPref(type: string, value: boolean) {
    if (!emailPrefs) return;
    const previous = emailPrefs.preferences;
    setEmailPrefs({ ...emailPrefs, preferences: { ...previous, [type]: value } });
    setSavingPref(type);
    setPrefError(null);
    try {
      const res = await api<{ preferences: Record<string, boolean> }>(
        "/auth/me/email-preferences",
        { method: "PATCH", body: JSON.stringify({ [type]: value }) }
      );
      setEmailPrefs((s) => (s ? { ...s, preferences: res.preferences } : s));
    } catch {
      setEmailPrefs((s) => (s ? { ...s, preferences: previous } : s));
      setPrefError("Couldn't save that preference. Check your connection and try again.");
    } finally {
      setSavingPref(null);
    }
  }

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
          showWebsiteUsage: settings.showWebsiteUsage,
          dailyTargetMinutes: settings.dailyTargetMinutes,
          weeklyTargetMinutes: settings.weeklyTargetMinutes,
          timezone: settings.timezone,
          emailsEnabled: settings.emailsEnabled,
          notifyDailyShortfall: settings.notifyDailyShortfall,
          notifyWeeklyShortfall: settings.notifyWeeklyShortfall,
          notifyUnusualActivity: settings.notifyUnusualActivity,
          notifyMemberWeeklySummary: settings.notifyMemberWeeklySummary,
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

    notifications: (
      <>
        <SettingsPanel
          title="Email"
          description="Every one of these also appears in your in-app notifications, whether or not it's emailed."
        >
          {!emailPrefs ? (
            <div className="space-y-3 p-4">
              {[0, 1].map((i) => <Skeleton key={i} className="h-12" />)}
            </div>
          ) : emailPrefs.types.length === 0 ? (
            <p className="px-4 py-6 text-center text-[13px] text-muted">
              There are no email notifications for your account yet.
            </p>
          ) : (
            emailPrefs.types.map((t) => (
              <SettingsRow key={t.type} label={t.label} hint={t.description}>
                <Toggle
                  checked={emailPrefs.preferences[t.type] ?? t.default}
                  onChange={(v) => setEmailPref(t.type, v)}
                  disabled={savingPref === t.type}
                  label={t.label}
                />
              </SettingsRow>
            ))
          )}
        </SettingsPanel>
        {prefError && (
          <p className="mt-3 rounded-lg bg-[var(--color-negative)]/10 px-3 py-2.5 text-[13px] text-[var(--color-negative)]">
            {prefError}
          </p>
        )}
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
            hint="Blurs captures in the dashboard, and hides them from the member they belong to. Turn it off and members can see their own screenshots immediately. Note this affects display only — the stored image is never altered, and admins always see it in full."
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

    reports: (
      <SettingsPanel title="Visible breakdowns">
        <SettingsRow
          label="Website usage"
          hint="Show the per-domain breakdown of browsing time on the Reports page. Turning this off hides the panel for everyone, including admins. Tracking is unaffected — the history is kept and reappears if you turn this back on."
        >
          <Toggle
            label="Show website usage"
            checked={settings.showWebsiteUsage}
            onChange={(v) => setSettings({ ...settings, showWebsiteUsage: v })}
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

    emails: (
      <>
        <SettingsPanel title="Sending">
          <SettingsRow
            label="Send emails"
            hint="Master switch. Turning this off stops every notification email below without losing the individual settings — the dashboard notification bell keeps working either way."
          >
            <Toggle
              label="Send notification emails"
              checked={settings.emailsEnabled}
              onChange={(v) => setSettings({ ...settings, emailsEnabled: v })}
            />
          </SettingsRow>
        </SettingsPanel>

        <SettingsPanel title="What gets sent">
          {EMAIL_KINDS.map((kind) => (
            <SettingsRow key={kind.key} label={kind.label} hint={kind.hint}>
              <Toggle
                label={kind.label}
                checked={settings[kind.key]}
                disabled={!settings.emailsEnabled}
                onChange={(v) => setSettings({ ...settings, [kind.key]: v })}
              />
            </SettingsRow>
          ))}
        </SettingsPanel>

        <SettingsPanel title="Always sent">
          <SettingsRow
            label="Invites and password resets"
            hint="These are how people get into the account and back into it, so they cannot be switched off — disabling them would lock a member out with no way back in."
          >
            <span className="text-[13px] text-muted">Always on</span>
          </SettingsRow>
        </SettingsPanel>
      </>
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
        {isAdmin && (
          <SettingsRow
            label="Timezone"
            hint="The working day is measured in this zone. Digests are sent, and days and weeks are bucketed, against your organisation's local clock rather than the server's."
          >
            <Select
              value={settings.timezone}
              onChange={(v) => setSettings({ ...settings, timezone: v })}
              options={timezoneOptions()}
              searchable
              minWidth={260}
            />
          </SettingsRow>
        )}
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

          {/* The org-settings Save button belongs to the admin-owned sections
              only. Account and Notifications are per-user and save as you go —
              a Save button under them would claim to be storing preferences
              that are already stored, and do something else entirely. */}
          {isAdmin && current.id !== "account" && current.id !== "notifications" && (
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
