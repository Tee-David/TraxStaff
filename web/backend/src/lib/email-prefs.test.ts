/**
 * Tests for per-user email preferences.
 *
 * The failure mode being guarded against is silence: a preference lookup that
 * throws, or falls back to `false`, turns into an approval request nobody is
 * told about — and an entry nobody is told about sits pending forever. So the
 * unreadable cases below matter as much as the happy path.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { effectivePrefs, sanitisePrefs, wantsEmail } from "./email-prefs";

const admin = (emailPrefs: unknown) => ({ role: "admin", emailPrefs });
const member = (emailPrefs: unknown) => ({ role: "member", emailPrefs });

test("defaults apply when nothing has been stored", () => {
  assert.equal(wantsEmail(admin(null), "manual_time_submitted"), true);
  assert.equal(wantsEmail(admin(null), "unusual_activity"), false);
  assert.equal(wantsEmail(member(null), "manual_time_decided"), true);
});

test("a stored choice wins over the default, in both directions", () => {
  assert.equal(wantsEmail(admin({ manual_time_submitted: false }), "manual_time_submitted"), false);
  assert.equal(wantsEmail(admin({ unusual_activity: true }), "unusual_activity"), true);
});

test("one admin muting themselves says nothing about another admin", () => {
  // The whole point of per-user preferences: this is the assertion that stops
  // "quieter for me" from becoming "nobody was told".
  const muted = admin({ manual_time_submitted: false });
  const untouched = admin(null);
  assert.equal(wantsEmail(muted, "manual_time_submitted"), false);
  assert.equal(wantsEmail(untouched, "manual_time_submitted"), true);
});

test("an admin-only email never reaches a member, whatever they stored", () => {
  assert.equal(wantsEmail(member(null), "manual_time_submitted"), false);
  assert.equal(wantsEmail(member({ manual_time_submitted: true }), "manual_time_submitted"), false);
  assert.equal(wantsEmail(member({ unusual_activity: true }), "unusual_activity"), false);
});

test("an unreadable stored value falls back to the default rather than muting", () => {
  for (const junk of ["yes", 1, null, undefined, [], { nested: true }]) {
    assert.equal(
      wantsEmail(admin({ manual_time_submitted: junk }), "manual_time_submitted"),
      true,
      `expected the default for ${JSON.stringify(junk)}`
    );
  }
  // And a blob that isn't an object at all — a hand-edited row, an older shape.
  assert.equal(wantsEmail(admin("not-an-object"), "manual_time_submitted"), true);
  assert.equal(wantsEmail(admin([1, 2, 3]), "manual_time_submitted"), true);
});

test("the effective set is scoped to what the role can actually receive", () => {
  const forAdmin = effectivePrefs(admin(null));
  assert.deepEqual(Object.keys(forAdmin).sort(), [
    "manual_time_decided",
    "manual_time_submitted",
    "unusual_activity",
  ]);

  const forMember = effectivePrefs(member(null));
  assert.deepEqual(Object.keys(forMember), ["manual_time_decided"]);
});

test("sanitise keeps only known keys with boolean values", () => {
  assert.deepEqual(
    sanitisePrefs({
      manual_time_submitted: false,
      unusual_activity: true,
      not_a_real_type: true,
      manual_time_decided: "true",
    }),
    { manual_time_submitted: false, unusual_activity: true }
  );
});
