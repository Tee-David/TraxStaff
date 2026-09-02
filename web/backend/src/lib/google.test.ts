import { strict as assert } from "node:assert";
import { test } from "node:test";
import { resolveGoogleSignIn } from "./google";

const active = { status: "active" as const, isSuperAdmin: false, orgStatus: "active" };

test("an active member of an active org signs in", () => {
  assert.deepEqual(resolveGoogleSignIn({ user: active, hasLiveInvite: false }), { kind: "sign-in" });
});

test("an address with no account is turned away, never given a new org", () => {
  assert.deepEqual(resolveGoogleSignIn({ user: null, hasLiveInvite: false }), { kind: "no-account" });
  // Even a live invite cannot conjure an account — the invite path always has a
  // pre-created `invited` row (POST /auth/invite upserts one).
  assert.deepEqual(resolveGoogleSignIn({ user: null, hasLiveInvite: true }), { kind: "no-account" });
});

test("an invited member completes their invite with Google", () => {
  assert.deepEqual(
    resolveGoogleSignIn({ user: { ...active, status: "invited" }, hasLiveInvite: true }),
    { kind: "accept-invite" }
  );
});

test("an invited member whose invite has lapsed does not get in", () => {
  // The whole point of the invite TTL: a stale link in a breached inbox stops
  // working. Google sign-in must not be a way around it.
  assert.deepEqual(
    resolveGoogleSignIn({ user: { ...active, status: "invited" }, hasLiveInvite: false }),
    { kind: "no-account" }
  );
});

test("a disabled member is refused, and indistinguishably from an unknown one", () => {
  assert.deepEqual(
    resolveGoogleSignIn({ user: { ...active, status: "disabled" }, hasLiveInvite: true }),
    { kind: "no-account" }
  );
});

test("a suspended workspace blocks its members but not platform staff", () => {
  assert.deepEqual(
    resolveGoogleSignIn({ user: { ...active, orgStatus: "suspended" }, hasLiveInvite: false }),
    { kind: "suspended" }
  );
  assert.deepEqual(
    resolveGoogleSignIn({
      user: { ...active, orgStatus: "suspended", isSuperAdmin: true },
      hasLiveInvite: false,
    }),
    { kind: "sign-in" }
  );
});
