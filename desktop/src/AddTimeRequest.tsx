import { useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";
import { api, ApiError, type Project, type Session } from "./api";
import { Select } from "./Select";
import { DatePicker } from "./DatePicker";
import { TimePicker } from "./TimePicker";

/**
 * Request time the tracker didn't see — the desktop half of
 * `POST /sessions/manual`.
 *
 * The endpoint, the approval queue and the notifications all already existed;
 * only the web app could reach them. That left a member whose tracker had
 * failed — the Wayland case this shipped alongside — looking at time they had
 * worked, on the machine they had worked it on, with no way to say so without
 * going to find a browser.
 *
 * Scope is deliberately the member's own time. An admin filing on someone
 * else's behalf picks a person, a project outside their own assignments and
 * signs it with their name; that is a management screen, and it stays in the
 * web app rather than being half-rebuilt in a 420px tray window.
 *
 * What happens after submitting depends on who is asking, and the dialog says
 * so rather than leaving it implied: a member's entry waits for an admin, while
 * an owner/admin IS the approval authority, so theirs counts immediately.
 *
 * Approved time never dilutes an activity score. Activity is computed purely
 * over ActivityBlock rows (see web/backend/src/lib/activity.ts) and a manual
 * entry has none, so it is absent from both sides of the average rather than
 * landing in it as a stretch of 0%.
 */

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
 * instant. `dayOffset` is how the "ends next day" case is built: adding 24h to
 * a Date would be an hour out across a DST boundary, whereas constructing the
 * next calendar day at the same wall-clock time is the span the member means.
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

function fmtSpan(secs: number) {
  const h = Math.floor(secs / 3600);
  const m = Math.round((secs % 3600) / 60);
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}

export function AddTimeRequest({
  isAdmin,
  onClose,
  onAdded,
}: {
  isAdmin: boolean;
  onClose: () => void;
  onAdded: (session: Session) => void;
}) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(true);

  const now = useMemo(flooredNow, []);
  const [date, setDate] = useState(() => dateValue(now));
  const [from, setFrom] = useState(() => {
    const s = new Date(now);
    s.setHours(s.getHours() - 1);
    // An hour back from just after midnight would be yesterday, and this form
    // carries a single date — start the day instead.
    return s.getDate() === now.getDate() ? timeValue(s) : "00:00";
  });
  const [to, setTo] = useState(() => timeValue(now));
  const [projectId, setProjectId] = useState("");
  const [taskId, setTaskId] = useState(NO_TASK);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  // What is already on this member's timesheet for the chosen date.
  //
  // The server refuses an overlapping entry with a 409, which was the entire
  // feedback a member got: told their hours clashed with something, and given
  // no way to see what. Showing the day's existing entries turns "that
  // overlaps" into "that overlaps THIS, here is the gap".
  const [dayEntries, setDayEntries] = useState<Session[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Project[]>("/projects")
      .then((res) => {
        const list = (Array.isArray(res) ? res : []).filter((p) => !p.archivedAt);
        setProjects(list);
        if (list.length === 1) setProjectId(list[0].id);
      })
      .catch(() => setProjects([]))
      .finally(() => setLoadingProjects(false));
  }, []);

  useEffect(() => {
    const [y, m, d] = date.split("-").map(Number);
    if (![y, m, d].every(Number.isFinite)) return;
    const from = new Date(y, m - 1, d, 0, 0, 0, 0);
    const to = new Date(y, m - 1, d + 1, 0, 0, 0, 0);
    let cancelled = false;
    setDayEntries(null);
    api<Session[]>(`/sessions?from=${from.toISOString()}&to=${to.toISOString()}`)
      .then((res) => {
        if (cancelled) return;
        // Rejected time is not on the timesheet, so it cannot be clashed with —
        // and the server agrees: its overlap check excludes rejected rows too.
        setDayEntries((Array.isArray(res) ? res : []).filter((x) => x.approvalState !== "rejected"));
      })
      .catch(() => !cancelled && setDayEntries([]));
    return () => { cancelled = true; };
  }, [date]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !saving) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, saving]);

  const projectOptions = useMemo(
    () => [
      { value: "", label: "Choose a project" },
      ...projects.map((p) => ({
        value: p.id,
        label: p.clientTag ? `${p.name} · ${p.clientTag}` : p.name,
      })),
    ],
    [projects]
  );

  // A task from the previously selected project must not ride along.
  const tasks = useMemo(
    () => projects.find((p) => p.id === projectId)?.tasks ?? [],
    [projects, projectId]
  );
  useEffect(() => {
    setTaskId(NO_TASK);
  }, [projectId]);

  const taskOptions = useMemo(
    () => [
      { value: NO_TASK, label: "No task" },
      ...tasks.filter((t) => t.status !== "done").map((t) => ({ value: t.id, label: t.title })),
    ],
    [tasks]
  );

  /** When an existing row effectively ends. An open session runs until now. */
  function entryEnd(e: Session): number {
    const raw = e.endedAt ?? e.effectiveEndAt;
    return raw ? new Date(raw).getTime() : Date.now();
  }

  function entryLabel(e: Session): string {
    const t = (ms: number) => {
      const d = new Date(ms);
      return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    };
    const name = e.project?.name ?? "Unknown project";
    return `${t(new Date(e.startedAt).getTime())}–${t(entryEnd(e))} · ${name}${e.isManual ? " (manual)" : ""}`;
  }

  const start = parseLocal(date, from);
  const sameDayEnd = parseLocal(date, to);
  // An end *earlier* than the start reads as an overnight stretch, and is shown
  // as such rather than silently assumed. An end EQUAL to the start is not:
  // rolling that forward would turn a typo into a 24-hour entry, so it stays a
  // zero-length span the form refuses.
  const spansMidnight = !!start && !!sameDayEnd && sameDayEnd.getTime() < start.getTime();
  const end = spansMidnight ? parseLocal(date, to, 1) : sameDayEnd;
  const seconds = start && end ? Math.round((end.getTime() - start.getTime()) / 1000) : 0;

  // The same rule the server applies: two intervals overlap when
  // existing.start < new.end AND existing.end > new.start.
  const clash =
    start && end
      ? (dayEntries ?? []).find(
          (e) => new Date(e.startedAt).getTime() < end.getTime() && entryEnd(e) > start.getTime()
        )
      : undefined;

  const problem =
    !start || !end
      ? "Fill in a date, a start and an end."
      : seconds <= 0
        ? "The end has to be after the start."
        : end.getTime() > Date.now()
          ? "That ends in the future — request time once you've worked it."
          : seconds > 24 * 3600
            ? "A single entry can't be longer than 24 hours."
            : start.getTime() < Date.now() - 90 * 24 * 3600 * 1000
              ? "That's more than 90 days ago, which is too far back to add."
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
          taskId: taskId === NO_TASK ? undefined : taskId,
          startedAt: start.toISOString(),
          endedAt: end.toISOString(),
          manualReason: reason.trim(),
        }),
      });
      onAdded(session);
      onClose();
    } catch (e) {
      // The server's own wording is better than anything generic here: it knows
      // whether this overlapped an existing entry, named a project the member
      // isn't on, or fell outside the backdating window.
      setError(
        e instanceof ApiError
          ? e.message
          : "Couldn't send that request. Check your connection and try again."
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <motion.div
      className="note-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={() => !saving && onClose()}
    >
      <motion.div
        className="note-modal addtime-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Request time"
        initial={{ scale: 0.96, y: 8 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.96, y: 8 }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="note-title">Request time</h3>
        <p className="addtime-sub">
          For time the tracker missed. It lands marked <strong>Manual</strong>, can&rsquo;t overlap
          time already logged, and doesn&rsquo;t affect your activity score.
        </p>

        {loadingProjects ? (
          <div className="addtime-empty">Loading projects…</div>
        ) : projects.length === 0 ? (
          <div className="addtime-empty">
            You&rsquo;re not assigned to a project yet, and requested time is always logged against
            one. Ask an admin to assign you.
          </div>
        ) : (
          <>
            <label className="addtime-label">Date</label>
            {/* The app's own picker, not input[type=date]: the native control
                follows the OS locale, so it offered mm/dd/yyyy beside fields the
                rest of the app writes as dd/mm/yyyy. */}
            <DatePicker
              value={date}
              max={dateValue(new Date())}
              onChange={(iso) => iso && setDate(iso)}
            />

            {/* What is already on the timesheet for this date. Shown BEFORE the
                time fields, because it is the thing that decides what to type
                into them. */}
            {dayEntries === null ? (
              <div className="addtime-day addtime-day-loading">Checking this day…</div>
            ) : dayEntries.length === 0 ? (
              <div className="addtime-day">Nothing logged on this day yet.</div>
            ) : (
              <div className="addtime-day">
                <div className="addtime-day-head">Already logged</div>
                {dayEntries
                  .slice()
                  .sort((a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime())
                  .map((e) => (
                    <div
                      key={e.id}
                      className={`addtime-day-row ${clash && clash.id === e.id ? "is-clash" : ""}`}
                    >
                      {entryLabel(e)}
                    </div>
                  ))}
              </div>
            )}

            <div className="addtime-row">
              <div>
                <label className="addtime-label" htmlFor="addtime-from">
                  From
                </label>
                <TimePicker id="addtime-from" value={from} onChange={setFrom} ariaLabel="From" />
              </div>
              <div>
                <label className="addtime-label" htmlFor="addtime-to">
                  To
                </label>
                <TimePicker id="addtime-to" value={to} onChange={setTo} ariaLabel="To" />
              </div>
            </div>

            <label className="addtime-label">Project</label>
            <Select
              value={projectId}
              options={projectOptions}
              onChange={setProjectId}
              ariaLabel="Project"
            />

            {taskOptions.length > 1 && (
              <>
                <label className="addtime-label">Task</label>
                <Select value={taskId} options={taskOptions} onChange={setTaskId} ariaLabel="Task" />
              </>
            )}

            <label className="addtime-label" htmlFor="addtime-reason">
              Reason
            </label>
            <textarea
              id="addtime-reason"
              className="note-input addtime-reason"
              maxLength={500}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why the tracker missed this — an admin reads this before deciding."
            />

            {/* The preview earns its place: it is the only thing that shows an
                overnight span was understood as overnight rather than as a typo. */}
            {!problem && seconds > 0 && (
              <div className="addtime-preview">
                {fmtSpan(seconds)}
                {spansMidnight ? " · ends next day" : ""}
                {isAdmin
                  ? " · counts immediately, signed with your name"
                  : " · sent to an admin to approve"}
              </div>
            )}
            {problem && <div className="addtime-problem">{problem}</div>}
            {error && <div className="addtime-error">{error}</div>}
          </>
        )}

        <div className="note-actions">
          <button className="note-cancel" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button className="note-save" onClick={save} disabled={!canSave}>
            {saving ? "Sending…" : isAdmin ? "Add time" : "Send request"}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
