import Fastify from "fastify";
import cors from "@fastify/cors";
import { ZodError } from "zod";
import { env } from "./env";
import authPlugin from "./plugins/auth";
import healthRoutes from "./routes/health";
import authRoutes from "./routes/auth";
import memberRoutes from "./routes/members";
import projectRoutes from "./routes/projects";
import taskRoutes from "./routes/tasks";
import sessionRoutes from "./routes/sessions";
import syncRoutes from "./routes/sync";
import reportRoutes from "./routes/reports";
import insightsRoutes from "./routes/insights";

async function main() {
  const fastify = Fastify({ logger: true });

  // Turn schema-validation failures into clean 400s instead of 500s.
  fastify.setErrorHandler((error: Error & { statusCode?: number }, _req, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({ error: "Validation failed", details: error.issues });
    }
    fastify.log.error(error);
    return reply.code(error.statusCode ?? 500).send({ error: error.message ?? "Internal error" });
  });

  // Allow the web dashboards and the desktop tracker (tauri:// origin, and
  // localhost during dev) to call the API.
  await fastify.register(cors, {
    origin: true,
  });
  await fastify.register(authPlugin);

  await fastify.register(healthRoutes);
  await fastify.register(authRoutes);
  await fastify.register(memberRoutes);
  await fastify.register(projectRoutes);
  await fastify.register(taskRoutes);
  await fastify.register(sessionRoutes);
  await fastify.register(syncRoutes);
  await fastify.register(reportRoutes);
  await fastify.register(insightsRoutes);

  await fastify.listen({ port: env.PORT, host: "0.0.0.0" });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
