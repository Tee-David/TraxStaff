/**
 * Tests for the manual-time approval rules.
 *
 * Two things here decide whether hours count and whether someone can make them
 * count, and both fail quietly. A wrong `effectiveStatus` silently pays for
 * rejected time; a wrong `canDecide` lets a role sign off its own hours, which
 * is the exact hole the approval flow exists to close. Neither shows up as an
 * error anywhere — they show up as money.
 *
 * `excludeRejected` is asserted structurally: it exists to avoid SQL's
 * three-valued logic (`col <> 'x'` is NULL, i.e. not matched, when col is
 * NULL), and the shape of the clause IS the fix.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { canDecide, effectiveStatus, excludeRejected } from "./approval";

test("a tracked session never needs approving", () => {
  assert.equal(effectiveStatus({ isManual: false, approvalStatus: null }), "approved");
  // Even if a status somehow got written to a tracked row, it isn't approvable.
  assert.equal(effectiveStatus({ isManual: false, approvalStatus: "pending" }), "approved");
});

test("a manual entry reads back the status it was given", () => {
  assert.equal(effectiveStatus({ isManual: true, approvalStatus: "pending" }), "pending");
  assert.equal(effectiveStatus({ isManual: true, approvalStatus: "approved" }), "approved");
  assert.equal(effectiveStatus({ isManual: true, approvalStatus: "rejected" }), "rejected");
});

test("a manual entry predating approvals counts, rather than blocking on a queue", () => {
  // The rows that existed before this feature have no status. Reading them as
  // "pending" would drop historic hours out of every report the morning this
  // shipped and fill the queue with years of entries nobody can meaningfully
  // review.
  assert.equal(effectiveStatus({ isManual: true, approvalStatus: null }), "approved");
});

test("excludeRejected admits nulls explicitly, not via NOT", () => {
  const [clause] = excludeRejected();
  // The null branch has to be there in its own right: `{ not: "rejected" }`
  // alone compiles to `approvalStatus <> 'rejected'`, which is NULL — and so
  // not matched — for every tracked session and every pre-feature row.
  assert.deepEqual(clause, {
    OR: [{ approvalStatus: null }, { approvalStatus: { not: "rejected" } }],
  });
});

test("an admin decides any entry, including their own", () => {
  // Approval authority is the role. An admin queueing behind their own
  // colleagues bought nothing — a one-admin workspace could never clear its
  // queue — and accountability for self-added hours lives in the audit trail
  // (`manual_time.self_added`) rather than in a block.
  const admin = { userId: "admin-1", role: "admin" };
  assert.equal(canDecide(admin, { userId: "member-1" }), true);
  assert.equal(canDecide(admin, { userId: "admin-1" }), true);
});

test("the owner decides anything too", () => {
  const owner = { userId: "owner-1", role: "owner" };
  assert.equal(canDecide(owner, { userId: "owner-1" }), true);
  assert.equal(canDecide(owner, { userId: "member-1" }), true);
});

test("a member decides nothing, including their own entry", () => {
  const member = { userId: "member-1", role: "member" };
  assert.equal(canDecide(member, { userId: "member-1" }), false);
  assert.equal(canDecide(member, { userId: "member-2" }), false);
});

test("an orphaned entry is still decidable", () => {
  // userId null means the member was hard-deleted after filing the entry. The
  // hours are still on the books and still need a decision.
  assert.equal(canDecide({ userId: "admin-1", role: "admin" }, { userId: null }), true);
});
