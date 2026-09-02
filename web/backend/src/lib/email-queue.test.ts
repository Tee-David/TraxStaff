import test from "node:test";
import assert from "node:assert/strict";
import { MAX_ATTEMPTS, backoffMs, isUndeliverable } from "./email-queue";

/**
 * `enqueue` / `drainQueue` are not covered here on purpose: they talk to the
 * imported Prisma client rather than an injected one, so exercising them needs a
 * live cluster. What is tested is the part that decides behaviour — which
 * addresses are refused outright, and how long a failure waits before being
 * retried — because both are silent when wrong. An address that bounces on every
 * send looks exactly like one that delivers, and a backoff that overflows or
 * collapses to zero turns the retry loop into a mail loop.
 */

test("reserved domains are refused before anything is sent", () => {
  // These can only ever hard-bounce, and a stream of bounces is what drags a
  // sending domain's real mail into spam folders. `admin@trax.test` was a live
  // owner on this deployment, mailed every digest.
  for (const address of [
    "admin@trax.test",
    "someone@ACME.TEST",
    "user@my.host.invalid",
    "dev@localhost",
    "x@printer.local",
    "a@example.com",
    "b@example.org",
  ]) {
    assert.equal(isUndeliverable(address), true, address);
  }
});

test("real addresses are not refused", () => {
  for (const address of [
    "babatope@wendylovemedia.com",
    "info@traxstaff.com",
    "someone@gmail.com",
    // A domain that merely CONTAINS a reserved word is fine — only the last
    // label counts, or every "latest.testing.io" would be dropped.
    "qa@latest.testing.io",
    "ops@test.co.uk",
  ]) {
    assert.equal(isUndeliverable(address), false, address);
  }
});

test("something that is not an address at all is refused", () => {
  assert.equal(isUndeliverable("not-an-email"), true);
  assert.equal(isUndeliverable(""), true);
});

test("backoff grows from a minute and is capped", () => {
  assert.equal(backoffMs(1), 60_000);
  assert.equal(backoffMs(2), 120_000);
  assert.equal(backoffMs(3), 240_000);

  // Capped, not unbounded: the thing being waited out is usually hibernation,
  // and an instance that has just woken should try again within the hour rather
  // than in a day and a half.
  const cap = 6 * 3_600_000;
  assert.equal(backoffMs(MAX_ATTEMPTS), cap);
  assert.equal(backoffMs(99), cap);
});

test("backoff is never zero, so a failure can never spin", () => {
  // attempts is always >= 1 in practice, but 0 and negatives must not produce a
  // zero delay — that would retry a dead relay as fast as the loop allows.
  for (const attempts of [-5, 0, 1]) {
    assert.ok(backoffMs(attempts) >= 60_000, `attempts=${attempts}`);
  }
});

test("the retry schedule spans long enough to outlive a night asleep", () => {
  // The point of the queue: a digest queued at 08:00 on an instance that then
  // hibernates has to still be deliverable when something next wakes it.
  let total = 0;
  for (let attempt = 1; attempt < MAX_ATTEMPTS; attempt++) total += backoffMs(attempt);
  assert.ok(
    total >= 12 * 3_600_000,
    `retries should span at least twelve hours, spanned ${(total / 3_600_000).toFixed(1)}h`
  );
});
