import Fastify from "fastify";
import cors from "@fastify/cors";
import { env } from "./env";
import authPlugin from "./plugins/auth";
import healthRoutes from "./routes/health";
import authRoutes from "./routes/auth";
import memberRoutes from "./routes/members";
import projectRoutes from "./routes/projects";
import taskRoutes from "./routes/tasks";

async function main() {
  const fastify = Fastify({ logger: true });

  await fastify.register(cors, {
    origin: env.NEXT_PUBLIC_APP_URL ?? true,
  });
  await fastify.register(authPlugin);

  await fastify.register(healthRoutes);
  await fastify.register(authRoutes);
  await fastify.register(memberRoutes);
  await fastify.register(projectRoutes);
  await fastify.register(taskRoutes);

  await fastify.listen({ port: env.PORT, host: "0.0.0.0" });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
