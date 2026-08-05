import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { auditLog } from "../lib/audit";

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
      // Removal is a one-way door (see the frontend's RemoveDialog copy) — once
      // gone, nothing through this endpoint should bring the account back.
      if (target.status === "removed") {
        return reply.code(400).send({ error: "This account has been removed" });
      }

      const data: typeof body & { email?: string } = { ...body };
      // `email` is unique, so a removed account would squat on its address
      // forever — re-inviting that same person (or anyone else who wants it)
      // would 409 with "already in use" for good. Free it the moment the
      // account is actually removed; the row and its tracked-time history
      // stay put under the new address, unaffected.
      if (body.status === "removed") {
        const [local, domain] = target.email.split("@");
        data.email = `${local}+removed-${target.id.slice(0, 8)}@${domain}`;
      }

      const updated = await prisma.user.update({ where: { id }, data, select: memberSelect });

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
        if (body.status === "removed") await auditLog({ ...base, action: "member.removed" });
        else if (body.status === "disabled") await auditLog({ ...base, action: "member.disabled" });
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

      await prisma.user.update({ where: { id }, data: { status: "disabled" } });
      await auditLog({
        orgId: req.user.orgId,
        actorId: req.user.userId,
        action: "member.disabled",
        targetId: target.id,
        targetLabel: target.email,
      });
      return reply.code(204).send();
    }
  );
}
