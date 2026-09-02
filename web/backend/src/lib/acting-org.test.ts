import test from "node:test";
import assert from "node:assert/strict";
import {
  ACTING_ORG_HEADER,
  actingOrgAllowed,
  requestedOrgId,
  resolveActingOrg,
  type ActingOrgDeps,
} from "./acting-org";

/**
 * The acting-org header is a cross-tenant read primitive in the hands of anyone
 * who is not a super admin. Every test below exists because the failure it
 * describes would be silent: the API would answer 200 with somebody else's
 * organization in it, and nothing in a log or a UI would say so.
 *
 * If any of these ever go red, the org switcher is a data leak, not a feature.
 */

const SUPER = "11111111-1111-1111-1111-111111111111";
const ORDINARY = "22222222-2222-2222-2222-222222222222";
const OWN_ORG = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const OTHER_ORG = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

function deps(overrides: Partial<ActingOrgDeps> = {}): ActingOrgDeps {
  return {
    isSuperAdmin: async (userId) => userId === SUPER,
    orgExists: async (orgId) => orgId === OTHER_ORG || orgId === OWN_ORG,
    ...overrides,
  };
}

const req = (userId: string, orgId: string, url = "/reports/summary", org = OTHER_ORG) => ({
  url,
  headers: { [ACTING_ORG_HEADER]: org } as Record<string, string | string[] | undefined>,
  userId,
  orgId,
});

/* ─────────────────────────  The security property  ────────────────────────── */

test("a super admin may act on another org", async () => {
  assert.equal(await resolveActingOrg(req(SUPER, OWN_ORG), deps()), OTHER_ORG);
});

test("AN ORDINARY USER SENDING THE HEADER IS IGNORED", async () => {
  // The whole feature hinges on this line. A non-null answer here means any
  // authenticated member can read any organization's reports, screenshots and
  // members by setting one header.
  assert.equal(await resolveActingOrg(req(ORDINARY, OWN_ORG), deps()), null);
});

test("the flag is read from the database, never from the caller", async () => {
  // A token claiming superAdmin is not consulted anywhere in this path — the
  // only input is `userId`, and the only authority is the injected lookup.
  let asked: string | null = null;
  await resolveActingOrg(
    req(ORDINARY, OWN_ORG),
    deps({
      isSuperAdmin: async (userId) => {
        asked = userId;
        return false;
      },
    })
  );
  assert.equal(asked, ORDINARY, "the lookup must be for the caller's own id");
});

test("an org that does not exist is refused", async () => {
  const ghost = "cccccccc-cccc-cccc-cccc-cccccccccccc";
  assert.equal(
    await resolveActingOrg({ ...req(SUPER, OWN_ORG), headers: { [ACTING_ORG_HEADER]: ghost } }, deps()),
    null
  );
});

test("a value that is not a uuid never reaches the database", async () => {
  // The id is interpolated into a uuid cast downstream. Anything shaped wrong
  // must be rejected locally, before either lookup runs.
  let hitDb = false;
  const spy = deps({
    orgExists: async () => {
      hitDb = true;
      return true;
    },
  });

  for (const bad of ["'; DROP TABLE \"User\"; --", "not-a-uuid", "../../etc/passwd", "*", ""]) {
    const result = await resolveActingOrg(
      { ...req(SUPER, OWN_ORG), headers: { [ACTING_ORG_HEADER]: bad } },
      spy
    );
    assert.equal(result, null, bad);
  }
  assert.equal(hitDb, false, "a malformed id must not reach orgExists");
});

/* ───────────────────────────  Excluded paths  ─────────────────────────────── */

test("/auth/* is never rewritten", async () => {
  // /auth/me must report the real identity, or a client cannot tell it is
  // acting on another org — and the sliding renewal would mint a token naming
  // the wrong org, which outlives the header by seven days.
  for (const url of ["/auth/me", "/auth/change-password", "/auth/consent", "/auth/invite"]) {
    assert.equal(await resolveActingOrg(req(SUPER, OWN_ORG, url), deps()), null, url);
  }
});

test("/admin/* is never rewritten", async () => {
  // The platform routes take an explicit orgId. A header that quietly
  // redirected them too would give each one two sources of truth.
  for (const url of ["/admin/orgs", "/admin/users?q=a", "/admin/time"]) {
    assert.equal(await resolveActingOrg(req(SUPER, OWN_ORG, url), deps()), null, url);
  }
});

test("the tracker's own endpoints are never rewritten", async () => {
  // These create rows attributed to the caller. A super admin with the desktop
  // app running must not accrue time in a customer org because a dropdown was
  // left switched.
  const urls = [
    "/sessions/start",
    "/sessions/manual",
    "/sessions/9f1d5e2a-0000-4000-8000-000000000000/stop",
    "/sessions/9f1d5e2a-0000-4000-8000-000000000000/heartbeat",
    "/sync",
    "/sync/blocks",
  ];
  for (const url of urls) {
    assert.equal(await resolveActingOrg(req(SUPER, OWN_ORG, url), deps()), null, url);
  }
});

test("ordinary session reads are still rewritten", async () => {
  // The exclusions must be surgical: listing sessions is exactly the sort of
  // read the switcher exists for, and only the WRITE endpoints are off limits.
  for (const url of ["/sessions", "/sessions?userId=x", "/reports/timesheet", "/screenshots"]) {
    assert.equal(await resolveActingOrg(req(SUPER, OWN_ORG, url), deps()), OTHER_ORG, url);
  }
});

test("actingOrgAllowed ignores the query string", () => {
  assert.equal(actingOrgAllowed("/auth/me?x=1"), false);
  assert.equal(actingOrgAllowed("/reports/summary?from=2026-01-01"), true);
});

test("a path merely containing an excluded word is not excluded", () => {
  // Prefix matching, not substring matching — /projects must not be caught by
  // some future rule about /admin, and /sessions-summary is not /sessions/start.
  assert.equal(actingOrgAllowed("/projects/admin-notes"), true);
  assert.equal(actingOrgAllowed("/sessions/startle"), true);
  assert.equal(actingOrgAllowed("/syncopate"), true);
});

/* ────────────────────────────  Header parsing  ────────────────────────────── */

test("no header means no rewrite", async () => {
  assert.equal(
    await resolveActingOrg({ ...req(SUPER, OWN_ORG), headers: {} }, deps()),
    null
  );
});

test("asking for the org you are already in is a no-op", async () => {
  // Not an error, but not worth two database round trips either.
  let queries = 0;
  const counting = deps({
    isSuperAdmin: async () => {
      queries += 1;
      return true;
    },
  });
  const result = await resolveActingOrg(
    { ...req(SUPER, OWN_ORG), headers: { [ACTING_ORG_HEADER]: OWN_ORG } },
    counting
  );
  assert.equal(result, null);
  assert.equal(queries, 0, "the short-circuit must come before the lookups");
});

test("a duplicated header takes the first value, not the array", () => {
  // Node hands duplicated headers over as an array. Stringifying it would
  // produce 'a,b', which can never match a uuid — a silent permanent refusal.
  assert.equal(requestedOrgId({ [ACTING_ORG_HEADER]: [OTHER_ORG, OWN_ORG] }), OTHER_ORG);
  assert.equal(requestedOrgId({ [ACTING_ORG_HEADER]: OTHER_ORG }), OTHER_ORG);
  assert.equal(requestedOrgId({ [ACTING_ORG_HEADER]: "  " }), null);
  assert.equal(requestedOrgId({}), null);
});
