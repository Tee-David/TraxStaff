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

export interface LeaderRow {
  /** Null for the row that collects work whose owner was hard-deleted — the
   *  hours stay in the org's totals, so the row has an email label but no id. */
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
    /** A flag is org-scoped through its session's project, so it outlives the
     *  member who earned it: once the owner is hard-deleted there is no user to
     *  read an email off. The API substitutes a "Deleted user" label, but this
     *  stays nullable so a caller can't dereference it blind — doing exactly
     *  that used to take the whole Insights page down. */
    user: { id: string | null; email: string } | null;
    project: { name: string };
  };
}
