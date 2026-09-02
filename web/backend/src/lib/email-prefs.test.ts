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
import { effectivePrefs, sanitisePrefs, visibleTypes, wantsEmail } from "./email-prefs";

const admin = (emailPrefs: unknown) => ({ role: "admin", emailPrefs });
const member = (emailPrefs: unknown) => ({ role: "member", emailPrefs });

test("defaults apply when nothing has been stored", () => {
  assert.equal(wantsEmail(admin(null), "manual_time_submitted"), true);
  assert.equal(wantsEmail(admin(null), "daily_shortfall"), true);
  assert.equal(wantsEmail(member(null), "manual_time_decided"), true);
  // On by default here even though the ORG column defaults it off: the org
  // switch is the opt-in, this layer is the personal opt-out. Off at both
  // layers would make an admin enabling it org-wide send to nobody.
  assert.equal(wantsEmail(member(null), "member_weekly_summary"), true);
  assert.equal(wantsEmail(member({ member_weekly_summary: false }), "member_weekly_summary"), false);
});

test("a stored choice wins over the default, in both directions", () => {
  assert.equal(wantsEmail(admin({ manual_time_submitted: false }), "manual_time_submitted"), false);
  assert.equal(wantsEmail(admin({ daily_shortfall: false }), "daily_shortfall"), false);
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
  assert.equal(wantsEmail(member({ daily_shortfall: true }), "daily_shortfall"), false);
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
  assert.deepEqual(Object.keys(effectivePrefs(admin(null))).sort(), [
    "daily_shortfall",
    "manual_time_decided",
    "manual_time_submitted",
    "member_weekly_summary",
    "unusual_activity_digest",
    "weekly_shortfall",
  ]);

  assert.deepEqual(Object.keys(effectivePrefs(member(null))).sort(), [
    "manual_time_decided",
    "member_weekly_summary",
  ]);
});

test("an org switch off marks the type disabled without forgetting the choice", () => {
  const types = visibleTypes({ role: "admin" }, { notifyDailyShortfall: false });
  const daily = types.find((t) => t.type === "daily_shortfall");
  const weekly = types.find((t) => t.type === "weekly_shortfall");
  assert.equal(daily?.orgEnabled, false);
  assert.equal(weekly?.orgEnabled, true);
  // Still listed, so the UI can explain rather than silently drop a row — and
  // the person's own stored preference survives for when it comes back on.
  assert.ok(daily, "a type the org switched off is still offered, marked");
});

test("the org master switch takes every type down with it", () => {
  const types = visibleTypes({ role: "admin" }, { emailsEnabled: false });
  assert.ok(types.length > 0);
  assert.ok(types.every((t) => t.orgEnabled === false));
});

test("manual-time emails have no org switch to be disabled by", () => {
  // They are part of the approval flow: switching them off org-wide would
  // leave entries pending with nobody told, so they answer to the per-person
  // preference alone.
  const types = visibleTypes({ role: "admin" }, { notifyDailyShortfall: false });
  const submitted = types.find((t) => t.type === "manual_time_submitted");
  assert.equal(submitted?.orgFlag, undefined);
  assert.equal(submitted?.orgEnabled, true);
});

test("sanitise keeps only known keys with boolean values", () => {
  assert.deepEqual(
    sanitisePrefs({
      manual_time_submitted: false,
      unusual_activity_digest: true,
      not_a_real_type: true,
      manual_time_decided: "true",
    }),
    { manual_time_submitted: false, unusual_activity_digest: true }
  );
});
