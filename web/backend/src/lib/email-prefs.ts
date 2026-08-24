/**
 * Which emails a person gets, and the defaults they get them by.
 *
 * The problem this solves: notifications are org-wide for privileged callers,
 * so every admin sees every org event in the bell — correct for in-app, but as
 * email it means one member's manual entry lands in five inboxes whether or not
 * those five people are the ones who review time. Preferences are per USER and
 * governed here; the in-app stream is deliberately untouched, so an admin who
 * mutes an email still sees the event, and muting can never hide something from
 * the rest of the org.
 *
 * Stored as `User.emailPrefs`, a sparse `{ [type]: boolean }` blob: an absent
 * key means "whatever the default below says", so changing a default changes it
 * for everyone who never expressed an opinion, and nobody's stored row has to be
 * migrated when a new type is added.
 */

export const EMAIL_TYPES = [
  "manual_time_submitted",
  "manual_time_decided",
  "daily_shortfall",
  "weekly_shortfall",
  "unusual_activity_digest",
  "member_weekly_summary",
] as const;

export type EmailType = (typeof EMAIL_TYPES)[number];

/**
 * The org-level switch that has to be on before a type is sent to anyone.
 *
 * Two layers, and they answer different questions: the org column decides
 * whether this workspace sends the email at all, the per-user preference
 * decides whether it reaches one particular inbox. Both must be on. The manual
 * -time emails have no org column — they are part of the approval flow itself,
 * and switching them off org-wide would leave entries sitting in a queue nobody
 * is told about — so they are governed by the per-user preference alone.
 */
export type OrgEmailFlag =
  | "notifyDailyShortfall"
  | "notifyWeeklyShortfall"
  | "notifyUnusualActivity"
  | "notifyMemberWeeklySummary";

export interface EmailTypeMeta {
  type: EmailType;
  label: string;
  description: string;
  /** Only offered to owner/admin — a member is never the audience for it. */
  adminOnly: boolean;
  default: boolean;
  orgFlag?: OrgEmailFlag;
}

/**
 * Defaults are all "on" on purpose: an org switch is the opt-in, and these are
 * the personal opt-outs beneath it. Anything defaulting to off here would make
 * the org's own switch look broken to whoever flipped it.
 */
export const EMAIL_TYPE_META: EmailTypeMeta[] = [
  {
    type: "manual_time_submitted",
    label: "Manual time awaiting approval",
    description: "When someone submits manual time that needs a decision from an admin.",
    adminOnly: true,
    // On by default: an entry nobody is told about sits pending forever, which
    // is the one failure mode that makes the whole approval flow useless.
    default: true,
  },
  {
    type: "manual_time_decided",
    label: "Your manual time was reviewed",
    description: "When an admin approves or rejects time you added yourself.",
    adminOnly: false,
    default: true,
  },
  {
    type: "daily_shortfall",
    label: "Daily shortfall digest",
    description:
      "Each morning, listing anyone who finished the previous day below the daily target.",
    adminOnly: true,
    default: true,
    orgFlag: "notifyDailyShortfall",
  },
  {
    type: "weekly_shortfall",
    label: "Weekly shortfall digest",
    description: "Monday morning, covering the week just ended.",
    adminOnly: true,
    default: true,
    orgFlag: "notifyWeeklyShortfall",
  },
  {
    type: "unusual_activity_digest",
    label: "Unusual activity digest",
    description:
      "The morning after a session is flagged — jiggler detection, clock changes and the rest. Only on days something was actually flagged.",
    adminOnly: true,
    default: true,
    orgFlag: "notifyUnusualActivity",
  },
  {
    type: "member_weekly_summary",
    label: "Your weekly summary",
    description: "Your own hours against your own target, once a week.",
    adminOnly: false,
    // True, even though the org column defaults to false. The two layers do
    // different jobs: the org column is the opt-IN (does this workspace send
    // weekly summaries at all), and this is the personal opt-OUT. Defaulting
    // this to false as well would mean an admin switching it on org-wide sent
    // it to nobody — a switch that appears to do nothing.
    default: true,
    orgFlag: "notifyMemberWeeklySummary",
  },
];

const DEFAULTS = new Map(EMAIL_TYPE_META.map((m) => [m.type, m.default]));

export function isEmailType(value: string): value is EmailType {
  return (EMAIL_TYPES as readonly string[]).includes(value);
}

/**
 * Whether this user wants `type` in their mailbox.
 *
 * Anything unreadable in the stored blob — a hand-edited row, a shape from a
 * future version, a database where the column could not be added — falls back
 * to the default rather than throwing or silently muting: failing closed here
 * would drop the notification, and the caller is a route handler that must not
 * turn a preference problem into a failed request.
 */
export function wantsEmail(
  // `emailPrefs` is optional, not just `unknown`: a caller reading a row from a
  // database where the column could not be added has no field at all, and that
  // must fall through to the defaults rather than fail to compile or mute.
  user: { role: string; emailPrefs?: unknown },
  type: EmailType
): boolean {
  const meta = EMAIL_TYPE_META.find((m) => m.type === type);
  if (meta?.adminOnly && user.role !== "owner" && user.role !== "admin") return false;

  const prefs = user.emailPrefs;
  if (prefs && typeof prefs === "object" && !Array.isArray(prefs)) {
    const value = (prefs as Record<string, unknown>)[type];
    if (typeof value === "boolean") return value;
  }
  return DEFAULTS.get(type) ?? false;
}

/** The full effective set for one user — what the settings UI renders. */
export function effectivePrefs(user: { role: string; emailPrefs?: unknown }): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const meta of EMAIL_TYPE_META) {
    if (meta.adminOnly && user.role !== "owner" && user.role !== "admin") continue;
    out[meta.type] = wantsEmail(user, meta.type);
  }
  return out;
}

/**
 * The types this user can be offered, each marked with whether the org sends it
 * at all.
 *
 * A type the org has switched off is still listed rather than hidden: the
 * person's own choice is remembered for when it comes back on, and "this is off
 * for the whole workspace" is a more useful thing to read than a missing row.
 */
export function visibleTypes(
  user: { role: string },
  org: Partial<Record<OrgEmailFlag, boolean>> & { emailsEnabled?: boolean }
): (EmailTypeMeta & { orgEnabled: boolean })[] {
  const privileged = user.role === "owner" || user.role === "admin";
  const sendingAtAll = org.emailsEnabled !== false;
  return EMAIL_TYPE_META.filter((m) => !m.adminOnly || privileged).map((m) => ({
    ...m,
    orgEnabled: sendingAtAll && (m.orgFlag ? org[m.orgFlag] !== false : true),
  }));
}

/** Keep only known keys with boolean values, so the column can't collect junk. */
export function sanitisePrefs(input: Record<string, unknown>): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const [key, value] of Object.entries(input)) {
    if (isEmailType(key) && typeof value === "boolean") out[key] = value;
  }
  return out;
}
