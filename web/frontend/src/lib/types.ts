export interface Project {
  id: string;
  name: string;
  clientTag: string | null;
  archivedAt: string | null;
  createdAt: string;
  tasks?: Task[];
}

export interface Task {
  id: string;
  projectId: string;
  title: string;
  status: "todo" | "in_progress" | "done";
  createdAt: string;
}

export interface Member {
  id: string;
  email: string;
  role: "owner" | "admin" | "member";
  status: "invited" | "active" | "disabled";
  createdAt: string;
}

export interface Session {
  id: string;
  userId: string;
  projectId: string;
  taskId: string | null;
  startedAt: string;
  endedAt: string | null;
  endReason: "stopped" | "idle_timeout" | "abrupt_exit" | null;
  isManual: boolean;
  manualReason: string | null;
  tamperSuspected: boolean;
  project: { id: string; name: string; clientTag: string | null };
  task: { id: string; title: string } | null;
  user: { id: string; email: string };
}
