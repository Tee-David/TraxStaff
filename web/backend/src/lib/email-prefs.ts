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
  "unusual_activity",
] as const;

export type EmailType = (typeof EMAIL_TYPES)[number];

export interface EmailTypeMeta {
  type: EmailType;
  label: string;
  description: string;
  /** Only offered to owner/admin — a member is never the audience for it. */
  adminOnly: boolean;
  default: boolean;
}

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
    type: "unusual_activity",
    label: "Unusual activity flags",
    description:
      "When the tracker flags a session for review — clock changes, jiggler processes, robotic input.",
    adminOnly: true,
    // Off by default, unlike the others: flags can arrive in bursts from a
    // single misbehaving device, and an inbox full of them is how people learn
    // to ignore the ones that matter. The bell still shows every one.
    default: false,
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
  user: { role: string; emailPrefs: unknown },
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
export function effectivePrefs(user: { role: string; emailPrefs: unknown }): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const meta of EMAIL_TYPE_META) {
    if (meta.adminOnly && user.role !== "owner" && user.role !== "admin") continue;
    out[meta.type] = wantsEmail(user, meta.type);
  }
  return out;
}

/** Keep only known keys with boolean values, so the column can't collect junk. */
export function sanitisePrefs(input: Record<string, unknown>): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const [key, value] of Object.entries(input)) {
    if (isEmailType(key) && typeof value === "boolean") out[key] = value;
  }
  return out;
}
