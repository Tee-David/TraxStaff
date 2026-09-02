import type { FastifyInstance } from "fastify";
import type { Role } from "@prisma/client";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { hashPassword, verifyPassword } from "../lib/password";
import { sendInviteEmail, sendPasswordResetEmail } from "../lib/mailer";
import { auditLog } from "../lib/audit";
import { env } from "../env";
import {
  EMAIL_TYPES,
  effectivePrefs,
  sanitisePrefs,
  visibleTypes,
} from "../lib/email-prefs";
import { googleAuthConfigured, resolveGoogleSignIn, verifyGoogleIdToken } from "../lib/google";

// Tokens must expire. Without a TTL a copied token stays valid forever, and
// disabling a member has no effect on any session they already hold.
const TOKEN_TTL = "7d";
const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * How much life a token has left before GET /auth/me hands back a fresh one.
 *
 * A hard 7-day expiry with no renewal logged people out mid-week. The desktop
 * app lives in the tray and treats "I have a token" as "I am signed in", so an
 * expired one left it stuck showing a bare "Unauthorized" and an empty project
 * list, with no prompt to sign in again — the bug this constant exists to end.
 *
 * This does NOT weaken why tokens expire. Renewal is reachable only from
 * /auth/me and only *below* its status check, so a disabled or removed member
 * is refused and their token simply runs out. A client that stops calling in
 * still expires on the original 7-day clock. If anything it tightens things:
 * today's token is unrevokable for its full life no matter what happens to the
 * account, whereas a renewing client re-checks its standing every time.
 */
const TOKEN_RENEW_AFTER_MS = TOKEN_TTL_MS / 2;

/**
 * Whether a verified token is far enough through its life to be replaced.
 *
 * `exp` is the standard JWT claim, in SECONDS. A token with no `exp` is never
 * renewed — we can't tell how much life it has, and minting a fresh 7-day token
 * off an unbounded one would be the one way this could genuinely weaken expiry.
 */
export function shouldRenewToken(exp: number | undefined, now: number = Date.now()): boolean {
  if (exp == null || !Number.isFinite(exp)) return false;
  return exp * 1000 - now < TOKEN_RENEW_AFTER_MS;
}

/**
 * The one place a token's claims are assembled.
 *
 * There are five sign sites (register, login, accept-invite, reset-password and
 * the sliding renewal in /auth/me), and `superAdmin` had to reach all of them —
 * a claim that four out of five tokens carry is worse than one no token carries,
 * because the staff console would then work or not depending on how the person
 * last signed in.
 *
 * `superAdmin` is a convenience for clients only. Nothing is authorised by it:
 * `requireSuperAdmin` re-reads the flag from the database on every /admin call.
 */
function claimsFor(user: { id: string; orgId: string; role: Role; isSuperAdmin?: boolean }) {
  return {
    userId: user.id,
    orgId: user.orgId,
    role: user.role,
    ...(user.isSuperAdmin ? { superAdmin: true } : {}),
  };
}

const registerSchema = z.object({
  orgName: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const googleSchema = z.object({
  // The ID token Google Identity Services hands the browser. Named
  // `credential` because that is what GIS calls it in its callback payload.
  credential: z.string().min(1),
});

const inviteSchema = z.object({
  email: z.string().email(),
  role: z.enum(["admin", "member"]),
});

const acceptInviteSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(8),
});

const consentSchema = z.object({
  version: z.number().int().min(1),
});

const forgotPasswordSchema = z.object({
  email: z.string().email(),
});

const resetPasswordSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(8),
});

/**
 * A sparse patch of known toggles. Unknown keys are rejected outright rather
 * than dropped: a client sending a type this server has never heard of is a
 * version mismatch, and quietly returning 200 for a preference that was never
 * stored is the kind of success the user only discovers from an inbox.
 */
const emailPrefsSchema = z
  .object(Object.fromEntries(EMAIL_TYPES.map((t) => [t, z.boolean().optional()])))
  .strict();

const updateMeSchema = z.object({
  name: z.string().trim().min(1).max(120),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8),
});

// Short — a reset link is a bearer credential for the account.
const RESET_TTL_MS = 60 * 60 * 1000;

/**
 * How long an invite stays usable. 24 hours, down from a week: an invite link is
 * a bearer credential that creates an active account in the org, and a week is a
 * long time for one to sit in an inbox that might be forwarded or breached.
 *
 * Expiry is not a dead end — re-inviting the same address issues a fresh token
 * (see the resend path in POST /auth/invite), and the pending row in /members
 * carries `expiresAt` so the UI can say which invites have lapsed.
 */
const INVITE_TTL_MS = 24 * 60 * 60 * 1000;

export default async function authRoutes(fastify: FastifyInstance) {
  // Register a brand-new organization + its owner account.
  fastify.post("/auth/register", async (req, reply) => {
    const body = registerSchema.parse(req.body);

    const existing = await prisma.user.findUnique({ where: { email: body.email } });
    if (existing) {
      return reply.code(409).send({ error: "Email already in use" });
    }

    const org = await prisma.organization.create({ data: { name: body.orgName } });
    const passwordHash = await hashPassword(body.password);
    const user = await prisma.user.create({
      data: {
        orgId: org.id,
        email: body.email,
        passwordHash,
        role: "owner",
        status: "active",
      },
    });

    const token = fastify.jwt.sign(claimsFor(user), { expiresIn: TOKEN_TTL });
    return reply.code(201).send({ token, user: { id: user.id, email: user.email, role: user.role } });
  });

  fastify.post("/auth/login", async (req, reply) => {
    const body = loginSchema.parse(req.body);

    const user = await prisma.user.findUnique({
      where: { email: body.email },
      include: { org: { select: { status: true } } },
    });
    if (!user || !user.passwordHash || user.status !== "active") {
      return reply.code(401).send({ error: "Invalid credentials" });
    }
    const valid = await verifyPassword(body.password, user.passwordHash);
    if (!valid) {
      return reply.code(401).send({ error: "Invalid credentials" });
    }

    // Suspension is checked only AFTER the password has been proved correct.
    //
    // The first version of this sat above `verifyPassword`, which turned the
    // login route into an oracle: anyone could type any address with any junk
    // password and learn from the 403 that the workspace existed and was
    // frozen. Distinguishing "suspended" from "wrong credentials" is only safe
    // once we know we are talking to the account holder — and it is worth doing
    // then, because "invalid credentials" would send them round a password
    // reset that cannot possibly help.
    if (user.org.status === "suspended" && !user.isSuperAdmin) {
      return reply.code(403).send({
        error: "This workspace is suspended. Contact your administrator.",
        code: "org_suspended",
      });
    }

    const token = fastify.jwt.sign(claimsFor(user), { expiresIn: TOKEN_TTL });
    return reply.send({
      token,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        isSuperAdmin: user.isSuperAdmin ?? false,
      },
    });
  });

  /**
   * Sign in with Google.
   *
   * Takes the ID token Google Identity Services produced in the browser and, if
   * it verifies, hands back exactly the same `{ token, user }` payload as
   * POST /auth/login. Everything downstream — the cookie, the sliding renewal,
   * role checks — is then identical to a password login, because it *is* one.
   *
   * This route never creates an organization. Trax has no self-serve signup on
   * the web; you are invited into an org or you have no account. So a verified
   * Google address that nobody has invited is turned away rather than handed a
   * fresh workspace. See resolveGoogleSignIn for the full rule, including the
   * one case where this route does write: an invited member completing their
   * invite with Google instead of setting a password.
   */
  fastify.post("/auth/google", async (req, reply) => {
    const body = googleSchema.parse(req.body);

    if (!googleAuthConfigured) {
      // 503, not 400: nothing is wrong with the request. The server has simply
      // not been given GOOGLE_CLIENT_ID, and the caller can do nothing about it.
      return reply.code(503).send({ error: "Google sign-in is not configured on this server" });
    }

    const identity = await verifyGoogleIdToken(body.credential);
    if (!identity) {
      return reply.code(401).send({ error: "Google sign-in failed. Try again, or use your password." });
    }
    // An unverified address proves nothing: it is a string somebody typed into a
    // Google account, and honouring it would let anyone claim any colleague's
    // mailbox. Consumer Google accounts are verified; this mainly catches
    // hand-made Workspace aliases.
    if (!identity.emailVerified) {
      return reply.code(401).send({ error: "That Google account has no verified email address." });
    }

    // Case-insensitive, because addresses were stored however they were typed
    // into the invite form and Google always reports its own lowercased.
    //
    // The second comparison is not redundant. Prisma compiles an `insensitive`
    // match to ILIKE, in which `_` and `%` are WILDCARDS — and both are legal in
    // an email local part, so `a_b@x.com` would otherwise also match a row for
    // `axb@x.com` and sign the wrong person in. The database query stays a broad
    // filter; this is the exact match.
    const candidate = await prisma.user.findFirst({
      where: { email: { equals: identity.email, mode: "insensitive" } },
      include: { org: { select: { status: true } } },
    });
    const user = candidate && candidate.email.toLowerCase() === identity.email ? candidate : null;

    // Scoped by the row's own stored address rather than by another
    // case-insensitive match, so the wildcard problem above cannot reach the
    // invite table either: invites are written with the same string the User row
    // carries (POST /auth/invite upserts both from one value).
    const liveInvite =
      user?.status === "invited"
        ? await prisma.inviteToken.findFirst({
            where: { email: user.email, acceptedAt: null, expiresAt: { gt: new Date() } },
            orderBy: { expiresAt: "desc" },
          })
        : null;

    const verdict = resolveGoogleSignIn({
      user: user ? { status: user.status, isSuperAdmin: user.isSuperAdmin ?? false, orgStatus: user.org.status } : null,
      hasLiveInvite: Boolean(liveInvite),
    });

    if (verdict.kind === "no-account") {
      // Deliberately one message for "never invited", "invite lapsed" and
      // "account disabled". The login screen is unauthenticated, so telling
      // them apart would let anyone with a Google account probe which
      // colleagues have Trax accounts and which of those are still enabled.
      return reply.code(401).send({
        error: "No active TraxStaff account uses that Google address. Ask your admin for an invite.",
      });
    }
    if (verdict.kind === "suspended") {
      return reply.code(403).send({
        error: "This workspace is suspended. Contact your administrator.",
        code: "org_suspended",
      });
    }

    // `user` is non-null for both remaining verdicts — resolveGoogleSignIn only
    // returns them when a row was found.
    let account = user!;

    if (verdict.kind === "accept-invite") {
      account = await prisma.$transaction(async (tx) => {
        const activated = await tx.user.update({
          where: { id: account.id },
          data: {
            status: "active",
            // Only fill a name we do not already have — an admin who typed a
            // preferred name for this member should keep it.
            ...(account.name ? {} : identity.name ? { name: identity.name } : {}),
          },
          include: { org: { select: { status: true } } },
        });
        // Burn every outstanding invite for this address, not just the one we
        // matched, so a second link sitting in the inbox cannot be replayed —
        // the same rule POST /auth/reset-password applies to reset links.
        await tx.inviteToken.updateMany({
          where: { email: account.email, acceptedAt: null },
          data: { acceptedAt: new Date() },
        });
        return activated;
      });
      // Not audited, deliberately: accepting an invite through the emailed link
      // is not audited either (the `member.invited` entry is the record), and an
      // action that appears in the trail only when it happened to be done with
      // Google would read as two different events.
    }

    // Note there is no passwordHash check anywhere above. A member who has only
    // ever signed in with Google has none, and requiring one would lock out the
    // exact people this route exists for. The password login route keeps its own
    // `!user.passwordHash` guard, so a passwordless account still cannot be
    // signed into with an empty password.
    const token = fastify.jwt.sign(claimsFor(account), { expiresIn: TOKEN_TTL });
    return reply.send({
      token,
      user: {
        id: account.id,
        email: account.email,
        role: account.role,
        isSuperAdmin: account.isSuperAdmin ?? false,
      },
    });
  });

  // Admin/owner invites a new member by email.
  fastify.post(
    "/auth/invite",
    { preHandler: [fastify.authenticate, fastify.requireRole(["owner", "admin"])] },
    async (req, reply) => {
      const body = inviteSchema.parse(req.body);

      const existing = await prisma.user.findUnique({ where: { email: body.email } });
      // A still-pending invitee may be re-invited — that is the resend path, and
      // 409ing it made "resend" fail for exactly the people it exists for. Only
      // an account someone actually holds is a conflict.
      if (existing && existing.status !== "invited") {
        return reply.code(409).send({ error: "Email already in use" });
      }
      if (existing && existing.orgId !== req.user.orgId) {
        return reply.code(409).send({ error: "Email already in use" });
      }

      const org = await prisma.organization.findUniqueOrThrow({ where: { id: req.user.orgId } });
      const token = randomBytes(32).toString("hex");
      const expiresAt = new Date(Date.now() + INVITE_TTL_MS);

      await prisma.$transaction(async (tx) => {
        // The invitee is a member of the team from the moment they are invited —
        // they just have not accepted yet. Without this row /members has nothing
        // to list, so an admin saw "invite sent" and then an unchanged table,
        // with no way to tell whether it worked. `invited` is already the schema
        // default for UserStatus, and login rejects any status but `active`.
        await tx.user.upsert({
          where: { email: body.email },
          create: { orgId: org.id, email: body.email, role: body.role, status: "invited" },
          update: { role: body.role },
        });
        // Resending supersedes: any earlier unaccepted token for this address is
        // expired on the spot rather than left live alongside the new one.
        // Otherwise every resend widens the window instead of moving it, and an
        // older link that leaked stays usable for its full TTL.
        await tx.inviteToken.updateMany({
          where: { orgId: org.id, email: body.email, acceptedAt: null, expiresAt: { gt: new Date() } },
          data: { expiresAt: new Date() },
        });
        await tx.inviteToken.create({
          data: { orgId: org.id, email: body.email, role: body.role, token, expiresAt },
        });
      });

      const inviteUrl = `${env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/accept-invite?token=${token}`;
      const emailed = await sendInviteEmail(body.email, inviteUrl, org.name);

      await auditLog({
        orgId: req.user.orgId,
        actorId: req.user.userId,
        action: "member.invited",
        targetLabel: body.email,
        details: { role: body.role, emailed },
      });

      // The token is already valid whether or not the mail got out, so this stays
      // a 201 — but the admin has to be told when nothing was delivered, or they
      // sit waiting on an invite that will never arrive. `inviteUrl` comes back
      // only in that case, so it can be passed along by hand.
      return reply.code(201).send({ ok: true, emailed, ...(emailed ? {} : { inviteUrl }) });
    }
  );

  // New member accepts their invite and sets a password.
  fastify.post("/auth/accept-invite", async (req, reply) => {
    const body = acceptInviteSchema.parse(req.body);

    const invite = await prisma.inviteToken.findUnique({ where: { token: body.token } });
    if (!invite || invite.acceptedAt || invite.expiresAt < new Date()) {
      return reply.code(400).send({ error: "Invalid or expired invite" });
    }

    const passwordHash = await hashPassword(body.password);

    const user = await prisma.$transaction(async (tx) => {
      const created = await tx.user.upsert({
        where: { email: invite.email },
        create: {
          orgId: invite.orgId,
          email: invite.email,
          passwordHash,
          role: invite.role,
          status: "active",
        },
        update: { passwordHash, status: "active" },
      });
      await tx.inviteToken.update({
        where: { id: invite.id },
        data: { acceptedAt: new Date() },
      });
      return created;
    });

    const token = fastify.jwt.sign(claimsFor(user), { expiresIn: TOKEN_TTL });
    return reply.send({ token, user: { id: user.id, email: user.email, role: user.role } });
  });

  // Request a reset link. Always replies 200 — a different response for unknown
  // emails would turn this into an account-enumeration oracle.
  fastify.post("/auth/forgot-password", async (req, reply) => {
    const body = forgotPasswordSchema.parse(req.body);

    const user = await prisma.user.findUnique({ where: { email: body.email } });
    if (user && user.status === "active") {
      const token = randomBytes(32).toString("hex");
      await prisma.passwordResetToken.create({
        data: { userId: user.id, token, expiresAt: new Date(Date.now() + RESET_TTL_MS) },
      });

      const resetUrl = `${env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/reset-password?token=${token}`;
      await sendPasswordResetEmail(user.email, resetUrl);
    }

    return reply.send({ ok: true });
  });

  fastify.post("/auth/reset-password", async (req, reply) => {
    const body = resetPasswordSchema.parse(req.body);

    const reset = await prisma.passwordResetToken.findUnique({
      where: { token: body.token },
      include: { user: true },
    });
    if (!reset || reset.usedAt || reset.expiresAt < new Date()) {
      return reply.code(400).send({ error: "Invalid or expired reset link" });
    }
    if (reset.user.status !== "active") {
      return reply.code(400).send({ error: "Invalid or expired reset link" });
    }

    const passwordHash = await hashPassword(body.password);

    await prisma.$transaction([
      prisma.user.update({ where: { id: reset.userId }, data: { passwordHash } }),
      // Burn every outstanding link for this user, not just the one used, so an
      // older link sitting in an inbox can't reset the password a second time.
      prisma.passwordResetToken.updateMany({
        where: { userId: reset.userId, usedAt: null },
        data: { usedAt: new Date() },
      }),
    ]);

    const token = fastify.jwt.sign(claimsFor(reset.user), { expiresIn: TOKEN_TTL });
    return reply.send({
      token,
      user: { id: reset.user.id, email: reset.user.email, role: reset.user.role },
    });
  });

  fastify.get("/auth/me", { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: req.user.userId },
      include: {
        org: { select: { dailyTargetMinutes: true, weeklyTargetMinutes: true, status: true } },
      },
    });
    // A disabled or removed member must lose access immediately, not when
    // their token eventually expires. Checked here because every client calls
    // /auth/me to establish a session.
    if (user.status !== "active") {
      return reply.code(401).send({ error: "Account disabled" });
    }
    // Suspension has to bite here too, not only at login: every client calls
    // /auth/me to establish a session, and a token minted before the suspension
    // is otherwise good for the rest of its seven days. Super admins are exempt
    // — someone has to be able to un-suspend it.
    if (user.org.status === "suspended" && !user.isSuperAdmin) {
      return reply.code(403).send({
        error: "This workspace is suspended. Contact your administrator.",
        code: "org_suspended",
      });
    }

    // Sliding renewal — see TOKEN_RENEW_AFTER_MS. Signed from the database row
    // rather than the presented payload, so a role change takes effect on the
    // next renewal instead of staying frozen for the rest of the token's life.
    // Returned only when there's actually a new token, so clients don't rewrite
    // their stored credential on every poll; clients that don't know the field
    // ignore it and keep working.
    const renewedToken = shouldRenewToken(req.user.exp)
      ? fastify.jwt.sign(claimsFor(user), { expiresIn: TOKEN_TTL })
      : null;

    return reply.send({
      ...(renewedToken ? { token: renewedToken } : {}),
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      // Read from the row, not the presented token — the same reason the
      // renewal above signs from the database. A flag revoked an hour ago must
      // not keep rendering the staff console for the rest of the token's life.
      isSuperAdmin: user.isSuperAdmin ?? false,
      orgId: user.orgId,
      consentAcceptedAt: user.consentAcceptedAt,
      consentVersion: user.consentVersion,
      // Effective targets: the member's own override when set, else the org
      // default. `??` and not `||` — a 0 override is a real target of no hours
      // and must not fall back to the org value.
      dailyTargetMinutes: user.dailyTargetMinutes ?? user.org.dailyTargetMinutes,
      weeklyTargetMinutes: user.weeklyTargetMinutes ?? user.org.weeklyTargetMinutes,
    });
  });

  // Record the user's acceptance of the monitoring consent notice.
  fastify.post("/auth/consent", { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const body = consentSchema.parse(req.body);
    await prisma.user.update({
      where: { id: req.user.userId },
      data: { consentAcceptedAt: new Date(), consentVersion: body.version },
    });
    return reply.send({ ok: true });
  });

  // Every role may edit their own display name — this is self-service, not an
  // admin action, so there is no role check beyond being authenticated.
  fastify.patch("/auth/me", { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const body = updateMeSchema.parse(req.body);
    const user = await prisma.user.update({
      where: { id: req.user.userId },
      data: { name: body.name },
    });
    return reply.send({ id: user.id, email: user.email, name: user.name, role: user.role });
  });

  /**
   * Which emails this account gets.
   *
   * Per USER, not per org: in-app notifications are org-wide for every admin
   * (and stay that way), but a mailbox belongs to one person, and "every admin
   * gets every email" is how a useful alert becomes a filter rule. Returns the
   * effective set — defaults already applied — plus the metadata the settings
   * UI renders, so labels and copy live in one place on the server rather than
   * being duplicated per client.
   */
  fastify.get("/auth/me/email-preferences", { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: req.user.userId },
      select: { role: true, emailPrefs: true, orgId: true },
    });
    // The org's switches decide what is sent at all; this endpoint reports them
    // alongside each type so the UI can show "off for the whole workspace"
    // rather than a toggle that silently does nothing. Read defensively: a
    // database missing these columns must degrade to "everything is on", never
    // to a failed request.
    const org = await prisma.organization
      .findUnique({
        where: { id: user.orgId },
        select: {
          emailsEnabled: true,
          notifyDailyShortfall: true,
          notifyWeeklyShortfall: true,
          notifyUnusualActivity: true,
          notifyMemberWeeklySummary: true,
        },
      })
      .catch(() => null);

    return reply.send({
      preferences: effectivePrefs(user),
      types: visibleTypes(user, org ?? {}),
    });
  });

  fastify.patch("/auth/me/email-preferences", { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const body = emailPrefsSchema.parse(req.body);
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: req.user.userId },
      select: { role: true, emailPrefs: true },
    });

    // Merged over what is stored, not replacing it: the UI sends the toggle
    // that changed, and a member who is later promoted to admin should find
    // the admin-only preferences they set as an admin still there.
    const current =
      user.emailPrefs && typeof user.emailPrefs === "object" && !Array.isArray(user.emailPrefs)
        ? (user.emailPrefs as Record<string, unknown>)
        : {};
    const merged = { ...sanitisePrefs(current), ...sanitisePrefs(body) };

    const updated = await prisma.user.update({
      where: { id: req.user.userId },
      data: { emailPrefs: merged },
      select: { role: true, emailPrefs: true },
    });
    return reply.send({ preferences: effectivePrefs(updated) });
  });

  // Authenticated password change (current + new), distinct from the
  // signed-out forgot/reset-password token flow above. JWTs here are short
  // (7d TTL, see TOKEN_TTL) and there is no session store to revoke against,
  // so this does not attempt to invalidate other devices' tokens.
  fastify.post("/auth/change-password", { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const body = changePasswordSchema.parse(req.body);

    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user.userId } });
    if (!user.passwordHash) {
      return reply.code(400).send({ error: "Current password is incorrect" });
    }
    const valid = await verifyPassword(body.currentPassword, user.passwordHash);
    if (!valid) {
      return reply.code(400).send({ error: "Current password is incorrect" });
    }

    const passwordHash = await hashPassword(body.newPassword);
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash } });
    return reply.send({ ok: true });
  });
}

