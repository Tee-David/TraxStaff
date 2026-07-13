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
