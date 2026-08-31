"use client";

import { Badge, Card } from "@/components/ui";
import { hoursMinutes, shortDay, type TimePlanResponse } from "@/lib/platform";

/**
 * The dry run, rendered so its consequences are readable.
 *
 * Extracted from the old single-page form unchanged in substance, because it was
 * the one part of that page doing real work. It is now shared by the
 * single-member and bulk review steps rather than duplicated.
 *
 * The red panel is the point: `supersededCaptured` is how many real tracked
 * sessions are about to be deleted, and the wizard is arranged so that Confirm
 * is not reachable without having been shown it.
 */

export interface BulkMemberRow {
  userId: string;
  email: string;
  days: number;
  seconds: number;
  supersededSeconds?: number;
  sessions?: number;
  rechained?: number;
  screenshotsKept?: number;
  error?: string;
}

export interface BulkPlanResponse {
  org?: { id: string; name: string };
  project?: { id: string; name: string };
  range?: { from: string; to: string };
  timezone?: string;
  members?: BulkMemberRow[];
  totalSeconds?: number;
  totalSessions?: number;
  supersededSeconds?: number;
  failed?: number;
  written?: boolean;
  dryRun?: boolean;
  snapshotId?: string | null;
  activityPct?: number;
}

export function PlanPreview({ plan }: { plan: TimePlanResponse }) {
  const superseded = plan.supersededSessions ?? [];
  const capturedCount = plan.supersededCaptured ?? 0;
  // A session with no end is still being tracked right now.
  const openNow = (plan.sessions ?? []).filter((s) => s.endedAt === null).length;

  return (
    <div className="space-y-4">
      <Card className="p-5">
        <div className="mb-3 flex items-center gap-2">
          <h3 className="font-heading text-base font-semibold">
            {plan.written ? "What was written" : "What will be written"}
          </h3>
          {plan.dryRun && <Badge tone="accent">Nothing written yet</Badge>}
          {plan.written && <Badge tone="green">Done</Badge>}
        </div>

        {plan.reason && !plan.days?.length && !plan.sessions?.length && (
          <p className="text-sm text-muted">{plan.reason}</p>
        )}

        <div className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
          {plan.totalSeconds !== undefined && (
            <Figure label="Total" value={hoursMinutes(plan.totalSeconds)} />
          )}
          {plan.alreadyTrackedSeconds !== undefined && (
            <Figure label="Already tracked" value={hoursMinutes(plan.alreadyTrackedSeconds)} />
          )}
          {plan.hoursPerDay !== undefined && (
            <Figure label="Per day" value={`${plan.hoursPerDay.toFixed(2)}h`} />
          )}
          {typeof plan.updated === "number" && (
            <Figure label="Sessions updated" value={String(plan.updated)} />
          )}
          {plan.timezone && <Figure label="Timezone" value={plan.timezone} />}
        </div>

        {plan.pattern && (
          <p className="mt-3 rounded-lg border border-border bg-canvas p-3 text-xs text-muted">
            Shaped from their own history — usual start{" "}
            <strong className="text-ink">
              {String(Math.floor(plan.pattern.startMinutes / 60)).padStart(2, "0")}:
              {String(plan.pattern.startMinutes % 60).padStart(2, "0")}
            </strong>
            , usual day <strong className="text-ink">{plan.pattern.hoursPerDay}h</strong>, usual
            activity <strong className="text-ink">{plan.pattern.activityPct}%</strong>, from{" "}
            {plan.pattern.sampleDays} tracked days.
          </p>
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
                    <td className="py-2 pr-4 tnum text-muted">{d.startedAt.slice(11, 16)}</td>
                    <td className="py-2 pr-4 tnum text-muted">{d.endedAt.slice(11, 16)}</td>
                    <td className="py-2 tnum text-muted">{d.blocks}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-xs text-muted">Times in UTC.</p>
          </div>
        )}

        {plan.sessions && plan.sessions.length > 0 && (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-faint">
                  <th className="pb-2 pr-4 font-semibold">Day</th>
                  <th className="pb-2 pr-4 font-semibold">Kind</th>
                  <th className="pb-2 pr-4 font-semibold">Blocks</th>
                  <th className="pb-2 pr-4 font-semibold">Screenshots</th>
                  <th className="pb-2 font-semibold">How</th>
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

        {openNow > 0 && (
          <p className="mt-3 rounded-lg border border-[var(--color-warning,#b45309)]/40 bg-amber-500/10 p-3 text-xs text-muted">
            <strong className="text-ink">
              {openNow} session{openNow === 1 ? " is" : "s are"} still being tracked right now.
            </strong>{" "}
            The change applies immediately, but the tracker keeps adding blocks at whatever it
            actually measures, so the figure will drift back down as the session continues. Set it
            again once they have stopped if you need it to stick.
          </p>
        )}

        {plan.straddling !== undefined && plan.straddling > 0 && (
          <p className="mt-3 rounded-lg border border-border bg-canvas p-3 text-xs text-muted">
            {plan.straddling} block{plan.straddling === 1 ? "" : "s"} lie partly outside this period.
            A block records one percentage for its whole span, so each follows whichever day holds
            most of it — which can move an adjacent day&rsquo;s average by a fraction.
          </p>
        )}

        {plan.skippedDays && plan.skippedDays.length > 0 && (
          <p className="mt-3 text-xs text-muted">
            Already had time, so skipped: {plan.skippedDays.join(", ")}
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
                <Badge tone={s.isManual ? "brand" : "red"}>
                  {s.isManual ? "manual" : "captured"}
                </Badge>
                <span className="tnum">{hoursMinutes(s.seconds)}</span>
                <span className="tnum">{s.startedAt.slice(0, 16)}Z</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

/** The same dry run, for a whole team. */
export function BulkPreview({ plan }: { plan: BulkPlanResponse }) {
  const rows = plan.members ?? [];
  const failed = rows.filter((r) => r.error);
  const isActivity = plan.activityPct !== undefined && plan.totalSessions !== undefined;

  return (
    <Card className="p-5">
      <div className="mb-3 flex items-center gap-2">
        <h3 className="font-heading text-base font-semibold">
          {plan.written ? "What was written" : "What will be written"}
        </h3>
        {plan.dryRun && <Badge tone="accent">Nothing written yet</Badge>}
        {plan.written && <Badge tone="green">Done</Badge>}
      </div>

      <div className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
        <Figure label="People" value={String(rows.length)} />
        {isActivity ? (
          <Figure label="Sessions" value={String(plan.totalSessions ?? 0)} />
        ) : (
          <Figure label="Total hours" value={hoursMinutes(plan.totalSeconds ?? 0)} />
        )}
        {plan.supersededSeconds ? (
          <Figure label="Replacing" value={hoursMinutes(plan.supersededSeconds)} />
        ) : null}
        {plan.timezone && <Figure label="Timezone" value={plan.timezone} />}
      </div>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-faint">
              <th className="pb-2 pr-4 font-semibold">Person</th>
              {isActivity ? (
                <>
                  <th className="pb-2 pr-4 font-semibold">Sessions</th>
                  <th className="pb-2 font-semibold">Screenshots kept</th>
                </>
              ) : (
                <>
                  <th className="pb-2 pr-4 font-semibold">Days</th>
                  <th className="pb-2 font-semibold">Hours</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.userId} className="border-b border-border/60 last:border-0">
                <td className="py-2 pr-4">
                  <span className="font-medium">{r.email}</span>
                  {r.error && (
                    <span className="mt-0.5 block text-xs text-[var(--color-negative)]">
                      {r.error}
                    </span>
                  )}
                </td>
                {isActivity ? (
                  <>
                    <td className="py-2 pr-4 tnum text-muted">{r.sessions ?? 0}</td>
                    <td className="py-2 tnum text-muted">{r.screenshotsKept ?? 0}</td>
                  </>
                ) : (
                  <>
                    <td className="py-2 pr-4 tnum text-muted">{r.days}</td>
                    <td className="py-2 tnum">{hoursMinutes(r.seconds)}</td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {failed.length > 0 && (
        <p className="mt-3 text-xs text-[var(--color-negative)]">
          {failed.length} could not be planned and {plan.written ? "were" : "will be"} skipped. The
          rest are unaffected.
        </p>
      )}
    </Card>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="text-muted">{label}</span> <strong className="text-ink">{value}</strong>
    </div>
  );
}
