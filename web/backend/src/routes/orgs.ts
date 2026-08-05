import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma";

const settingsSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  screenshotsPerBlock: z.number().int().min(0).max(3).optional(),
  blurScreenshots: z.boolean().optional(),
  idleTimeoutMinutes: z.number().int().min(1).max(60).optional(),
  keepIdleDefault: z.boolean().optional(),
  showWebsiteUsage: z.boolean().optional(),
  // Org-wide work targets, in minutes. Bounded by the real length of a day/week.
  dailyTargetMinutes: z.number().int().min(0).max(1440).optional(),
  weeklyTargetMinutes: z.number().int().min(0).max(10080).optional(),
});

/** Everything that predates the showWebsiteUsage column. */
const baseSelect = {
  id: true,
  name: true,
  screenshotsPerBlock: true,
  blurScreenshots: true,
  idleTimeoutMinutes: true,
  keepIdleDefault: true,
  dailyTargetMinutes: true,
  weeklyTargetMinutes: true,
} as const;

const settingsSelect = { ...baseSelect, showWebsiteUsage: true } as const;

/**
 * Whether the database actually has the `showWebsiteUsage` column.
 *
 * Code and schema migrations do not land at the same instant: the API can be
 * live for minutes before `prisma migrate deploy` has run against the
 * database (and on a deploy that never runs migrations, indefinitely).
 * Selecting a column that does not exist throws, and because every client
 * loads /orgs/settings on boot, that turned one pending migration into a
 * dashboard-wide "Could not load settings." — the whole page, not just the
 * one panel the column belongs to.
 *
 * So the column is probed once and the query shaped to match. `true` is
 * cached permanently (a column cannot go away); `false` is not, so the very
 * next request after the migration lands starts returning the real value
 * without needing a restart.
 */
let columnPresent = false;

async function hasWebsiteUsageColumn(): Promise<boolean> {
  if (columnPresent) return true;
  try {
    await prisma.$queryRaw`SELECT "showWebsiteUsage" FROM "Organization" LIMIT 1`;
    columnPresent = true;
  } catch {
    columnPresent = false;
  }
  return columnPresent;
}

/** Default when the column is missing: the panel stays visible, as it always was. */
const SHOW_WEBSITE_USAGE_DEFAULT = true;

export default async function orgRoutes(fastify: FastifyInstance) {
  fastify.addHook("preHandler", fastify.authenticate);

  // Any member may read settings (the desktop client needs capture policy).
  fastify.get("/orgs/settings", async (req, reply) => {
    const withColumn = await hasWebsiteUsageColumn();
    const org = await prisma.organization.findUnique({
      where: { id: req.user.orgId },
      select: withColumn ? settingsSelect : baseSelect,
    });
    if (!org) return reply.code(404).send({ error: "Org not found" });
    return reply.send(
      withColumn ? org : { ...org, showWebsiteUsage: SHOW_WEBSITE_USAGE_DEFAULT }
    );
  });

  // Only owner/admin may change capture policy.
  fastify.patch("/orgs/settings", async (req, reply) => {
    if (req.user.role !== "owner" && req.user.role !== "admin") {
      return reply.code(403).send({ error: "Admins only" });
    }
    const body = settingsSchema.parse(req.body);
    const withColumn = await hasWebsiteUsageColumn();

    // Without the column, drop the field rather than failing the write — the
    // dashboard sends every setting on each save, so refusing the request
    // would block editing screenshots, targets and the org name too.
    const { showWebsiteUsage, ...rest } = body;
    const data = withColumn ? body : rest;

    const org = await prisma.organization.update({
      where: { id: req.user.orgId },
      data,
      select: withColumn ? settingsSelect : baseSelect,
    });
    return reply.send(
      withColumn ? org : { ...org, showWebsiteUsage: SHOW_WEBSITE_USAGE_DEFAULT }
    );
  });
}
