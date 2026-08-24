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
import screenshotRoutes from "./routes/screenshots";
import orgRoutes from "./routes/orgs";
import {
  ensureApprovalColumns,
  ensureAuditLogTable,
  ensureNullableUserFks,
  ensureShortfallNotifyColumns,
  ensureWebsiteUsageColumn,
} from "./lib/ensure-schema";
import { startStaleSessionSweeper } from "./lib/stale-sessions";
import { startDigestScheduler } from "./lib/digest-scheduler";
import { prisma } from "./lib/prisma";

async function main() {
  const fastify = Fastify({ logger: true });

  // Accept empty bodies on requests that still send `Content-Type: application/json`
  // (e.g. DELETE / stop calls with no payload) instead of 400-ing on empty JSON.
  fastify.addContentTypeParser("application/json", { parseAs: "string" }, (_req, body, done) => {
    if (!body || (typeof body === "string" && body.trim() === "")) return done(null, undefined);
    try {
      done(null, JSON.parse(body as string));
    } catch (err) {
      done(err as Error);
    }
  });

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
  await fastify.register(screenshotRoutes);
  await fastify.register(orgRoutes);

  // None of these block startup: they log and move on if the database refuses.
  await ensureWebsiteUsageColumn(fastify.log);
  await ensureAuditLogTable(fastify.log);
  await ensureNullableUserFks(fastify.log);
  await ensureShortfallNotifyColumns(fastify.log);
  await ensureApprovalColumns(fastify.log);

  // Close sessions the tracker never got to stop — an app killed, a machine shut
  // down, a token rejected mid-session. Nothing else ever did, so a single
  // forgotten row read as "still running" indefinitely across every report. Runs
  // once at boot (which also catches whatever accumulated while we were down) and
  // then on an interval; failures are logged, never fatal.
  startStaleSessionSweeper(fastify.log, prisma);

  // Work-target digests: daily the morning after, weekly on Monday, in each
  // org's own timezone. Ticks every 15 minutes and asks whether the period has
  // already been sent, so a redeploy at 08:00 neither skips nor repeats a day.
  startDigestScheduler(fastify.log, prisma);

  await fastify.listen({ port: env.PORT, host: "0.0.0.0" });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
