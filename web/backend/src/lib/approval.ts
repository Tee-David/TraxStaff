/**
 * Manual-time approval: the vocabulary, and the one filter every "time that
 * counts" query has to go through.
 *
 * Only MANUAL entries are approvable. A tracked session was witnessed by the
 * tracker — approving it would imply the tracker's own record is in doubt — so
 * `approvalStatus` stays null there and nothing below ever puts one in a queue.
 */

export const APPROVAL_STATUSES = ["pending", "approved", "rejected"] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

/**
 * How a row's stored status reads.
 *
 * Null covers two cases that must both mean "counts, nothing to review": a
 * tracked session, and a manual entry written before approvals existed. The
 * alternative — backfilling every historic manual row to "approved" — would
 * rewrite records the org has already acted on, and this codebase does not
 * rewrite history to make a new feature tidier.
 */
export function effectiveStatus(session: {
  isManual: boolean;
  approvalStatus: string | null;
}): ApprovalStatus {
  if (!session.isManual) return "approved";
  if (session.approvalStatus === "pending") return "pending";
  if (session.approvalStatus === "rejected") return "rejected";
  return "approved";
}

/**
 * Prisma `AND` clause that drops rejected time from a query.
 *
 * Written as an explicit `OR` over null rather than `{ approvalStatus: { not:
 * "rejected" } }` because SQL's three-valued logic makes `col <> 'rejected'`
 * evaluate to NULL — i.e. NOT MATCHED — for every row where the column is null.
 * That is every session predating this feature and every tracked session ever
 * recorded, so the tidy-looking version would have emptied Reports, Insights
 * and the dashboard the moment it shipped.
 *
 * Returned as an array so callers can spread it into an existing `AND`, which
 * is already carrying the overlap-range clauses.
 */
export function excludeRejected() {
  return [{ OR: [{ approvalStatus: null }, { approvalStatus: { not: "rejected" } }] }];
}

/**
 * Who may decide a manual entry: any owner or admin, including on their own.
 *
 * Approval authority is the admin role itself, so an admin entering time —
 * whether for themselves or for someone else — is the authority signing it off,
 * and it lands approved. Only a member's entry ever waits in a queue.
 *
 * An earlier version made an admin's own time wait for a *different* admin.
 * That was dropped deliberately: it left a one-admin workspace unable to ever
 * clear its own queue, and the accountability it was reaching for is better
 * served by the audit trail — every admin-created entry and every decision is
 * recorded in AuditLog with who did it, so self-added hours are visible after
 * the fact rather than blocked before it.
 */
export function canDecide(
  actor: { userId: string; role: string },
  _session: { userId: string | null }
): boolean {
  return actor.role === "owner" || actor.role === "admin";
}
