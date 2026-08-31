export interface Project {
  id: string;
  name: string;
  clientTag: string | null;
  archivedAt: string | null;
  createdAt: string;
  tasks?: Task[];
  /** Present for admin/owner responses only — current ProjectMember user ids. */
  assignedUserIds?: string[];
}

export interface Task {
  id: string;
  projectId: string;
  title: string;
  status: "todo" | "in_progress" | "done";
  priority: "lowest" | "normal" | "urgent";
  dueDate: string | null;
  createdAt: string;
}

export interface Member {
  id: string;
  email: string;
  role: "owner" | "admin" | "member";
  /** Platform staff — see the note on AuthUser in lib/api.ts. */
  isSuperAdmin?: boolean;
  status: "invited" | "active" | "disabled" | "removed";
  createdAt: string;
  /** null = inherits the org default. 0 is a real target of no hours. */
  dailyTargetMinutes: number | null;
  weeklyTargetMinutes: number | null;
}

export interface Session {
  id: string;
  /** null once the owner has been hard-deleted — see `user` below. */
  userId: string | null;
  projectId: string;
  taskId: string | null;
  startedAt: string;
  endedAt: string | null;
  /**
   * Where this session effectively ends, decided server-side (backend
   * lib/duration.ts). Equal to `endedAt` when closed; for an open session it is
   * "now" while the device is still heartbeating and the last evidence of life
   * once it isn't. Read this, never `endedAt ?? now` — see sessionEnd() in
   * lib/format.ts for why.
   */
  effectiveEndAt?: string;
  /** Bounded wall clock minus idle the member discarded. The canonical duration. */
  workedSeconds?: number;
  /** Open, but no longer proving it is alive — i.e. left behind, not running. */
  abandoned?: boolean;
  /**
   * Stretches deducted from this session, with their real spans. Needed to charge a
   * deduction to the day it happened in rather than spreading it over the session.
   */
  idleSpans?: { from: string; to: string; seconds: number }[];
  endReason: "stopped" | "idle_timeout" | "abrupt_exit" | null;
  isManual: boolean;
  manualReason: string | null;
  tamperSuspected: boolean;
  project: { id: string; name: string; clientTag: string | null };
  task: { id: string; title: string } | null;
  /**
   * null once the owner has been hard-deleted (TrackingSession.userId is
   * SetNull so their tracked work survives). Today GET /sessions always pins
   * `where.userId` to a concrete id so an orphan can't come back through it —
   * but that is one scope change away from being untrue, and the type must not
   * be the thing that hides it.
   */
  user: { id: string; email: string } | null;
}
