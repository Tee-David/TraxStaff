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
import superAdminRoutes from "./routes/superadmin";
import superAdminOpsRoutes from "./routes/superadmin-ops";
import {
  ensureAuditLogTable,
  ensureNullableUserFks,
  ensureOutboundEmailTable,
  ensureOrgStatusColumn,
  ensurePlatformTables,
  ensureShortfallNotifyColumns,
  ensureSuperAdminColumn,
  ensureWebsiteUsageColumn,
} from "./lib/ensure-schema";
import { ensureConfiguredSuperAdmins } from "./lib/superadmin";
import { startEmailQueueWorker } from "./lib/email-queue";
import { sweepSnapshots } from "./lib/platform-log";
import { deliverNow } from "./lib/mailer";
import { startStaleSessionSweeper } from "./lib/stale-sessions";
import { startDigestScheduler } from "./lib/digest-scheduler";
import { prisma } from "./lib/prisma";
import { ACTING_ORG_ECHO_HEADER, ACTING_ORG_HEADER } from "./lib/acting-org";

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
    // Spelled out rather than left to the default reflection of
    // `Access-Control-Request-Headers`. The org switcher rides on `x-trax-org`
    // (lib/acting-org.ts), and a browser that cannot send it degrades to "the
    // switcher silently does nothing" — a failure with no error anywhere.
    allowedHeaders: ["Content-Type", "Authorization", ACTING_ORG_HEADER],
    exposedHeaders: [ACTING_ORG_ECHO_HEADER],
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
  await fastify.register(superAdminRoutes);
  await fastify.register(superAdminOpsRoutes);

  // None of these block startup: they log and move on if the database refuses.
  //
  // `ensureSuperAdminColumn` runs FIRST, and is the one with a wider blast
  // radius than the rest: `User.isSuperAdmin` is in schema.prisma, so the
  // generated client selects it on every unqualified `prisma.user` read — login
  // included. If this DDL cannot land, that is not a degraded feature, it is a
  // backend that cannot authenticate anyone, so it goes before anything else
  // and its failure is the loudest line in the boot log.
  // These two share a blast radius: both columns are in schema.prisma, so the
  // generated client selects them on every unqualified read of their table —
  // login for one, registration and invites for the other. A failure here is
  // not a degraded feature, it is a backend that cannot serve those paths, so
  // they go first and their failures are the loudest lines in the boot log.
  await ensureSuperAdminColumn(fastify.log);
  await ensureOrgStatusColumn(fastify.log);
  await ensureWebsiteUsageColumn(fastify.log);
  await ensureAuditLogTable(fastify.log);
  await ensureNullableUserFks(fastify.log);
  await ensureShortfallNotifyColumns(fastify.log);
  await ensureOutboundEmailTable(fastify.log);
  await ensurePlatformTables(fastify.log);

  // Grant platform access to whatever SUPERADMIN_EMAILS names. The bootstrap:
  // only a super admin can grant the flag through the API, so the first one has
  // to come from configuration. Additive only — it never revokes.
  await ensureConfiguredSuperAdmins(fastify.log);

  // Close sessions the tracker never got to stop — an app killed, a machine shut
  // down, a token rejected mid-session. Nothing else ever did, so a single
  // forgotten row read as "still running" indefinitely across every report. Runs
  // once at boot (which also catches whatever accumulated while we were down) and
  // then on an interval; failures are logged, never fatal.
  startStaleSessionSweeper(fastify.log, prisma);

  // Outgoing mail is queued rather than sent inline, so a relay blip or an
  // instance that hibernated mid-send is recoverable. This drains the outbox
  // once immediately — which on a hibernating instance is the whole point,
  // since boot is the first moment anything queued while it was asleep can
  // actually go out — and then every minute.
  startEmailQueueWorker(fastify.log, deliverNow);

  // Work-target digests: daily the morning after, weekly on Monday, in each
  // org's own timezone. Ticks every 15 minutes and asks which periods have
  // already been sent, so a redeploy at 08:00 neither skips nor repeats a day,
  // and a day the instance slept through is still caught up afterwards.
  startDigestScheduler(fastify.log, prisma);

  // Expire undo snapshots. Once a day is plenty — the TTL is two weeks, and an
  // hour either side of it changes nothing. Swept at boot as well so a long-
  // sleeping instance does not accumulate a second copy of the database.
  const sweepDaily = () =>
    sweepSnapshots()
      .then((n) => n > 0 && fastify.log.info(`[platform] swept ${n} expired snapshot(s)`))
      .catch(() => {});
  sweepDaily();
  setInterval(sweepDaily, 24 * 60 * 60_000).unref();

  await fastify.listen({ port: env.PORT, host: "0.0.0.0" });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
