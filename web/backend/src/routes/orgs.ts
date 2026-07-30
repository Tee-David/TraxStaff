import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma";

const settingsSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  screenshotsPerBlock: z.number().int().min(0).max(3).optional(),
  blurScreenshots: z.boolean().optional(),
  idleTimeoutMinutes: z.number().int().min(1).max(60).optional(),
  keepIdleDefault: z.boolean().optional(),
  // Org-wide work targets, in minutes. Bounded by the real length of a day/week.
  dailyTargetMinutes: z.number().int().min(0).max(1440).optional(),
  weeklyTargetMinutes: z.number().int().min(0).max(10080).optional(),
});

const settingsSelect = {
  id: true,
  name: true,
  screenshotsPerBlock: true,
  blurScreenshots: true,
  idleTimeoutMinutes: true,
  keepIdleDefault: true,
  dailyTargetMinutes: true,
  weeklyTargetMinutes: true,
} as const;

export default async function orgRoutes(fastify: FastifyInstance) {
  fastify.addHook("preHandler", fastify.authenticate);

  // Any member may read settings (the desktop client needs capture policy).
  fastify.get("/orgs/settings", async (req, reply) => {
    const org = await prisma.organization.findUnique({
      where: { id: req.user.orgId },
      select: settingsSelect,
    });
    if (!org) return reply.code(404).send({ error: "Org not found" });
    return reply.send(org);
  });

  // Only owner/admin may change capture policy.
  fastify.patch("/orgs/settings", async (req, reply) => {
    if (req.user.role !== "owner" && req.user.role !== "admin") {
      return reply.code(403).send({ error: "Admins only" });
    }
    const body = settingsSchema.parse(req.body);
    const org = await prisma.organization.update({
      where: { id: req.user.orgId },
      data: body,
      select: settingsSelect,
    });
    return reply.send(org);
  });
}
