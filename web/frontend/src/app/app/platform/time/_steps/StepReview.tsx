"use client";

import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import { Button, Card, Input, Label } from "@/components/ui";
import { BulkPreview, PlanPreview, type BulkPlanResponse } from "../PlanPreview";
import type { TimePlanResponse } from "@/lib/platform";
import { derive, jitterFor, periodBody, type WizardState } from "./types";

/**
 * Step 4 — see it, then commit it.
 *
 * Preview and write are the same request with `dryRun` flipped, which is what
 * makes the preview trustworthy: it is not a rendering of what the form *would*
 * send, it is the server's own answer, generated from the same seeded plan the
 * write will use.
 *
 * Confirm only appears after a preview has come back. That ordering is the whole
 * safety model for the destructive paths — you cannot reach the button without
 * having been shown the red panel listing what gets deleted.
 */
export function StepReview({
  state,
  update,
  onWritten,
}: {
  state: WizardState;
  update: (patch: Partial<WizardState>) => void;
  onWritten: (result: { message: string; snapshotId?: string | null }) => void;
}) {
  const [plan, setPlan] = useState<TimePlanResponse | null>(null);
  const [bulk, setBulk] = useState<BulkPlanResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { fill, isActivityOnly } = derive(state.intent);
  const jitter = jitterFor(state);

  function request(dryRun: boolean) {
    const period = periodBody(state);
    const reason = state.reason.trim();

    if (state.many) {
      if (isActivityOnly) {
        return {
          url: `/admin/orgs/${state.orgId}/activity/bulk`,
          method: "POST",
          body: {
            userIds: state.userIds,
            ...period,
            activityPct: Number(state.activityPct),
            activityJitter: jitter.activityJitter,
            includeCaptured: state.includeCaptured,
            reason,
            dryRun,
          },
        };
      }
      return {
        url: `/admin/orgs/${state.orgId}/time/bulk`,
        method: "POST",
        body: {
          userIds: state.userIds,
          projectId: state.projectId,
          ...period,
          ...(state.amountKind === "total"
            ? { totalHours: Number(state.hours) }
            : { hoursPerDay: Number(state.hours) }),
          activityPct: Number(state.activityPct),
          ...jitter,
          breakMinutes: Number(state.breakMinutes),
          includeWeekends: state.includeWeekends,
          matchMemberPattern: state.matchMemberPattern,
          fill,
          recordAs: state.recordAsTracked ? "tracked" : "manual",
          reason,
          dryRun,
        },
      };
    }

    if (isActivityOnly) {
      return {
        url: `/admin/users/${state.userId}/activity`,
        method: "PATCH",
        body: {
          ...period,
          activityPct: Number(state.activityPct),
          activityJitter: jitter.activityJitter,
          includeCaptured: state.includeCaptured,
          dryRun,
        },
      };
    }

    return {
      url: "/admin/time",
      method: "POST",
      body: {
        userId: state.userId,
        projectId: state.projectId,
        ...period,
        ...(state.amountKind === "total"
          ? { totalHours: Number(state.hours) }
          : { hoursPerDay: Number(state.hours) }),
        activityPct: Number(state.activityPct),
        ...jitter,
        breakMinutes: Number(state.breakMinutes),
        includeWeekends: state.includeWeekends,
        matchMemberPattern: state.matchMemberPattern,
        fill,
        replaceCaptured: state.replaceCaptured,
        recordAs: state.recordAsTracked ? "tracked" : "manual",
        reason,
        dryRun,
      },
    };
  }

  async function run(dryRun: boolean) {
    setBusy(true);
    setError(null);
    try {
      const { url, method, body } = request(dryRun);
      const res = await api<TimePlanResponse & BulkPlanResponse>(url, {
        method,
        body: JSON.stringify(body),
      });

      if (state.many) {
        setBulk(res);
        if (!dryRun) {
          onWritten({
            message: `Written for ${res.members?.filter((m) => !m.error).length ?? 0} people.`,
            snapshotId: res.snapshotId,
          });
        }
      } else {
        setPlan(res);
        if (!dryRun) {
          onWritten({
            message: res.written === false ? (res.reason ?? "Nothing to write.") : "Written.",
            snapshotId: res.snapshotId,
          });
        }
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  const previewed = plan !== null || bulk !== null;
  const destructive = fill === "replace";

  return (
    <div>
      <h2 className="font-heading text-lg font-semibold">Check it, then write it</h2>
      <p className="mt-1 text-sm text-muted">
        The preview comes from the server and is exactly what will be written.
      </p>

      {error && (
        <Card className="mt-4 border-[var(--color-negative)]/30 bg-[var(--color-negative)]/5 p-4 text-sm text-[var(--color-negative)]">
          {error}
        </Card>
      )}

      <div className="mt-5 max-w-2xl">
        <Label>Why (recorded on every row)</Label>
        <Input
          value={state.reason}
          onChange={(e) => {
            update({ reason: e.target.value });
            // A changed reason invalidates the preview it was generated with.
            setPlan(null);
            setBulk(null);
          }}
          placeholder="Offsite record from a paper timesheet"
        />
      </div>

      {!previewed && (
        <div className="mt-5">
          <Button onClick={() => run(true)} disabled={busy || !state.reason.trim()}>
            {busy ? "Working…" : "Show me what this will do"}
          </Button>
          {!state.reason.trim() && (
            <span className="ml-3 text-xs text-muted">A reason is required.</span>
          )}
        </div>
      )}

      {previewed && (
        <>
          <div className="mt-5">
            {bulk ? <BulkPreview plan={bulk} /> : plan ? <PlanPreview plan={plan} /> : null}
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-3">
            <Button
              variant={destructive ? "danger" : "primary"}
              disabled={busy}
              onClick={() => run(false)}
            >
              {busy ? "Writing…" : destructive ? "Replace it" : "Write it"}
            </Button>
            <Button variant="ghost" disabled={busy} onClick={() => run(true)}>
              Refresh preview
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
