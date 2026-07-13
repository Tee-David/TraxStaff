import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma";

const createProjectSchema = z.object({
  name: z.string().min(1),
  clientTag: z.string().optional(),
});

const updateProjectSchema = z.object({
  name: z.string().min(1).optional(),
  clientTag: z.string().nullable().optional(),
  archived: z.boolean().optional(),
});

export default async function projectRoutes(fastify: FastifyInstance) {
  fastify.addHook("preHandler", fastify.authenticate);

  fastify.get("/projects", async (req, reply) => {
    const projects = await prisma.project.findMany({
      where: { orgId: req.user.orgId, archivedAt: null },
      include: { tasks: true },
      orderBy: { createdAt: "asc" },
    });
    return reply.send(projects);
  });

  fastify.post(
    "/projects",
    { preHandler: [fastify.requireRole(["owner", "admin"])] },
    async (req, reply) => {
      const body = createProjectSchema.parse(req.body);
      const project = await prisma.project.create({
        data: { orgId: req.user.orgId, name: body.name, clientTag: body.clientTag },
      });
      return reply.code(201).send(project);
    }
  );

  fastify.patch(
    "/projects/:id",
    { preHandler: [fastify.requireRole(["owner", "admin"])] },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = updateProjectSchema.parse(req.body);

      const existing = await prisma.project.findUnique({ where: { id } });
      if (!existing || existing.orgId !== req.user.orgId) {
        return reply.code(404).send({ error: "Project not found" });
      }

      const project = await prisma.project.update({
        where: { id },
        data: {
          name: body.name,
          clientTag: body.clientTag,
          archivedAt: body.archived === undefined ? undefined : body.archived ? new Date() : null,
        },
      });
      return reply.send(project);
    }
  );
}
