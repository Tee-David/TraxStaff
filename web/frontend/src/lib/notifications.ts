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

/** What happened, without the who — the row renders the two separately. */
export function notificationWhat(n: AppNotification): string {
  const p = n.payload ?? {};
  if (n.type === "unusual_activity") {
    const kind = typeof p.type === "string" ? p.type : null;
    return (kind && FLAG_LABELS[kind]) || kind?.replace(/_/g, " ") || "Unusual activity";
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
