"use client";

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { api, asArray, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { Member, Project, Session } from "@/lib/types";
import { Button, Card, Input, Label } from "@/components/ui";
import { Select } from "@/components/Select";
import { useMotionPresets } from "@/lib/motion";
import { formatDurationShort } from "@/lib/format";

const NO_TASK = "";

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function dateValue(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function timeValue(d: Date) {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Read a `<input type=date>` + `<input type=time>` pair back as a local
 * instant. `dayOffset` is how the "ends next day" case is built: adding
 * 24h to a Date would be an hour out across a DST boundary, whereas
 * constructing the next calendar day at the same wall-clock time is the
 * span the member actually means.
 */
function parseLocal(date: string, time: string, dayOffset = 0): Date | null {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  if (![y, m, d, hh, mm].every((n) => Number.isFinite(n))) return null;
  const out = new Date(y, m - 1, d + dayOffset, hh, mm, 0, 0);
  return Number.isNaN(out.getTime()) ? null : out;
}

/** Now, floored to a 5-minute mark — a tidier default than 14:37. */
function flooredNow() {
  const d = new Date();
  d.setMinutes(Math.floor(d.getMinutes() / 5) * 5, 0, 0);
  return d;
}

/**
 * Log a stretch of time the tracker didn't see — the web half of
 * `POST /sessions/manual`.
 *
 * Every entry lands marked `Manual`: this is a way to fill a gap honestly, not
 * a way around the tracker. The server refuses anything overlapping time
 * already on that person's timesheet (409), and this form additionally refuses
 * a stretch that ends in the future, since that is time nobody has worked yet.
 *
 * What happens next depends on who is filling it in, and the dialog says so
 * rather than leaving it implied:
 *
 *   - a member submits it for approval — it counts once an admin signs it off;
 *   - an owner/admin is the approval authority, so theirs counts immediately
 *     and is signed with their name, whether it is for themselves or for
 *     someone else. Either way it goes to the audit log.
 *
 * Modal shell mirrors TargetDialog (members/page.tsx) with the shared
 * backdrop/dialog motion presets the screenshots lightbox uses.
 */
export function AddTimeDialog({
  onClose,
  onAdded,
}: {
  onClose: () => void;
  onAdded: (session: Session, startedAt: Date, seconds: number) => void;
}) {
  const m = useMotionPresets();
  const { user } = useAuth();
  const isAdmin = user?.role === "owner" || user?.role === "admin";

  const [projects, setProjects] = useState<Project[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(true);

  const now = useMemo(flooredNow, []);
  const [date, setDate] = useState(() => dateValue(now));
  const [from, setFrom] = useState(() => {
    const s = new Date(now);
    s.setHours(s.getHours() - 1);
    // An hour back from just after midnight would be yesterday, and this
    // form carries a single date — start the day instead.
    return s.getDate() === now.getDate() ? timeValue(s) : "00:00";
  });
  const [to, setTo] = useState(() => timeValue(now));
  const [projectId, setProjectId] = useState("");
  // "" means the caller themselves. Only ever set from the admin-only Member
  // field, so a member's request never carries a userId at all.
  const [memberId, setMemberId] = useState("");
  const [taskId, setTaskId] = useState(NO_TASK);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // An admin picks the project from the org's full set, not from the handful
    // they happen to be assigned to — they are filing this for someone else,
    // and `?scope=all` is the existing opt-in for the management view.
    api<Project[]>(isAdmin ? "/projects?scope=all" : "/projects")
      .then((res) => setProjects(asArray<Project>(res).filter((p) => !p.archivedAt)))
      .catch(() => setProjects([]))
      .finally(() => setLoadingProjects(false));
  }, [isAdmin]);

  useEffect(() => {
    if (!isAdmin) return;
    api<Member[]>("/members")
      .then((res) => setMembers(asArray<Member>(res).filter((mem) => mem.status === "active")))
      .catch(() => setMembers([]));
  }, [isAdmin]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || saving) return;
      // A `Select` open inside this dialog answers Escape by closing its own
      // option panel; without this the same keypress would tear the whole
      // form down underneath it.
      if (document.querySelector("[data-select-panel]")) return;
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, saving]);

  const projectOptions = useMemo(
    () => projects.map((p) => ({ value: p.id, label: p.clientTag ? `${p.name} · ${p.clientTag}` : p.name })),
    [projects]
  );

  /**
   * Staff is its own field, not something inferred from the project: a project
   * usually has several people on it, so picking one would never identify whose
   * timesheet this belongs on.
   */
  const memberOptions = useMemo(
    () => [
      { value: "", label: user?.email ? `${user.email} (you)` : "Me" },
      ...members
        .filter((mem) => mem.id !== user?.id)
        .map((mem) => ({ value: mem.id, label: mem.email })),
    ],
    [members, user?.email, user?.id]
  );

  /** True only when an admin has picked someone other than themselves. */
  const forSomeoneElse = isAdmin && memberId !== "";

  // Tasks belong to a project, so the list only means anything once one is
  // picked — and a task from the previous project must not ride along.
  const tasks = useMemo(
    () => projects.find((p) => p.id === projectId)?.tasks ?? [],
    [projects, projectId]
  );
  const taskOptions = useMemo(
    () => [
      { value: NO_TASK, label: "No task" },
      ...tasks.filter((t) => t.status !== "done").map((t) => ({ value: t.id, label: t.title })),
    ],
    [tasks]
  );

  const start = parseLocal(date, from);
  const sameDayEnd = parseLocal(date, to);
  // An end *earlier* than the start reads as an overnight stretch — and is
  // shown as such in the preview rather than silently assumed. An end equal to
  // the start is not: rolling that forward would turn a typo into a 24-hour
  // entry, so it stays a zero-length span the form refuses.
  const spansMidnight = !!start && !!sameDayEnd && sameDayEnd.getTime() < start.getTime();
  const end = spansMidnight ? parseLocal(date, to, 1) : sameDayEnd;
  const seconds = start && end ? Math.round((end.getTime() - start.getTime()) / 1000) : 0;
  const endsInFuture = !!end && end.getTime() > Date.now();

  const problem = !start || !end
    ? "Fill in a date, a start and an end."
    : seconds <= 0
      ? "The end has to be after the start."
      : endsInFuture
        ? "That ends in the future — log time once you've worked it."
        : null;

  const canSave =
    !saving && !problem && projectId !== "" && reason.trim() !== "" && projects.length > 0;

  async function save() {
    if (!canSave || !start || !end) return;
    setSaving(true);
    setError(null);
    try {
      const session = await api<Session>("/sessions/manual", {
        method: "POST",
        body: JSON.stringify({
          projectId,
          ...(forSomeoneElse ? { userId: memberId } : {}),
          taskId: taskId === NO_TASK ? undefined : taskId,
          startedAt: start.toISOString(),
          endedAt: end.toISOString(),
          manualReason: reason.trim(),
        }),
      });
      onAdded(session, start, seconds);
      onClose();
    } catch (e) {
      setError(
        e instanceof ApiError
          ? e.message
          : "Couldn't save that entry. Check your connection and try again."
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
        role="dialog"
        aria-modal="true"
        aria-label="Add time"
        {...m.backdrop}
      >
        <div className="absolute inset-0 bg-black/40" onClick={() => !saving && onClose()} />
        <motion.div className="relative z-10 w-full max-w-md" {...m.dialog}>
          <Card className="max-h-[85vh] overflow-y-auto p-6">
            <h2 className="font-heading text-[15px] font-semibold text-ink">Add time</h2>
            <p className="mt-1 text-[12px] text-muted">
              For time the tracker missed. It lands marked{" "}
              <strong className="text-ink">Manual</strong>, and can&rsquo;t overlap time already
              logged.
            </p>

            {loadingProjects ? (
              <div className="mt-5 space-y-3">
                {[0, 1, 2].map((i) => <div key={i} className="skeleton h-10" />)}
              </div>
            ) : projects.length === 0 ? (
              <p className="mt-5 rounded-lg bg-canvas px-3 py-4 text-center text-[13px] text-muted">
                {isAdmin
                  ? "There are no active projects to log time against yet. Create one first."
                  : "You're not assigned to any project yet, and manual time is always logged against one. Ask an admin to assign you."}
              </p>
            ) : (
              <div className="mt-5 space-y-4">
                {isAdmin && (
                  <div>
                    <Label>Staff member</Label>
                    <Select
                      value={memberId}
                      onChange={setMemberId}
                      options={memberOptions}
                      minWidth={280}
                      searchable
                      block
                    />
                  </div>
                )}

                <div>
                  <Label>Project</Label>
                  <Select
                    value={projectId}
                    onChange={(v) => {
                      setProjectId(v);
                      setTaskId(NO_TASK);
                    }}
                    options={projectOptions}
                    placeholder="Pick a project"
                    minWidth={280}
                    searchable
                    block
                  />
                </div>

                {taskOptions.length > 1 && (
                  <div>
                    <Label>Task (optional)</Label>
                    <Select value={taskId} onChange={setTaskId} options={taskOptions} minWidth={280} block />
                  </div>
                )}

                <div>
                  <Label>Date</Label>
                  <Input type="date" value={date} max={dateValue(new Date())} onChange={(e) => setDate(e.target.value)} />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Start</Label>
                    <Input type="time" value={from} onChange={(e) => setFrom(e.target.value)} />
                  </div>
                  <div>
                    <Label>End</Label>
                    <Input type="time" value={to} onChange={(e) => setTo(e.target.value)} />
                  </div>
                </div>

                <div className="rounded-lg bg-canvas px-3 py-2.5 text-[13px]">
                  {problem ? (
                    <span className="text-muted">{problem}</span>
                  ) : (
                    <span className="text-ink">
                      <span className="tnum font-semibold">{formatDurationShort(seconds)}</span>
                      {spansMidnight && (
                        <span className="text-muted">
                          {" "}
                          · ends the next day{end ? ` (${end.toLocaleDateString([], { month: "short", day: "numeric" })})` : ""}
                        </span>
                      )}
                    </span>
                  )}
                </div>

                <div>
                  <Label>Why it wasn&rsquo;t tracked</Label>
                  <Input
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Laptop was offline, worked on site…"
                    maxLength={200}
                  />
                  <p className="mt-1.5 text-[12px] text-muted">
                    {forSomeoneElse
                      ? "Sent to the member with the entry, so they can see why it was added."
                      : isAdmin
                        ? "Stored with the entry and shown in the audit log, so the hours can be read in context."
                        : "Goes to whoever reviews this, so the manual hours can be read in context."}
                  </p>
                </div>

                {/* What pressing the button will actually do. The two outcomes
                    differ in whether the time counts straight away, and finding
                    that out afterwards — from a queue, or from a total that
                    moved — is how an approval flow loses people's trust. */}
                <p className="rounded-lg border border-border px-3 py-2.5 text-[12px] text-muted">
                  {forSomeoneElse
                    ? "You're adding this on their behalf, so it counts immediately and is recorded against your name. They'll be notified."
                    : isAdmin
                      ? "As an admin this counts immediately, without review. It's recorded in the audit log against your name."
                      : "This goes to an admin for approval. It shows on your timesheet as pending until someone reviews it."}
                </p>
              </div>
            )}

            {error && (
              <p className="mt-4 rounded-lg bg-[var(--color-negative)]/10 px-3 py-2.5 text-[13px] text-[var(--color-negative)]">
                {error}
              </p>
            )}

            <div className="mt-6 flex justify-end gap-2">
              <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
              <Button onClick={save} disabled={!canSave}>
                {saving ? "Adding…" : isAdmin ? "Add time" : "Submit for approval"}
              </Button>
            </div>
          </Card>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
