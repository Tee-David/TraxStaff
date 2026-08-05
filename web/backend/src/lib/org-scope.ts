/**
 * How an org-wide query reaches a TrackingSession once sessions can be orphaned.
 *
 * `TrackingSession` carries no `orgId` of its own — normally it reaches the org
 * through `user.orgId`. But hard-deleting a member sets `userId` to NULL
 * (schema.prisma, `onDelete: SetNull`) so their tracked work survives, and
 * Prisma compiles `user: { orgId }` as an inner join — which would silently drop
 * every orphaned row out of Reports, Screenshots and Insights. Preserving that
 * work is the whole reason the FK is SetNull rather than Cascade, so dropping it
 * at read time would quietly undo the decision.
 *
 * `projectId` is non-nullable and `Project` does carry `orgId`, so the orphan is
 * admitted through its project instead.
 *
 * Lives here rather than in a route module because reports.ts, screenshots.ts
 * and insights.ts all need it, and insights.ts already imports from reports.ts —
 * putting it in either would close an import cycle.
 */
export function orgScoped(orgId: string) {
  return [{ user: { orgId } }, { userId: null, project: { orgId } }];
}

/** Same, one hop deeper — for rows that reach the session by relation. */
export function orgScopedViaSession(orgId: string) {
  return orgScoped(orgId).map((clause) => ({ session: clause }));
}

/** Shown wherever an orphaned row would otherwise render a blank owner. */
export const DELETED_USER_LABEL = "Deleted user";

/** Grouping key for aggregations that bucket by user id. */
export const DELETED_USER_KEY = "__deleted__";
