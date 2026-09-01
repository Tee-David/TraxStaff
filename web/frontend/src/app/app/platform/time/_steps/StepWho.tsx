"use client";

import { useState } from "react";
import { Badge, Card, Input, Label } from "@/components/ui";
import { Select } from "@/components/Select";
import { derive, type WizardState } from "./types";

export interface OrgOption {
  id: string;
  name: string;
  status?: string;
}

export interface MemberOption {
  id: string;
  email: string;
  status: string;
  isSuperAdmin: boolean;
}

export interface ProjectOption {
  id: string;
  name: string;
  archivedAt: string | null;
}

/**
 * Step 2 — who is this for.
 *
 * "One person / several people" is the only new decision here, and it is the
 * bulk path: choosing several swaps the single-member endpoint for the org bulk
 * one. Everything downstream is identical, which is why it belongs as a toggle
 * on this step rather than as a separate tool.
 */
export function StepWho({
  state,
  update,
  orgs,
  members,
  projects,
  loading,
}: {
  state: WizardState;
  update: (patch: Partial<WizardState>) => void;
  orgs: OrgOption[];
  members: MemberOption[];
  projects: ProjectOption[];
  loading: boolean;
}) {
  const { needsProject } = derive(state.intent);
  const [memberQuery, setMemberQuery] = useState("");

  // Platform staff are never a target, and only an active account has time worth
  // writing against — the API refuses the rest, so they are not offered.
  const selectable = members.filter((m) => !m.isSuperAdmin && m.status === "active");
  const live = projects.filter((p) => !p.archivedAt);
  const memberNeedle = memberQuery.trim().toLowerCase();
  const shownMembers = memberNeedle
    ? selectable.filter((m) => m.email.toLowerCase().includes(memberNeedle))
    : selectable;

  function toggleMember(id: string) {
    const next = state.userIds.includes(id)
      ? state.userIds.filter((x) => x !== id)
      : [...state.userIds, id];
    update({ userIds: next });
  }

  return (
    <div>
      <h2 className="font-heading text-lg font-semibold">Who is this for?</h2>
      <p className="mt-1 text-sm text-muted">
        Any organization on the platform, not just your own.
      </p>

      <div className="mt-5 space-y-5">
        <div className="max-w-sm">
          <Label>Organization</Label>
          <Select
            searchable
            value={state.orgId}
            onChange={(v) => update({ orgId: v, userId: "", userIds: [], projectId: "" })}
            options={[
              { value: "", label: loading ? "Loading…" : "Choose an organization" },
              ...orgs.map((o) => ({
                value: o.id,
                label: o.status === "suspended" ? `${o.name} (suspended)` : o.name,
              })),
            ]}
          />
        </div>

        {state.orgId && (
          <>
            <div>
              <Label>How many people?</Label>
              <div className="flex flex-wrap gap-2">
                {(
                  [
                    [false, "One person"],
                    [true, "Several people"],
                  ] as [boolean, string][]
                ).map(([many, label]) => (
                  <button
                    key={label}
                    type="button"
                    onClick={() => update({ many, userId: "", userIds: [] })}
                    className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition ${
                      state.many === many
                        ? "border-brand bg-brand/10 text-brand"
                        : "border-border text-muted hover:bg-canvas"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {state.many ? (
              <div>
                <Label>Pick the people</Label>
                <Input
                  value={memberQuery}
                  onChange={(e) => setMemberQuery(e.target.value)}
                  placeholder="Search people…"
                  className="mb-2"
                />
                <Card className="max-h-72 overflow-y-auto p-1">
                  {selectable.length === 0 && (
                    <div className="px-3 py-4 text-sm text-muted">
                      No active members in this organization.
                    </div>
                  )}
                  {shownMembers.length === 0 && selectable.length > 0 && (
                    <div className="px-3 py-4 text-sm text-muted">
                      Nothing matches &ldquo;{memberQuery.trim()}&rdquo;.
                    </div>
                  )}
                  {shownMembers.map((m) => {
                    const on = state.userIds.includes(m.id);
                    return (
                      <label
                        key={m.id}
                        className={`flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm transition ${
                          on ? "bg-brand/5" : "hover:bg-canvas"
                        }`}
                      >
                        <input type="checkbox" checked={on} onChange={() => toggleMember(m.id)} />
                        <span className="min-w-0 flex-1 truncate">{m.email}</span>
                      </label>
                    );
                  })}
                </Card>
                <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
                  <button
                    type="button"
                    onClick={() =>
                      update({
                        // What is on screen, not the whole org — "select all"
                        // under an active filter meaning "all 200 of them" is
                        // how a bulk write goes to the wrong people.
                        userIds: [...new Set([...state.userIds, ...shownMembers.map((m) => m.id)])],
                      })
                    }
                    className="text-brand underline"
                  >
                    {memberNeedle ? "Select these" : "Select all"}
                  </button>
                  <button
                    type="button"
                    onClick={() => update({ userIds: [] })}
                    className="text-muted underline"
                  >
                    Clear
                  </button>
                  <Badge tone={state.userIds.length > 0 ? "brand" : "muted"}>
                    {state.userIds.length} selected
                  </Badge>
                </div>
              </div>
            ) : (
              <div className="max-w-sm">
                <Label>Member</Label>
                <Select
                  searchable
                  value={state.userId}
                  onChange={(v) => update({ userId: v })}
                  options={[
                    { value: "", label: "Choose a member" },
                    ...selectable.map((m) => ({ value: m.id, label: m.email })),
                  ]}
                />
              </div>
            )}

            {needsProject && (
              <div className="max-w-sm">
                <Label>Project</Label>
                <Select
                  searchable
                  value={state.projectId}
                  onChange={(v) => update({ projectId: v })}
                  options={[
                    { value: "", label: "Choose a project" },
                    ...live.map((p) => ({ value: p.id, label: p.name })),
                  ]}
                />
                <p className="mt-1.5 text-xs text-muted">
                  The hours are recorded against this project.
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
