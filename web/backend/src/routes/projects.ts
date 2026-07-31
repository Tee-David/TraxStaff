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

const bulkSchema = z.object({
  action: z.enum(["archive", "unarchive", "delete"]),
  ids: z.array(z.string().uuid()).min(1).max(200),
});

export default async function projectRoutes(fastify: FastifyInstance) {
  fastify.addHook("preHandler", fastify.authenticate);

  // Default: only projects the caller is assigned to — this is what backs the
  // ordinary "my projects" surfaces (e.g. the Dashboard widget) for EVERY
  // role, admins included. ?scope=all is the explicit admin-management
  // opt-in used by the Projects admin page, which needs every org project
  // (plus current assignment) so it can manage who's assigned where.
  fastify.get("/projects", async (req, reply) => {
    const { archived, scope } = req.query as { archived?: string; scope?: string };
    const archivedFilter = archived === "1" || archived === "true" ? { not: null } : null;
    const isPrivileged = req.user.role === "owner" || req.user.role === "admin";

    if (isPrivileged && scope === "all") {
      // Admin/owner management view: every org project regardless of
      // assignment — they need full visibility to manage it — plus the
      // current assignment set so the UI can render it without an extra
      // round trip per project.
      const projects = await prisma.project.findMany({
        where: { orgId: req.user.orgId, archivedAt: archivedFilter },
        include: { tasks: true, members: { select: { userId: true } } },
        orderBy: { createdAt: "asc" },
      });
      return reply.send(
        projects.map(({ members, ...p }) => ({ ...p, assignedUserIds: members.map((m) => m.userId) }))
      );
    }

    // Everyone else (and a privileged caller not asking for the management
    // view) only sees projects they've been explicitly assigned to.
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

  /**
   * Bulk archive / unarchive / delete, for the Projects admin page's
   * multi-select.
   *
   * Delete is the reason this is a single endpoint rather than a loop of
   * PATCHes on the client: a project that has tracked sessions against it is
   * **not deletable**, because deleting it would take real timesheet history
   * with it — hours somebody worked and may have been paid for. The schema
   * already refuses this (the session→project relation is required, so Prisma
   * restricts the delete), but failing with a foreign-key error halfway through
   * a batch would leave the caller with no idea what happened.
   *
   * So this checks first and reports: projects with no sessions are deleted
   * along with their tasks and assignments, and anything with history comes
   * back in `blocked` with its session count, for the UI to explain and offer
   * archiving instead. Archiving is the reversible equivalent and is what
   * should almost always happen to a project that has been worked on.
   */
  fastify.post(
    "/projects/bulk",
    { preHandler: [fastify.requireRole(["owner", "admin"])] },
    async (req, reply) => {
      const body = bulkSchema.parse(req.body);

      // Scope to this org before anything else — ids come from the client.
      const owned = await prisma.project.findMany({
        where: { id: { in: body.ids }, orgId: req.user.orgId },
        select: { id: true, name: true, _count: { select: { sessions: true } } },
      });
      if (owned.length === 0) return reply.code(404).send({ error: "No matching projects" });

      if (body.action !== "delete") {
        const archivedAt = body.action === "archive" ? new Date() : null;
        const { count } = await prisma.project.updateMany({
          where: { id: { in: owned.map((p) => p.id) }, orgId: req.user.orgId },
          data: { archivedAt },
        });
        return reply.send({ action: body.action, updated: count, deleted: [], blocked: [] });
      }

      const deletable = owned.filter((p) => p._count.sessions === 0);
      const blocked = owned
        .filter((p) => p._count.sessions > 0)
        .map((p) => ({ id: p.id, name: p.name, sessionCount: p._count.sessions }));

      if (deletable.length > 0) {
        const ids = deletable.map((p) => p.id);
        // Tasks and assignments have no independent meaning once the project is
        // gone, so they go with it in one transaction.
        await prisma.$transaction([
          prisma.projectMember.deleteMany({ where: { projectId: { in: ids } } }),
          prisma.task.deleteMany({ where: { projectId: { in: ids } } }),
          prisma.project.deleteMany({ where: { id: { in: ids }, orgId: req.user.orgId } }),
        ]);
      }

      return reply.send({
        action: "delete",
        updated: 0,
        deleted: deletable.map((p) => ({ id: p.id, name: p.name })),
        blocked,
      });
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
