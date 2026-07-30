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

const updateMembersSchema = z.object({
  userIds: z.array(z.string()),
});

export default async function projectRoutes(fastify: FastifyInstance) {
  fastify.addHook("preHandler", fastify.authenticate);

  fastify.get("/projects", async (req, reply) => {
    const { archived } = req.query as { archived?: string };
    const archivedFilter = archived === "1" || archived === "true" ? { not: null } : null;
    const isPrivileged = req.user.role === "owner" || req.user.role === "admin";

    if (isPrivileged) {
      // Admin/owner see every org project regardless of assignment — they need
      // full visibility to manage it — plus the current assignment set so the
      // UI can render it without an extra round trip per project.
      const projects = await prisma.project.findMany({
        where: { orgId: req.user.orgId, archivedAt: archivedFilter },
        include: { tasks: true, members: { select: { userId: true } } },
        orderBy: { createdAt: "asc" },
      });
      return reply.send(
        projects.map(({ members, ...p }) => ({ ...p, assignedUserIds: members.map((m) => m.userId) }))
      );
    }

    // Regular members only see projects they've been explicitly assigned to.
    const projects = await prisma.project.findMany({
      where: {
        orgId: req.user.orgId,
        archivedAt: archivedFilter,
        members: { some: { userId: req.user.userId } },
      },
      include: { tasks: true },
      orderBy: { createdAt: "asc" },
    });
    return reply.send(projects);
  });

  fastify.get("/projects/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const project = await prisma.project.findUnique({
      where: { id },
      include: { tasks: true },
    });
    if (!project || project.orgId !== req.user.orgId) {
      return reply.code(404).send({ error: "Project not found" });
    }
    return reply.send(project);
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

  fastify.put(
    "/projects/:id/members",
    { preHandler: [fastify.requireRole(["owner", "admin"])] },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = updateMembersSchema.parse(req.body);

      const existing = await prisma.project.findUnique({ where: { id } });
      if (!existing || existing.orgId !== req.user.orgId) {
        return reply.code(404).send({ error: "Project not found" });
      }

      // Never trust client-supplied ids as-is — silently drop anything that
      // doesn't resolve to a real user in this org rather than assigning
      // (or erroring on) a foreign-org id.
      const requestedIds = [...new Set(body.userIds)];
      const validUsers = await prisma.user.findMany({
        where: { id: { in: requestedIds }, orgId: req.user.orgId },
        select: { id: true },
      });
      const validIds = new Set(validUsers.map((u) => u.id));

      const current = await prisma.projectMember.findMany({
        where: { projectId: id },
        select: { userId: true },
      });
      const currentIds = new Set(current.map((m) => m.userId));

      const toAdd = [...validIds].filter((uid) => !currentIds.has(uid));
      const toRemove = [...currentIds].filter((uid) => !validIds.has(uid));

      await prisma.$transaction([
        ...(toRemove.length > 0
          ? [prisma.projectMember.deleteMany({ where: { projectId: id, userId: { in: toRemove } } })]
          : []),
        ...(toAdd.length > 0
          ? [
              prisma.projectMember.createMany({
                data: toAdd.map((userId) => ({ projectId: id, userId })),
                skipDuplicates: true,
              }),
            ]
          : []),
      ]);

      return reply.send({ assignedUserIds: [...validIds] });
    }
  );
}
