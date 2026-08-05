import type { FastifyInstance } from "fastify";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { hashPassword, verifyPassword } from "../lib/password";
import { sendInviteEmail, sendPasswordResetEmail } from "../lib/mailer";
import { auditLog } from "../lib/audit";
import { env } from "../env";

// Tokens must expire. Without a TTL a copied token stays valid forever, and
// disabling a member has no effect on any session they already hold.
const TOKEN_TTL = "7d";

const registerSchema = z.object({
  orgName: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
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

    const token = fastify.jwt.sign({ userId: user.id, orgId: org.id, role: user.role }, { expiresIn: TOKEN_TTL });
    return reply.code(201).send({ token, user: { id: user.id, email: user.email, role: user.role } });
  });

  fastify.post("/auth/login", async (req, reply) => {
    const body = loginSchema.parse(req.body);

    const user = await prisma.user.findUnique({ where: { email: body.email } });
    if (!user || !user.passwordHash || user.status !== "active") {
      return reply.code(401).send({ error: "Invalid credentials" });
    }

    const valid = await verifyPassword(body.password, user.passwordHash);
    if (!valid) {
      return reply.code(401).send({ error: "Invalid credentials" });
    }

    const token = fastify.jwt.sign({ userId: user.id, orgId: user.orgId, role: user.role }, { expiresIn: TOKEN_TTL });
    return reply.send({ token, user: { id: user.id, email: user.email, role: user.role } });
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

    const token = fastify.jwt.sign({ userId: user.id, orgId: user.orgId, role: user.role }, { expiresIn: TOKEN_TTL });
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

    const token = fastify.jwt.sign(
      { userId: reset.user.id, orgId: reset.user.orgId, role: reset.user.role },
      { expiresIn: TOKEN_TTL }
    );
    return reply.send({
      token,
      user: { id: reset.user.id, email: reset.user.email, role: reset.user.role },
    });
  });

  fastify.get("/auth/me", { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: req.user.userId },
      include: { org: { select: { dailyTargetMinutes: true, weeklyTargetMinutes: true } } },
    });
    // A disabled or removed member must lose access immediately, not when
    // their token eventually expires. Checked here because every client calls
    // /auth/me to establish a session.
    if (user.status !== "active") {
      return reply.code(401).send({ error: "Account disabled" });
    }
    return reply.send({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
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

