import type { FastifyInstance } from "fastify";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { hashPassword, verifyPassword } from "../lib/password";
import { sendInviteEmail } from "../lib/mailer";
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
      if (existing) {
        return reply.code(409).send({ error: "Email already in use" });
      }

      const org = await prisma.organization.findUniqueOrThrow({ where: { id: req.user.orgId } });
      const token = randomBytes(32).toString("hex");
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

      await prisma.inviteToken.create({
        data: { orgId: org.id, email: body.email, role: body.role, token, expiresAt },
      });

      const inviteUrl = `${env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/accept-invite?token=${token}`;
      await sendInviteEmail(body.email, inviteUrl, org.name);

      return reply.code(201).send({ ok: true });
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

  fastify.get("/auth/me", { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user.userId } });
    // A disabled member must lose access immediately, not when their token
    // eventually expires. Checked here because every client calls /auth/me to
    // establish a session.
    if (user.status === "disabled") {
      return reply.code(401).send({ error: "Account disabled" });
    }
    return reply.send({
      id: user.id,
      email: user.email,
      role: user.role,
      orgId: user.orgId,
      consentAcceptedAt: user.consentAcceptedAt,
      consentVersion: user.consentVersion,
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
}

