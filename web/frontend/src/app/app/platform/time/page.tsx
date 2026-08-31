"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError, asArray } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Button, Card, EmptyState, PageHeader } from "@/components/ui";
import { WizardFooter, WizardSteps, type WizardStep } from "@/components/WizardSteps";
import { shortDay, weekStart, addDays } from "@/lib/platform";
import { StepIntent } from "./_steps/StepIntent";
import { StepWho, type MemberOption, type OrgOption, type ProjectOption } from "./_steps/StepWho";
import { StepWhen } from "./_steps/StepWhen";
import { StepFixSession } from "./_steps/StepFixSession";
import { StepReview } from "./_steps/StepReview";
import { INTENTS, derive, initialState, type Intent, type WizardState } from "./_steps/types";

/**
 * Writing hours and activity onto somebody's record — as a wizard.
 *
 * This replaces a single form that showed about nineteen controls at once, all
 * with equal weight, including the one setting that silently doubles a week if
 * it is wrong. The capabilities are unchanged; what changed is that you meet two
 * or three decisions at a time, and the dangerous ones are named in plain
 * language on the first step rather than configured half way down.
 *
 * The steps hold no state of their own. Everything lives here in one object and
 * is passed down with a single `update`, so any step can validate against any
 * other without twenty setters being drilled through.
 */
export default function PlatformTimePage() {
  const { user: me } = useAuth();

  const [state, setState] = useState<WizardState>(initialState);
  const [step, setStep] = useState(0);
  const [furthest, setFurthest] = useState(0);

  const [orgs, setOrgs] = useState<OrgOption[]>([]);
  const [members, setMembers] = useState<MemberOption[]>([]);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ message: string; snapshotId?: string | null } | null>(null);

  const update = useCallback((patch: Partial<WizardState>) => {
    setState((s) => ({ ...s, ...patch }));
  }, []);

  useEffect(() => {
    api<OrgOption[]>("/admin/orgs")
      .then((r) => setOrgs(asArray(r)))
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load organizations"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!state.orgId) {
      setMembers([]);
      setProjects([]);
      return;
    }
    api<{ members: MemberOption[]; projects: ProjectOption[] }>(`/admin/orgs/${state.orgId}`)
      .then((r) => {
        setMembers(asArray(r.members));
        setProjects(asArray(r.projects));
      })
      .catch(() => {
        setMembers([]);
        setProjects([]);
      });
  }, [state.orgId]);

  const { isFixSession, needsProject, needsAmount } = derive(state.intent);

  /* ── what each step needs before you can leave it ───────────────────── */

  const blocked = useMemo<string | null>(() => {
    if (step === 0) return state.intent ? null : "Pick what you want to do.";
    if (step === 1) {
      if (!state.orgId) return "Pick an organization.";
      if (state.many && state.userIds.length === 0) return "Pick at least one person.";
      if (!state.many && !state.userId) return "Pick a member.";
      if (needsProject && !state.projectId) return "Pick a project.";
      return null;
    }
    if (step === 2) {
      if (isFixSession) return null; // this step acts on its own rows
      if (state.mode === "days" && state.picked.length === 0) return "Pick at least one day.";
      if (needsAmount && !(Number(state.hours) > 0)) return "Enter the hours.";
      if (!(Number(state.activityPct) >= 0)) return "Enter an activity percentage.";
      return null;
    }
    return null;
  }, [step, state, isFixSession, needsProject, needsAmount]);

  /* ── the rail ───────────────────────────────────────────────────────── */

  const steps: WizardStep[] = useMemo(() => {
    const chosen = INTENTS.find((i) => i.id === state.intent);
    const who = state.many
      ? `${state.userIds.length} people`
      : members.find((m) => m.id === state.userId)?.email;
    const org = orgs.find((o) => o.id === state.orgId)?.name;

    let when: string | undefined;
    if (state.mode === "day") when = state.date ? shortDay(state.date) : undefined;
    else if (state.mode === "week" && state.date)
      when = `${shortDay(weekStart(state.date))} – ${shortDay(addDays(weekStart(state.date), 6))}`;
    else if (state.mode === "days") when = `${state.picked.length} days`;
    else when = state.from && state.to ? `${shortDay(state.from)} – ${shortDay(state.to)}` : undefined;

    if (when && needsAmount && state.hours) {
      when += ` · ${state.hours}h ${state.amountKind === "total" ? "total" : "/day"}`;
    }

    return [
      { id: "what", label: "What", summary: chosen?.short },
      { id: "who", label: "Who", summary: [org, who].filter(Boolean).join(" · ") || undefined },
      {
        id: "when",
        label: isFixSession ? "Pick the session" : "When & how much",
        summary: isFixSession ? undefined : when,
      },
      { id: "review", label: "Review", summary: undefined },
    ];
  }, [state, orgs, members, isFixSession, needsAmount]);

  // "Fix a session" finishes on its own step; there is no plan to review.
  const lastStep = isFixSession ? 2 : 3;

  function go(next: number) {
    setStep(next);
    setFurthest((f) => Math.max(f, next));
  }

  function restart(keepWho: boolean) {
    const fresh = initialState();
    setState(
      keepWho
        ? { ...fresh, orgId: state.orgId, projectId: state.projectId, intent: state.intent }
        : fresh
    );
    setStep(keepWho ? 1 : 0);
    setFurthest(keepWho ? 1 : 0);
    setDone(null);
    setError(null);
  }

  if (me && !me.isSuperAdmin) {
    return <EmptyState icon="🔒" title="Not available" hint="This area is for platform staff." />;
  }

  /* ── the success screen ─────────────────────────────────────────────── */

  if (done) {
    return (
      <div className="space-y-6">
        <PageHeader title="Time &amp; activity" />
        <Card className="border-[var(--color-positive)]/30 bg-[var(--color-positive)]/5 p-6">
          <h2 className="font-heading text-lg font-semibold text-[var(--color-positive)]">
            {done.message}
          </h2>
          {done.snapshotId && (
            <p className="mt-2 text-sm text-muted">
              This can be undone. The snapshot is listed on the{" "}
              <a href="/app/platform/log" className="text-brand underline">
                platform log
              </a>
              .
            </p>
          )}
          <div className="mt-5 flex flex-wrap gap-2">
            <Button onClick={() => restart(true)}>Do another for this organization</Button>
            <Button variant="ghost" onClick={() => restart(false)}>
              Start over
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Time &amp; activity"
        subtitle="Record hours or set activity for anyone, in any organization."
      />

      {error && (
        <Card className="border-[var(--color-negative)]/30 bg-[var(--color-negative)]/5 p-4 text-sm text-[var(--color-negative)]">
          {error}
        </Card>
      )}

      <div className="flex flex-col gap-6 lg:flex-row lg:gap-8">
        <WizardSteps steps={steps} current={step} furthest={furthest} onSelect={go} />

        <Card className="min-w-0 flex-1 p-5 sm:p-6">
          {step === 0 && (
            <StepIntent
              value={state.intent}
              onChange={(intent: Intent) => {
                // Changing intent changes which later steps apply, so anything
                // already answered downstream is no longer trustworthy.
                update({ intent, replaceCaptured: false, sessionId: "", newEnd: "" });
                setFurthest(1);
                setStep(1);
              }}
            />
          )}

          {step === 1 && (
            <StepWho
              state={state}
              update={update}
              orgs={orgs}
              members={members}
              projects={projects}
              loading={loading}
            />
          )}

          {step === 2 &&
            (isFixSession ? (
              <StepFixSession
                state={state}
                update={update}
                onDone={(message, snapshotId) => setDone({ message, snapshotId })}
                onError={setError}
              />
            ) : (
              <StepWhen state={state} update={update} />
            ))}

          {step === 3 && !isFixSession && (
            <StepReview state={state} update={update} onWritten={setDone} />
          )}

          {/* The review step owns its own buttons — its primary action is not
              "next", it is "write this", and it must not look like navigation. */}
          {step < lastStep && (
            <WizardFooter
              onBack={step > 0 ? () => setStep(step - 1) : undefined}
              onNext={() => go(step + 1)}
              nextDisabled={Boolean(blocked)}
              hint={blocked ?? undefined}
            />
          )}
          {step === lastStep && step > 0 && (
            <WizardFooter onBack={() => setStep(step - 1)} />
          )}
        </Card>
      </div>
    </div>
  );
}
