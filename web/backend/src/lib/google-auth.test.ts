/**
 * Tests for Google ID-token verification.
 *
 * The interesting cases are all refusals: this is the one code path where a
 * browser-supplied string decides which account you get logged into, so a token
 * that is genuinely signed by Google but minted for someone else's app, or for
 * an unverified address, has to be turned away as firmly as a forged one.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { GoogleAuthError, refuseGoogleSignIn, verifyGoogleIdToken } from "./google-auth";

const CLIENT_ID = "123.apps.googleusercontent.com";
const NOW = Date.UTC(2026, 8, 4, 12, 0, 0);
const FUTURE = String(Math.floor(NOW / 1000) + 3600);

function payload(over: Record<string, unknown> = {}) {
  return {
    aud: CLIENT_ID,
    iss: "https://accounts.google.com",
    sub: "10769150350006150715",
    exp: FUTURE,
    email: "ada@example.com",
    email_verified: "true",
    name: "Ada Lovelace",
    ...over,
  };
}

/** Stands in for `fetch`, returning one canned tokeninfo response. */
function fakeFetch(body: unknown, { ok = true }: { ok?: boolean } = {}) {
  const calls: string[] = [];
  const impl = (async (url: string | URL | Request) => {
    calls.push(String(url));
    return { ok, json: async () => body } as Response;
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const verify = (body: unknown, opts: { ok?: boolean } = {}) =>
  verifyGoogleIdToken("cred", { clientId: CLIENT_ID, fetchImpl: fakeFetch(body, opts).impl, now: NOW });

test("accepts a token minted for this app by a verified account", async () => {
  const identity = await verify(payload());
  assert.deepEqual(identity, {
    googleId: "10769150350006150715",
    email: "ada@example.com",
    name: "Ada Lovelace",
  });
});

test("sends the credential to Google rather than trusting it locally", async () => {
  const { impl, calls } = fakeFetch(payload());
  await verifyGoogleIdToken("abc.def/ghi", { clientId: CLIENT_ID, fetchImpl: impl, now: NOW });
  assert.equal(calls.length, 1);
  assert.match(calls[0], /^https:\/\/oauth2\.googleapis\.com\/tokeninfo\?id_token=abc\.def%2Fghi$/);
});

test("refuses a token issued for a different Google client", async () => {
  await assert.rejects(verify(payload({ aud: "999.apps.googleusercontent.com" })), GoogleAuthError);
});

test("refuses an unexpected issuer", async () => {
  await assert.rejects(verify(payload({ iss: "accounts.google.com.evil.test" })), GoogleAuthError);
});

test("accepts both spellings of the Google issuer", async () => {
  const identity = await verify(payload({ iss: "accounts.google.com" }));
  assert.equal(identity.email, "ada@example.com");
});

test("refuses an expired token", async () => {
  await assert.rejects(verify(payload({ exp: String(Math.floor(NOW / 1000) - 1) })), GoogleAuthError);
});

test("refuses a token with no or unparseable expiry", async () => {
  await assert.rejects(verify(payload({ exp: undefined })), GoogleAuthError);
  await assert.rejects(verify(payload({ exp: "soon" })), GoogleAuthError);
});

test("refuses an unverified email address", async () => {
  await assert.rejects(verify(payload({ email_verified: "false" })), GoogleAuthError);
  await assert.rejects(verify(payload({ email_verified: undefined })), GoogleAuthError);
});

test("accepts a boolean email_verified as well as the string form", async () => {
  const identity = await verify(payload({ email_verified: true }));
  assert.equal(identity.email, "ada@example.com");
});

test("refuses a tokeninfo error response", async () => {
  await assert.rejects(verify({ error: "invalid_token" }), GoogleAuthError);
  await assert.rejects(verify(payload(), { ok: false }), GoogleAuthError);
});

test("treats a missing name as no name rather than an empty one", async () => {
  assert.equal((await verify(payload({ name: "   " }))).name, null);
  assert.equal((await verify(payload({ name: undefined }))).name, null);
});

test("surfaces a network failure as a GoogleAuthError, not a raw fetch error", async () => {
  const impl = (async () => {
    throw new TypeError("fetch failed");
  }) as unknown as typeof fetch;
  await assert.rejects(
    verifyGoogleIdToken("cred", { clientId: CLIENT_ID, fetchImpl: impl, now: NOW }),
    GoogleAuthError
  );
});

test("refuses an empty credential without calling Google", async () => {
  const { impl, calls } = fakeFetch(payload());
  await assert.rejects(verifyGoogleIdToken("  ", { clientId: CLIENT_ID, fetchImpl: impl, now: NOW }), GoogleAuthError);
  assert.equal(calls.length, 0);
});

test("only an existing, active account may sign in with Google", () => {
  assert.equal(refuseGoogleSignIn({ status: "active" }, "ada@example.com"), null);
});

test("an address with no account is told so, by name", () => {
  const refusal = refuseGoogleSignIn(null, "ada@example.com");
  assert.match(String(refusal), /No TraxStaff account for ada@example\.com/);
});

test("a pending invite is not accepted on the member's behalf", () => {
  const refusal = refuseGoogleSignIn({ status: "invited" }, "ada@example.com");
  assert.match(String(refusal), /invite waiting/);
});

test("a disabled or removed account is not revived by a Google login", () => {
  for (const status of ["disabled", "removed"]) {
    assert.match(String(refuseGoogleSignIn({ status }, "ada@example.com")), /disabled/);
  }
});
