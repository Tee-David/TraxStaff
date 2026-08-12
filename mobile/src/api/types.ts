// Response shapes mirrored from web/backend/src/routes/*. Dates cross the wire
// as ISO strings (Fastify JSON-serialises Prisma's Date), so they are typed as
// strings here — never as Date.

export type Role = "owner" | "admin" | "member";
export type TaskStatus = "todo" | "in_progress" | "done";
export type TaskPriority = "lowest" | "normal" | "urgent";
export type SessionEndReason = "stopped" | "idle_timeout" | "abrupt_exit";

/** POST /auth/login, POST /auth/accept-invite */
export type AuthResponse = {
  token: string;
  user: { id: string; email: string; role: Role };
};

/** GET /auth/me */
export type Me = {
  id: string;
  email: string;
  role: Role;
  orgId: string;
  consentAcceptedAt: string | null;
  consentVersion: number | null;
};

/** GET /projects/:id/tasks, POST /projects/:id/tasks, PATCH /tasks/:id */
export type Task = {
  id: string;
  projectId: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate: string | null;
  createdAt: string;
};

/** GET /projects — includes `tasks` */
export type Project = {
  id: string;
  orgId: string;
  name: string;
  clientTag: string | null;
  archivedAt: string | null;
  createdAt: string;
  tasks: Task[];
};

/** GET /sessions */
export type Session = {
  id: string;
  userId: string;
  projectId: string;
  taskId: string | null;
  deviceId: string;
  startedAt: string;
  endedAt: string | null;
  /**
   * Where the session effectively ends, decided server-side. Equals `endedAt` when
   * closed; for an open one it is "now" while the device is still heartbeating and
   * the last evidence of life once it isn't.
   *
   * Read this instead of `endedAt ?? Date.now()`: nothing used to close a session
   * abandoned by a crash or a shutdown, so an open row grew forever and one
   * forgotten session showed up as tens of hours of work.
   */
  effectiveEndAt?: string;
  /** Bounded wall clock minus idle the member discarded. The canonical duration. */
  workedSeconds?: number;
  /** Open, but no longer proving it is alive — left behind, not running. */
  abandoned?: boolean;
  /**
   * Stretches deducted from this session, with their real spans. Needed to charge a
   * deduction to the day it happened in rather than spreading it over the session.
   */
  idleSpans?: { from: string; to: string; seconds: number }[];
  endReason: SessionEndReason | null;
  isManual: boolean;
  manualReason: string | null;
  tamperSuspected: boolean;
  createdAt: string;
  project: { id: string; name: string; clientTag: string | null };
  task: { id: string; title: string } | null;
  /** null once the owner has been hard-deleted — their work outlives them. */
  user: { id: string; email: string } | null;
  notes: { id: string; body: string; createdAt: string }[];
};

/** POST /sessions/start — the created row plus its resolved deviceId */
export type StartedSession = {
  id: string;
  userId: string;
  projectId: string;
  taskId: string | null;
  deviceId: string;
  startedAt: string;
  endedAt: string | null;
};

/** GET /reports/summary. `avgActivityPct` is always null for mobile-only work —
 *  activity % is a desktop-only concept and the phone never produces blocks. */
export type ReportSummary = {
  totalSeconds: number;
  avgActivityPct: number | null;
  sessions: number;
  flaggedSessions: number;
};

/** GET /reports/timesheet */
export type TimesheetDay = {
  date: string;
  totalSeconds: number;
  trackedSeconds: number;
  manualSeconds: number;
  sessions: number;
};
