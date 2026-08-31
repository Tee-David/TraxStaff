/**
 * Shared notification shape and labelling.
 *
 * Both the header bell and the full Notifications page render the same rows, and
 * they drifted apart when each had its own copy of `describe` — the bell said
 * "Babatope@…: Jiggler process detected" while the page would have said
 * something else for the same row. One definition, used by both.
 */
export interface AppNotification {
  id: string;
  type: string;
  payload: Record<string, unknown> | null;
  readAt: string | null;
  createdAt: string;
}

/** Human labels for the flag types the detector emits (see backend sync.ts). */
const FLAG_LABELS: Record<string, string> = {
  sustained_high_activity: "Sustained high activity",
  low_variance_robotic: "Robotic / low-variance input",
  input_channel_imbalance: "Input channel imbalance",
  jiggler_process_detected: "Mouse-jiggler detected",
  clock_skew_detected: "System clock changed",
  exceeds_elapsed_cap: "Claimed more time than elapsed",
  block_outside_session_window: "Activity outside session window",
};

/** The member a notification is about, as a short name rather than a full address. */
export function notificationWho(n: AppNotification): string | null {
  const email = n.payload?.memberEmail;
  return typeof email === "string" ? email.split("@")[0] : null;
}

/** A payload number, or null when the row predates the field. */
function count(p: Record<string, unknown>, key: string): number | null {
  const v = p[key];
  return typeof v === "number" ? v : null;
}

/** What happened, without the who — the row renders the two separately. */
export function notificationWhat(n: AppNotification): string {
  const p = n.payload ?? {};

  if (n.type === "unusual_activity") {
    const kind = typeof p.type === "string" ? p.type : null;
    return (kind && FLAG_LABELS[kind]) || kind?.replace(/_/g, " ") || "Unusual activity";
  }

  // The digest rows are org-wide (no userId), so they carry their own summary
  // rather than a member name — `notificationWho` returns null for them.
  if (n.type === "daily_shortfall" || n.type === "weekly_shortfall") {
    const period = n.type === "daily_shortfall" ? "day" : "week";
    const short = count(p, "shortfallCount");
    const total = count(p, "totalMembers");
    if (short === 0) return `Everyone met their target last ${period}`;
    if (short === null) return `Work-target digest for the ${period}`;
    return total === null
      ? `${short} below target last ${period}`
      : `${short} of ${total} below target last ${period}`;
  }

  if (n.type === "unusual_activity_digest") {
    const flags = count(p, "flagCount");
    return flags === null
      ? "Unusual activity digest"
      : `${flags} session${flags === 1 ? "" : "s"} flagged for review`;
  }

  if (n.type === "member_weekly_summary") {
    const to = count(p, "recipients");
    return to === null
      ? "Weekly summaries sent to members"
      : `Weekly summaries sent to ${to} member${to === 1 ? "" : "s"}`;
  }

  // Manual-time rows carry the numbers that make them worth reading. "Manual
  // time submitted" tells an admin nothing they can act on; "submitted 3h 30m
  // for approval" tells them whether to look now.
  const duration = typeof p.duration === "string" ? p.duration : null;
  if (n.type === "manual_time_submitted") {
    return duration ? `Submitted ${duration} for approval` : "Submitted manual time for approval";
  }
  if (n.type === "manual_time_decided") {
    const decision = p.decision === "rejected" ? "rejected" : "approved";
    return duration ? `Manual time ${decision} (${duration})` : `Manual time ${decision}`;
  }
  if (n.type === "manual_time_added") {
    const by = typeof p.addedBy === "string" ? p.addedBy.split("@")[0] : "an admin";
    // No "to their timesheet": the row already names whose timesheet it is, and
    // the pronoun reads as the admin's once the two names sit side by side.
    return duration ? `${by} added ${duration}` : `${by} added manual time`;
  }
  return n.type.replace(/_/g, " ");
}

/** One-line form, for the narrow bell dropdown. */
export function describeNotification(n: AppNotification): string {
  const who = notificationWho(n);
  const what = notificationWhat(n);
  return who ? `${who}: ${what}` : what;
}

/** Relative time for a row — "4m ago", "3d ago". Absolute date is shown alongside. */
export function timeAgo(iso: string): string {
  const secs = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (secs < 60) return "just now";
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}
