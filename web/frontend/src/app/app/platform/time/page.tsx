"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError, asArray } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import {
  daysBetween,
  hoursMinutes,
  shortDay,
  todayKey,
  weekStart,
  addDays,
  type TimePlanResponse,
} from "@/lib/platform";
import { Badge, Button, Card, EmptyState, Input, Label, PageHeader } from "@/components/ui";
import { Select } from "@/components/Select";

/**
 * Writing hours and activity onto somebody's record, from outside their org.
 *
 * The form is the easy half. The important half is the preview: every field here
 * changes what will be written to a real person's timesheet, and two of the
 * options delete tracked work. So nothing commits directly — the flow is always
 * preview, read, then commit the plan you were shown, and the preview is exact
 * because the backend seeds its jitter from the session ids it will use.
 */

interface OrgOption {
  id: string;
  name: string;
}

interface OrgDetail {
  members: { id: string; email: string; status: string; isSuperAdmin: boolean }[];
  projects: { id: string; name: string; archivedAt: string | null }[];
}

type Mode = "day" | "week" | "range" | "days";
type Fill = "topUp" | "add" | "replace";
type Tab = "hours" | "activity";

export default function PlatformTimePage() {
  const { user: me } = useAuth();

  const [tab, setTab] = useState<Tab>("hours");
  const [orgs, setOrgs] = useState<OrgOption[]>([]);
  const [orgId, setOrgId] = useState("");
  const [detail, setDetail] = useState<OrgDetail | null>(null);
  const [userId, setUserId] = useState("");
  const [projectId, setProjectId] = useState("");

  const [mode, setMode] = useState<Mode>("week");
  const [date, setDate] = useState(todayKey());
  const [from, setFrom] = useState(weekStart(todayKey()));
  const [to, setTo] = useState(addDays(weekStart(todayKey()), 6));
  const [picked, setPicked] = useState<string[]>([]);

  const [amountKind, setAmountKind] = useState<"total" | "perDay">("total");
  const [totalHours, setTotalHours] = useState("40");
  const [hoursPerDay, setHoursPerDay] = useState("8");

  const [activityPct, setActivityPct] = useState("45");
  const [activityJitter, setActivityJitter] = useState("9");
  const [lengthJitterPct, setLengthJitterPct] = useState("15");
  const [startJitterMinutes, setStartJitterMinutes] = useState("20");
  const [breakMinutes, setBreakMinutes] = useState("0");
  const [includeWeekends, setIncludeWeekends] = useState(false);
  const [matchMemberPattern, setMatchMemberPattern] = useState(true);

  const [fill, setFill] = useState<Fill>("topUp");
  const [replaceCaptured, setReplaceCaptured] = useState(false);
  const [recordAs, setRecordAs] = useState<"manual" | "tracked">("manual");
  const [includeCaptured, setIncludeCaptured] = useState(false);
  const [reason, setReason] = useState("");

  const [plan, setPlan] = useState<TimePlanResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    api<OrgOption[]>("/admin/orgs")
      .then((r) => setOrgs(asArray(r)))
      .catch(() => setOrgs([]));
  }, []);

  useEffect(() => {
    if (!orgId) {
      setDetail(null);
      return;
    }
    setUserId("");
    setProjectId("");
    api<OrgDetail>(`/admin/orgs/${orgId}`)
      .then(setDetail)
      .catch(() => setDetail(null));
  }, [orgId]);

  // Keep the specific-days picker in step with the range it is chosen from.
  const pickableDays = useMemo(() => daysBetween(from, to), [from, to]);

  const periodBody = useCallback(() => {
    if (mode === "day") return { mode, date };
    if (mode === "week") return { mode, date };
    if (mode === "days") return { mode, days: picked };
    return { mode, from, to };
  }, [mode, date, from, to, picked]);

  if (me && !me.isSuperAdmin) {
    return <EmptyState icon="🔒" title="Not available" hint="This area is for platform staff." />;
  }

  async function submit(dryRun: boolean) {
    setBusy(true);
    setError(null);
    setNotice(null);
    if (dryRun) setPlan(null);

    try {
      if (tab === "activity") {
        const res = await api<TimePlanResponse>(`/admin/users/${userId}/activity`, {
          method: "PATCH",
          body: JSON.stringify({
            ...periodBody(),
            activityPct: Number(activityPct),
            activityJitter: Number(activityJitter),
            includeCaptured,
            dryRun,
          }),
        });
        setPlan(res);
        if (!dryRun) setNotice("Activity updated.");
        return;
      }

      const res = await api<TimePlanResponse>("/admin/time", {
        method: "POST",
        body: JSON.stringify({
          userId,
          projectId,
          ...periodBody(),
          ...(amountKind === "total"
            ? { totalHours: Number(totalHours) }
            : { hoursPerDay: Number(hoursPerDay) }),
          activityPct: Number(activityPct),
          activityJitter: Number(activityJitter),
          lengthJitterPct: Number(lengthJitterPct),
          startJitterMinutes: Number(startJitterMinutes),
          breakMinutes: Number(breakMinutes),
          includeWeekends,
          matchMemberPattern,
          fill,
          replaceCaptured,
          recordAs,
          reason: reason.trim(),
          dryRun,
        }),
      });
      setPlan(res);
      if (!dryRun) setNotice(res.written ? "Written." : res.reason ?? "Nothing to write.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  const members = (detail?.members ?? []).filter((m) => !m.isSuperAdmin);
  const projects = (detail?.projects ?? []).filter((p) => !p.archivedAt);
  const ready =
    Boolean(orgId && userId && reason.trim()) &&
    (tab === "activity" || Boolean(projectId)) &&
    (mode !== "days" || picked.length > 0);
  const activityReady = Boolean(orgId && userId) && (mode !== "days" || picked.length > 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Time &amp; activity"
        subtitle="Record hours or set activity for anyone, in any organization."
      />

      <div className="flex gap-1 rounded-xl border border-border bg-canvas p-1">
        {(["hours", "activity"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => {
              setTab(t);
              setPlan(null);
              setNotice(null);
              setError(null);
            }}
            className={`flex-1 rounded-lg px-4 py-2 text-sm font-medium transition ${
              tab === t ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink"
            }`}
          >
            {t === "hours" ? "Write hours" : "Set activity only"}
          </button>
        ))}
      </div>

      {error && (
        <Card className="border-[var(--color-negative)]/30 bg-[var(--color-negative)]/5 p-4 text-sm text-[var(--color-negative)]">
          {error}
        </Card>
      )}
      {notice && (
        <Card className="border-[var(--color-positive)]/30 bg-[var(--color-positive)]/5 p-4 text-sm text-[var(--color-positive)]">
          {notice}
        </Card>
      )}

      <Card className="p-5">
        <h2 className="mb-4 font-heading text-base font-semibold">Who</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <Label>Organization</Label>
            <Select
              value={orgId}
              onChange={setOrgId}
              options={[{ value: "", label: "Choose…" }, ...orgs.map((o) => ({ value: o.id, label: o.name }))]}
            />
          </div>
          <div>
            <Label>Member</Label>
            <Select
              value={userId}
              onChange={setUserId}
              options={[
                { value: "", label: orgId ? "Choose…" : "Pick an organization first" },
                ...members.map((m) => ({ value: m.id, label: m.email })),
              ]}
            />
          </div>
          {tab === "hours" && (
            <div>
              <Label>Project</Label>
              <Select
                value={projectId}
                onChange={setProjectId}
                options={[
                  { value: "", label: orgId ? "Choose…" : "Pick an organization first" },
                  ...projects.map((p) => ({ value: p.id, label: p.name })),
                ]}
              />
            </div>
          )}
        </div>
      </Card>

      <Card className="p-5">
        <h2 className="mb-4 font-heading text-base font-semibold">When</h2>
        <div className="mb-4 flex flex-wrap gap-2">
          {(
            [
              ["day", "A day"],
              ["week", "A week"],
              ["range", "A range"],
              ["days", "Specific days"],
            ] as [Mode, string][]
          ).map(([value, label]) => (
            <button
              key={value}
              onClick={() => setMode(value)}
              className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition ${
                mode === value
                  ? "border-brand bg-brand/10 text-brand"
                  : "border-border text-muted hover:bg-canvas"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {(mode === "day" || mode === "week") && (
          <div className="max-w-xs">
            <Label>{mode === "week" ? "Any day in the week" : "Date"}</Label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            {mode === "week" && (
              <p className="mt-1.5 text-xs text-muted">
                Monday&ndash;Sunday of that week: {shortDay(weekStart(date))} to{" "}
                {shortDay(addDays(weekStart(date), 6))}
              </p>
            )}
          </div>
        )}

        {(mode === "range" || mode === "days") && (
          <div className="grid max-w-xl gap-4 sm:grid-cols-2">
            <div>
              <Label>From</Label>
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div>
              <Label>To</Label>
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
          </div>
        )}

        {mode === "days" && (
          <div className="mt-4">
            <Label>Pick the days to write</Label>
            <div className="flex flex-wrap gap-2">
              {pickableDays.map((d) => {
                const on = picked.includes(d);
                return (
                  <button
                    key={d}
                    onClick={() =>
                      setPicked((p) => (on ? p.filter((x) => x !== d) : [...p, d].sort()))
                    }
                    className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium transition ${
                      on
                        ? "border-brand bg-brand/10 text-brand"
                        : "border-border text-muted hover:bg-canvas"
                    }`}
                  >
                    {shortDay(d)}
                  </button>
                );
              })}
            </div>
            <p className="mt-2 text-xs text-muted">
              {picked.length} selected. Naming a weekend day includes it.
            </p>
          </div>
        )}
      </Card>

      {tab === "hours" ? (
        <>
          <Card className="p-5">
            <h2 className="mb-4 font-heading text-base font-semibold">How much</h2>
            <div className="mb-4 flex flex-wrap gap-2">
              {(
                [
                  ["total", "Total across the period"],
                  ["perDay", "Per day"],
                ] as ["total" | "perDay", string][]
              ).map(([value, label]) => (
                <button
                  key={value}
                  onClick={() => setAmountKind(value)}
                  className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition ${
                    amountKind === value
                      ? "border-brand bg-brand/10 text-brand"
                      : "border-border text-muted hover:bg-canvas"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <Label>{amountKind === "total" ? "Total hours" : "Hours per day"}</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0.1"
                  value={amountKind === "total" ? totalHours : hoursPerDay}
                  onChange={(e) =>
                    amountKind === "total"
                      ? setTotalHours(e.target.value)
                      : setHoursPerDay(e.target.value)
                  }
                />
                <p className="mt-1.5 text-xs text-muted">
                  40h 02m is <code>40.0333</code>.
                </p>
              </div>
              <div>
                <Label>Target activity %</Label>
                <Input
                  type="number"
                  min="0"
                  max="100"
                  value={activityPct}
                  onChange={(e) => setActivityPct(e.target.value)}
                />
              </div>
              <div>
                <Label>Unpaid break (minutes)</Label>
                <Input
                  type="number"
                  min="0"
                  value={breakMinutes}
                  onChange={(e) => setBreakMinutes(e.target.value)}
                />
                <p className="mt-1.5 text-xs text-muted">Inserted as a real gap, not shaved off the end.</p>
              </div>
            </div>
          </Card>

          <Card className="p-5">
            <h2 className="mb-1 font-heading text-base font-semibold">
              How it should sit next to what they already tracked
            </h2>
            <p className="mb-4 text-sm text-muted">
              This is the setting that matters most — the wrong choice silently doubles a week.
            </p>
            <div className="space-y-2">
              {(
                [
                  [
                    "topUp",
                    "Top up to the target",
                    "Writes only the shortfall, fitted into the gaps around real tracking. Someone who tracked 2h before going on site gets 6h added to reach 8, not 8.",
                  ],
                  [
                    "add",
                    "Add on top",
                    "Writes the full figure regardless of what is already there. For a day the tracker genuinely recorded nothing on.",
                  ],
                  [
                    "replace",
                    "Replace what was entered",
                    "Deletes the manually-entered rows in the period first, then writes the new figures. Captured sessions are left alone unless you say otherwise below.",
                  ],
                ] as [Fill, string, string][]
              ).map(([value, label, hint]) => (
                <label
                  key={value}
                  className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition ${
                    fill === value ? "border-brand bg-brand/5" : "border-border hover:bg-canvas"
                  }`}
                >
                  <input
                    type="radio"
                    name="fill"
                    checked={fill === value}
                    onChange={() => setFill(value)}
                    className="mt-1"
                  />
                  <span className="text-sm">
                    <span className="font-medium">{label}</span>
                    <span className="mt-0.5 block text-xs text-muted">{hint}</span>
                  </span>
                </label>
              ))}
            </div>

            {fill === "replace" && (
              <label className="mt-3 flex cursor-pointer items-start gap-3 rounded-lg border border-[var(--color-negative)]/40 bg-[var(--color-negative)]/5 p-3">
                <input
                  type="checkbox"
                  checked={replaceCaptured}
                  onChange={(e) => setReplaceCaptured(e.target.checked)}
                  className="mt-1"
                />
                <span className="text-sm">
                  <span className="font-medium text-[var(--color-negative)]">
                    Also delete captured tracker sessions
                  </span>
                  <span className="mt-0.5 block text-xs text-muted">
                    Irreversible in effect: it removes real tracked work along with its activity
                    blocks and screenshots. An undo snapshot is taken, but preview first and read the
                    red panel below.
                  </span>
                </span>
              </label>
            )}
          </Card>

          <Card className="p-5">
            <h2 className="mb-4 font-heading text-base font-semibold">Realism</h2>
            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <Label>Activity spread ±%</Label>
                <Input
                  type="number"
                  min="0"
                  max="50"
                  value={activityJitter}
                  onChange={(e) => setActivityJitter(e.target.value)}
                />
                <p className="mt-1.5 text-xs text-muted">0 gives exactly the target, and a flat line.</p>
              </div>
              <div>
                <Label>Day-length variation ±%</Label>
                <Input
                  type="number"
                  min="0"
                  max="50"
                  value={lengthJitterPct}
                  onChange={(e) => setLengthJitterPct(e.target.value)}
                />
                <p className="mt-1.5 text-xs text-muted">
                  Moves hours between days; the total stays exact.
                </p>
              </div>
              <div>
                <Label>Start-time variation ± minutes</Label>
                <Input
                  type="number"
                  min="0"
                  max="180"
                  value={startJitterMinutes}
                  onChange={(e) => setStartJitterMinutes(e.target.value)}
                />
              </div>
            </div>

            <div className="mt-4 space-y-2">
              <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3">
                <input
                  type="checkbox"
                  checked={matchMemberPattern}
                  onChange={(e) => setMatchMemberPattern(e.target.checked)}
                  className="mt-1"
                />
                <span className="text-sm">
                  <span className="font-medium">Match this member&rsquo;s own habits</span>
                  <span className="mt-0.5 block text-xs text-muted">
                    Takes the start time and activity level from their real tracked history, so entered
                    days look like their own. Anything you set explicitly still wins.
                  </span>
                </span>
              </label>

              <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3">
                <input
                  type="checkbox"
                  checked={includeWeekends}
                  onChange={(e) => setIncludeWeekends(e.target.checked)}
                  className="mt-1"
                />
                <span className="text-sm font-medium">Include weekends</span>
              </label>

              <div>
                <Label>Record as</Label>
                <Select
                  value={recordAs}
                  onChange={(v) => setRecordAs(v as "manual" | "tracked")}
                  options={[
                    { value: "manual", label: "Manual entry (recommended)" },
                    { value: "tracked", label: "Ordinary tracked work" },
                  ]}
                />
                <p className="mt-1.5 text-xs text-muted">
                  Manual rows are flagged and stay safely revisable. Tracked rows are
                  indistinguishable from real capture, and the revise and delete tools refuse them.
                </p>
              </div>
            </div>
          </Card>
        </>
      ) : (
        <Card className="p-5">
          <h2 className="mb-4 font-heading text-base font-semibold">Activity</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label>Target activity %</Label>
              <Input
                type="number"
                min="0"
                max="100"
                value={activityPct}
                onChange={(e) => setActivityPct(e.target.value)}
              />
            </div>
            <div>
              <Label>Spread ±%</Label>
              <Input
                type="number"
                min="0"
                max="50"
                value={activityJitter}
                onChange={(e) => setActivityJitter(e.target.value)}
              />
            </div>
          </div>
          <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3">
            <input
              type="checkbox"
              checked={includeCaptured}
              onChange={(e) => setIncludeCaptured(e.target.checked)}
              className="mt-1"
            />
            <span className="text-sm">
              <span className="font-medium">Include captured tracker sessions</span>
              <span className="mt-0.5 block text-xs text-muted">
                Their blocks are rewritten in place, so every screenshot survives. Without this only
                manually-entered sessions change, and a week that is mostly real tracking will barely
                move.
              </span>
            </span>
          </label>
          <p className="mt-3 text-xs text-muted">
            Hours are never touched by this tab.
          </p>
        </Card>
      )}

      {tab === "hours" && (
        <Card className="p-5">
          <Label>Reason (recorded on every row)</Label>
          <Input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Offsite record from paper timesheet"
          />
        </Card>
      )}

      <div className="flex flex-wrap gap-2">
        <Button
          variant="ghost"
          onClick={() => submit(true)}
          disabled={busy || (tab === "hours" ? !ready : !activityReady)}
        >
          {busy ? "Working…" : "Preview"}
        </Button>
        <Button
          variant={fill === "replace" && replaceCaptured ? "danger" : "primary"}
          onClick={() => submit(false)}
          disabled={busy || !plan || (tab === "hours" ? !ready : !activityReady)}
        >
          {tab === "hours" ? "Write it" : "Apply activity"}
        </Button>
        {!plan && (
          <span className="self-center text-xs text-muted">Preview before you can commit.</span>
        )}
      </div>

      {plan && <PlanPreview plan={plan} tab={tab} />}
    </div>
  );
}

/**
 * The dry-run response, rendered so the consequences are readable.
 *
 * The red panel is the point of the whole page: `supersededCaptured` is how many
 * real tracked sessions are about to be deleted, and it must be impossible to
 * commit without having seen it.
 */
function PlanPreview({ plan, tab }: { plan: TimePlanResponse; tab: Tab }) {
  const superseded = plan.supersededSessions ?? [];
  const capturedCount = plan.supersededCaptured ?? 0;

  return (
    <div className="space-y-4">
      <Card className="p-5">
        <div className="mb-3 flex items-center gap-2">
          <h2 className="font-heading text-base font-semibold">
            {plan.written ? "What was written" : "Preview"}
          </h2>
          {plan.dryRun && <Badge tone="accent">Nothing written yet</Badge>}
          {plan.written && <Badge tone="green">Committed</Badge>}
        </div>

        {plan.reason && !plan.days?.length && (
          <p className="text-sm text-muted">{plan.reason}</p>
        )}

        <div className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
          {plan.timezone && (
            <div>
              <span className="text-muted">Timezone</span>{" "}
              <strong className="text-ink">{plan.timezone}</strong>
            </div>
          )}
          {plan.totalSeconds !== undefined && (
            <div>
              <span className="text-muted">Total</span>{" "}
              <strong className="text-ink">{hoursMinutes(plan.totalSeconds)}</strong>
            </div>
          )}
          {plan.alreadyTrackedSeconds !== undefined && (
            <div>
              <span className="text-muted">Already tracked</span>{" "}
              <strong className="text-ink">{hoursMinutes(plan.alreadyTrackedSeconds)}</strong>
            </div>
          )}
          {plan.hoursPerDay !== undefined && (
            <div>
              <span className="text-muted">Per day</span>{" "}
              <strong className="text-ink">{plan.hoursPerDay.toFixed(2)}h</strong>
            </div>
          )}
          {typeof plan.updated === "number" && (
            <div>
              <span className="text-muted">Sessions updated</span>{" "}
              <strong className="text-ink">{plan.updated}</strong>
            </div>
          )}
        </div>

        {plan.pattern && (
          <div className="mt-3 rounded-lg border border-border bg-canvas p-3 text-xs text-muted">
            Defaults taken from their own history — usual start{" "}
            <strong className="text-ink">
              {String(Math.floor(plan.pattern.startMinutes / 60)).padStart(2, "0")}:
              {String(plan.pattern.startMinutes % 60).padStart(2, "0")}
            </strong>
            , usual day <strong className="text-ink">{plan.pattern.hoursPerDay}h</strong>, usual
            activity <strong className="text-ink">{plan.pattern.activityPct}%</strong>, from{" "}
            {plan.pattern.sampleDays} tracked days.
          </div>
        )}

        {plan.days && plan.days.length > 0 && (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-faint">
                  <th className="pb-2 pr-4 font-semibold">Day</th>
                  <th className="pb-2 pr-4 font-semibold">Hours</th>
                  <th className="pb-2 pr-4 font-semibold">From</th>
                  <th className="pb-2 pr-4 font-semibold">To</th>
                  <th className="pb-2 font-semibold">Blocks</th>
                </tr>
              </thead>
              <tbody>
                {plan.days.map((d) => (
                  <tr key={d.sessionId} className="border-b border-border/60 last:border-0">
                    <td className="py-2 pr-4 font-medium">{shortDay(d.dayKey)}</td>
                    <td className="py-2 pr-4 tnum">{hoursMinutes(d.seconds)}</td>
                    <td className="py-2 pr-4 tnum text-muted">
                      {new Date(d.startedAt).toISOString().slice(11, 16)}
                    </td>
                    <td className="py-2 pr-4 tnum text-muted">
                      {new Date(d.endedAt).toISOString().slice(11, 16)}
                    </td>
                    <td className="py-2 tnum text-muted">{d.blocks}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-xs text-muted">Times shown in UTC.</p>
          </div>
        )}

        {plan.sessions && plan.sessions.length > 0 && tab === "activity" && (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-faint">
                  <th className="pb-2 pr-4 font-semibold">Day</th>
                  <th className="pb-2 pr-4 font-semibold">Kind</th>
                  <th className="pb-2 pr-4 font-semibold">Blocks</th>
                  <th className="pb-2 pr-4 font-semibold">Screenshots</th>
                  <th className="pb-2 font-semibold">Method</th>
                </tr>
              </thead>
              <tbody>
                {plan.sessions.map((s) => (
                  <tr key={s.id} className="border-b border-border/60 last:border-0">
                    <td className="py-2 pr-4 font-medium">{s.dayKey}</td>
                    <td className="py-2 pr-4">
                      <Badge tone={s.isManual ? "brand" : "muted"}>
                        {s.isManual ? "manual" : "captured"}
                      </Badge>
                    </td>
                    <td className="py-2 pr-4 tnum text-muted">{s.existingBlocks}</td>
                    <td className="py-2 pr-4 tnum text-muted">{s.screenshots}</td>
                    <td className="py-2 text-xs text-muted">
                      {s.strategy === "rechain-in-place" ? "rewritten in place" : "generated"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-xs text-muted">
              &ldquo;Rewritten in place&rdquo; keeps every screenshot and rebuilds the hash chain.
            </p>
          </div>
        )}

        {plan.skippedDays && plan.skippedDays.length > 0 && (
          <p className="mt-3 text-xs text-muted">
            Skipped (already had time): {plan.skippedDays.join(", ")}
          </p>
        )}

        {plan.snapshotId && (
          <p className="mt-3 text-xs text-muted">
            Undo snapshot <code>{plan.snapshotId}</code> — restore it from the Platform log.
          </p>
        )}
      </Card>

      {superseded.length > 0 && (
        <Card className="border-[var(--color-negative)]/40 bg-[var(--color-negative)]/5 p-5">
          <h3 className="font-heading text-base font-semibold text-[var(--color-negative)]">
            {plan.written ? "Deleted" : "Will be deleted"} — {superseded.length}{" "}
            {superseded.length === 1 ? "session" : "sessions"},{" "}
            {hoursMinutes(plan.supersededSeconds ?? 0)}
          </h3>
          {capturedCount > 0 && (
            <p className="mt-1 text-sm font-medium text-[var(--color-negative)]">
              {capturedCount} of these {capturedCount === 1 ? "is" : "are"} real captured tracker
              work, with screenshots.
            </p>
          )}
          <ul className="mt-3 space-y-1 text-xs">
            {superseded.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-2 text-muted">
                <Badge tone={s.isManual ? "brand" : "red"}>{s.isManual ? "manual" : "captured"}</Badge>
                <span className="tnum">{hoursMinutes(s.seconds)}</span>
                <span className="tnum">{new Date(s.startedAt).toISOString().slice(0, 16)}Z</span>
                <code className="text-[11px]">{s.id}</code>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
