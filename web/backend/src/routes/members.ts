import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma";

const updateMemberSchema = z.object({
  role: z.enum(["owner", "admin", "member"]).optional(),
  status: z.enum(["invited", "active", "disabled", "removed"]).optional(),
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
    return reply.send(members);
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

      // When transitioning to "removed" (permanent removal), tombstone the email so the
      // address is freed for future invites/signups. Keep the row (and all tracking
      // history) intact — only the identity (email) is permanently cleared.
      const updateData: typeof body & { email?: string } = { ...body };
      if (body.status === "removed" && target.status !== "removed") {
        updateData.email = `removed-${target.id}@deleted.traxstaff.internal`;
      }

      const updated = await prisma.user.update({ where: { id }, data: updateData, select: memberSelect });
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

      await prisma.user.update({ where: { id }, data: { status: "disabled" } });
      return reply.code(204).send();
    }
  );
}
