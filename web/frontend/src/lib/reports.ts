export interface TimesheetDay {
  date: string;
  totalSeconds: number;
  trackedSeconds: number;
  manualSeconds: number;
  sessions: number;
}

export interface ByProjectRow {
  projectId: string;
  project: string;
  clientTag: string | null;
  /** Whether the project itself is archived. The row is still returned — time
   *  tracked against a since-archived project is still real time and belongs in
   *  a historical report — so surfaces that only want live projects filter on
   *  this rather than expecting the API to have dropped it. */
  archived: boolean;
  totalSeconds: number;
  avgActivityPct: number | null;
}

export interface ReportSummary {
  totalSeconds: number;
  avgActivityPct: number | null;
  sessions: number;
  flaggedSessions: number;
}

export interface PresenceRow {
  userId: string;
  email: string;
  online: boolean;
  lastSeenAt: string | null;
  tracking: { project: string; since: string } | null;
}

/**
 * Shown wherever a row's owner has been hard-deleted. Must match
 * DELETED_USER_LABEL / DELETED_USER_KEY in the backend's lib/org-scope.ts —
 * there is no shared package between the two, so this is the second half of a
 * pair rather than a free choice of wording.
 */
export const DELETED_USER_LABEL = "Deleted user";
export const DELETED_USER_KEY = "__deleted__";

export interface LeaderRow {
  /**
   * null for the bucket that collects orphaned sessions — hard-deleting a member
   * sets TrackingSession.userId to NULL to preserve their work, and the
   * leaderboard collapses all of those into one "Deleted user" row that has no
   * id. Anything using this as a React key must fall back to DELETED_USER_KEY.
   */
  userId: string | null;
  email: string;
  totalSeconds: number;
  avgActivityPct: number;
}

export interface UnusualFlag {
  id: string;
  type: string;
  detectedAt: string;
  acknowledgedAt: string | null;
  details: Record<string, unknown> | null;
  session: {
    id: string;
    startedAt: string;
    /**
     * null once the flagged session's owner has been hard-deleted. Flags hang off
     * TrackingSession rather than User, so they outlive the member indefinitely —
     * every render site must handle this, and one that didn't took the whole
     * Insights page down with a client exception.
     */
    user: { id: string; email: string } | null;
    project: { name: string };
  };
}
