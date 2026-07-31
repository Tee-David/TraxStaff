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
  userId: string;
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
    user: { id: string; email: string };
    project: { name: string };
  };
}
