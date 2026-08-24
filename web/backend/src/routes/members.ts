import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { auditLog } from "../lib/audit";

const updateMemberSchema = z.object({
  role: z.enum(["owner", "admin", "member"]).optional(),
  // `removed` is deliberately not settable any more: removing a member is now a
  // real DELETE (see the DELETE handler below), not a status. The enum value
  // survives in the schema only so the handful of rows predating that change
  // still read back.
  status: z.enum(["invited", "active", "disabled"]).optional(),
  // Nullable on purpose: null clears the override so the member goes back to
  // inheriting the org default. That is a different thing from 0, which is a
  // real target of no hours.
  dailyTargetMinutes: z.number().int().min(0).max(1440).nullable().optional(),
  weeklyTargetMinutes: z.number().int().min(0).max(10080).nullable().optional(),
});

const memberSelect = {
  id: true,
  email: true,
  role: true,
  status: true,
  createdAt: true,
  dailyTargetMinutes: true,
  weeklyTargetMinutes: true,
} as const;

export default async function memberRoutes(fastify: FastifyInstance) {
  fastify.addHook("preHandler", fastify.authenticate);

  fastify.get("/members", async (req, reply) => {
    const members = await prisma.user.findMany({
      where: { orgId: req.user.orgId },
      select: memberSelect,
      orderBy: { createdAt: "asc" },
    });
    // The frontend picks this payload apart with `.map((m) => m.email)` and
    // `.filter((m) => m.status)` — never hand it rows that aren't complete
    // Member objects. `email`/`id` are non-nullable in the schema, so the
    // shape is guaranteed; spell it out anyway so a future schema drift
    // cannot silently ship nulls into the dashboard tree.
    return reply.send(
      members.map((m) => ({
        id: m.id,
        email: m.email,
        role: m.role,
        status: m.status,
        createdAt: m.createdAt,
        dailyTargetMinutes: m.dailyTargetMinutes,
        weeklyTargetMinutes: m.weeklyTargetMinutes,
      }))
    );
  });

  fastify.patch(
    "/members/:id",
    { preHandler: [fastify.requireRole(["owner", "admin"])] },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = updateMemberSchema.parse(req.body);

      const target = await prisma.user.findUnique({ where: { id } });
      if (!target || target.orgId !== req.user.orgId) {
        return reply.code(404).send({ error: "Member not found" });
      }
      if (target.role === "owner" && body.role && body.role !== "owner") {
        return reply.code(400).send({ error: "Cannot change the owner's role" });
      }
      // Same protection extended to status: PATCH previously only guarded role,
      // so an admin could already disable or remove the owner through this
      // endpoint even though the dedicated DELETE route explicitly refuses to.
      if (target.role === "owner" && body.status && body.status !== "active") {
        return reply.code(400).send({ error: "Cannot disable or remove the owner" });
      }
      // Legacy `removed` rows predate the hard delete and are inert: nothing can
      // be done to them through this endpoint.
      if (target.status === "removed") {
        return reply.code(400).send({ error: "This account has been removed" });
      }

      const updated = await prisma.user.update({ where: { id }, data: body, select: memberSelect });

      // One PATCH can carry several changes; record each as its own entry so the
      // log filters cleanly by action. Target email is captured from `target`
      // (pre-update), which is the address a reader would recognise.
      const base = {
        orgId: req.user.orgId,
        actorId: req.user.userId,
        targetId: target.id,
        targetLabel: target.email,
      } as const;
      if (body.role && body.role !== target.role) {
        await auditLog({ ...base, action: "member.role_changed", details: { from: target.role, to: body.role } });
      }
      if (body.status && body.status !== target.status) {
        if (body.status === "disabled") await auditLog({ ...base, action: "member.disabled" });
        else if (body.status === "active") await auditLog({ ...base, action: "member.reenabled" });
      }

      return reply.send(updated);
    }
  );

  fastify.delete(
    "/members/:id",
    { preHandler: [fastify.requireRole(["owner", "admin"])] },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const target = await prisma.user.findUnique({ where: { id } });
      if (!target || target.orgId !== req.user.orgId) {
        return reply.code(404).send({ error: "Member not found" });
      }
      if (target.role === "owner") {
        return reply.code(400).send({ error: "Cannot remove the owner" });
      }
      if (target.id === req.user.userId) {
        return reply.code(400).send({ error: "You cannot delete your own account" });
      }

      // Audit BEFORE the delete: once the row is gone we can no longer read the
      // email, and an entry saying only "some user was deleted" is worthless.
      // The identity is denormalised into the payload, so it survives.
      await auditLog({
        orgId: req.user.orgId,
        actorId: req.user.userId,
        action: "member.deleted",
        targetId: target.id,
        targetLabel: target.email,
        details: { role: target.role, previousStatus: target.status },
      });

      // A real DELETE, not a status change. Everything the person tracked
      // survives with `userId` set to NULL (see the SetNull FKs in
      // schema.prisma) and stays reachable org-wide through its project. Only
      // the rows that mean nothing without them are removed outright:
      // project assignments and any outstanding password-reset tokens, both of
      // which are required FKs and would otherwise block the delete.
      await prisma.$transaction([
        prisma.projectMember.deleteMany({ where: { userId: id } }),
        prisma.passwordResetToken.deleteMany({ where: { userId: id } }),
        prisma.user.delete({ where: { id } }),
      ]);

      return reply.code(204).send();
    }
  );
}
