import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma";

const createTaskSchema = z.object({
  title: z.string().min(1),
});

const updateTaskSchema = z.object({
  title: z.string().min(1).optional(),
  status: z.enum(["todo", "in_progress", "done"]).optional(),
});

async function assertProjectInOrg(projectId: string, orgId: string) {
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  return project && project.orgId === orgId ? project : null;
}

export default async function taskRoutes(fastify: FastifyInstance) {
  fastify.addHook("preHandler", fastify.authenticate);

  fastify.get("/projects/:projectId/tasks", async (req, reply) => {
    const { projectId } = req.params as { projectId: string };
    const project = await assertProjectInOrg(projectId, req.user.orgId);
    if (!project) return reply.code(404).send({ error: "Project not found" });

    const tasks = await prisma.task.findMany({
      where: { projectId },
      orderBy: { createdAt: "asc" },
    });
    return reply.send(tasks);
  });

  fastify.post("/projects/:projectId/tasks", async (req, reply) => {
    const { projectId } = req.params as { projectId: string };
    const project = await assertProjectInOrg(projectId, req.user.orgId);
    if (!project) return reply.code(404).send({ error: "Project not found" });

    const body = createTaskSchema.parse(req.body);
    const task = await prisma.task.create({ data: { projectId, title: body.title } });
    return reply.code(201).send(task);
  });

  fastify.patch("/tasks/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = updateTaskSchema.parse(req.body);

    const task = await prisma.task.findUnique({ where: { id }, include: { project: true } });
    if (!task || task.project.orgId !== req.user.orgId) {
      return reply.code(404).send({ error: "Task not found" });
    }

    const updated = await prisma.task.update({ where: { id }, data: body });
    return reply.send(updated);
  });

  fastify.delete("/tasks/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const task = await prisma.task.findUnique({ where: { id }, include: { project: true } });
    if (!task || task.project.orgId !== req.user.orgId) {
      return reply.code(404).send({ error: "Task not found" });
    }

    await prisma.task.delete({ where: { id } });
    return reply.code(204).send();
  });
}
