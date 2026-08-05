/**
 * Shared shape + labelling for the audit log, mirroring lib/notifications.ts.
 *
 * Everything a row displays comes out of `payload`, never out of a relation to
 * the actor. That is deliberate and load-bearing: an audit entry has to stay
 * readable after the account it names has been deleted, which is the whole
 * reason the table exists.
 */

export interface AuditRow {
  id: string;
  orgId: string;
  actorId: string | null;
  action: string;
  payload: {
    actorEmail?: string | null;
    targetId?: string | null;
    targetLabel?: string | null;
    [k: string]: unknown;
  } | null;
  createdAt: string;
}

/** Human label per action. Unknown actions fall back to a de-dotted form. */
const ACTION_LABELS: Record<string, string> = {
  "member.invited": "Member invited",
  "member.role_changed": "Role changed",
  "member.disabled": "Member disabled",
  "member.reenabled": "Member re-enabled",
  "member.removed": "Member removed",
  "member.deleted": "Member deleted",
  "project.archived": "Project archived",
  "project.unarchived": "Project unarchived",
  "project.deleted": "Project deleted",
  "task.deleted": "Task deleted",
  "screenshot.deleted": "Screenshot deleted",
  "idle.discarded": "Idle time discarded",
};

export function actionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action.replace(/[._]/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

/** Destructive actions read red; reversible ones read amber; the rest are quiet. */
export function actionTone(action: string): "red" | "accent" | "muted" {
  if (action.endsWith(".deleted") || action === "member.removed") return "red";
  if (action === "member.disabled" || action === "project.archived" || action === "idle.discarded") return "accent";
  return "muted";
}

export function actorOf(row: AuditRow): string {
  return row.payload?.actorEmail || "System";
}

export function targetOf(row: AuditRow): string {
  return row.payload?.targetLabel || "—";
}

/**
 * The extra context a row carries beyond actor/target — rendered as "key: value"
 * pairs. Skips the three keys that already have their own columns so they are
 * not printed twice.
 */
const OWN_COLUMN = new Set(["actorEmail", "targetId", "targetLabel"]);

export function detailPairs(row: AuditRow): { key: string; value: string }[] {
  if (!row.payload) return [];
  return Object.entries(row.payload)
    .filter(([k, v]) => !OWN_COLUMN.has(k) && v !== null && v !== undefined && v !== "")
    .map(([key, value]) => ({
      key: key.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase(),
      value: typeof value === "object" ? JSON.stringify(value) : String(value),
    }));
}

/** Same relative-time helper the notifications list uses. */
export function timeAgo(iso: string): string {
  const secs = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 60) return "just now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}
