import type { FastifyInstance } from "fastify";
import type { Prisma } from "@prisma/client";
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
  // IANA zone the working day is measured in. Validated by asking Intl whether
  // it knows the zone, rather than shipping a list that goes stale.
  timezone: z
    .string()
    .min(1)
    .max(64)
    .refine((tz) => {
      try {
        new Intl.DateTimeFormat("en-US", { timeZone: tz });
        return true;
      } catch {
        return false;
      }
    }, "Unknown timezone")
    .optional(),
  // Email delivery switches. `emailsEnabled` is the master; the rest are per-kind.
  emailsEnabled: z.boolean().optional(),
  notifyDailyShortfall: z.boolean().optional(),
  notifyWeeklyShortfall: z.boolean().optional(),
  notifyUnusualActivity: z.boolean().optional(),
  notifyMemberWeeklySummary: z.boolean().optional(),
});

/** Everything that predates the drift-tolerant columns below. */
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

/**
 * Columns this database may not have yet, and what to serve when it doesn't.
 *
 * Code and schema migrations do not land at the same instant: the API can be
 * live for minutes before the DDL has run against the database (and on a
 * deploy that never runs migrations, indefinitely). Selecting a column that
 * does not exist throws, and because every client loads /orgs/settings on
 * boot, that turned one pending migration into a dashboard-wide "Could not
 * load settings." — the whole page, not just the one panel the column belongs
 * to.
 *
 * So each column is probed and the query shaped to match. Defaults are chosen
 * so a missing column degrades to "the toggle reads as on and does not
 * persist", never to a broken page.
 */
const OPTIONAL_COLUMN_DEFAULTS = {
  showWebsiteUsage: true,
  timezone: "UTC",
  emailsEnabled: true,
  notifyDailyShortfall: true,
  notifyWeeklyShortfall: true,
  notifyUnusualActivity: true,
  // Mirrors schema.prisma and the scheduler: the only member-facing one is opt-in.
  notifyMemberWeeklySummary: false,
} as const;

type OptionalColumn = keyof typeof OPTIONAL_COLUMN_DEFAULTS;

const ALL_OPTIONAL = Object.keys(OPTIONAL_COLUMN_DEFAULTS) as OptionalColumn[];

/**
 * Confirmed-present columns. A present column is cached permanently (a column
 * cannot go away); an absent one is re-probed on every request, so the first
 * request after the DDL lands starts returning the real value without needing
 * a restart.
 */
const present = new Set<OptionalColumn>();

async function presentColumns(): Promise<Set<OptionalColumn>> {
  for (const column of ALL_OPTIONAL) {
    if (present.has(column)) continue;
    try {
      // Interpolated, but never from user input — the names are the literal
      // keys of OPTIONAL_COLUMN_DEFAULTS above.
      await prisma.$queryRawUnsafe(`SELECT "${column}" FROM "Organization" LIMIT 1`);
      present.add(column);
    } catch {
      // Still missing. Leave it out and probe again next request.
    }
  }
  return present;
}

function selectFor(have: Set<OptionalColumn>): Prisma.OrganizationSelect {
  const select: Prisma.OrganizationSelect = { ...baseSelect };
  for (const column of have) select[column] = true;
  return select;
}

/** Fills in a served default for every column the database is missing. */
function withDefaults(org: object, have: Set<OptionalColumn>): object {
  const filled: Record<string, unknown> = { ...org };
  for (const column of ALL_OPTIONAL) {
    if (!have.has(column)) filled[column] = OPTIONAL_COLUMN_DEFAULTS[column];
  }
  return filled;
}

export default async function orgRoutes(fastify: FastifyInstance) {
  fastify.addHook("preHandler", fastify.authenticate);

  // Any member may read settings (the desktop client needs capture policy).
  fastify.get("/orgs/settings", async (req, reply) => {
    const have = await presentColumns();
    const org = await prisma.organization.findUnique({
      where: { id: req.user.orgId },
      select: selectFor(have),
    });
    if (!org) return reply.code(404).send({ error: "Org not found" });
    return reply.send(withDefaults(org, have));
  });

  // Only owner/admin may change capture policy.
  fastify.patch("/orgs/settings", async (req, reply) => {
    if (req.user.role !== "owner" && req.user.role !== "admin") {
      return reply.code(403).send({ error: "Admins only" });
    }
    const body = settingsSchema.parse(req.body);
    const have = await presentColumns();

    // Drop any field whose column is missing rather than failing the write —
    // the dashboard sends every setting on each save, so refusing the request
    // would block editing screenshots, targets and the org name too.
    const data: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(body)) {
      if (value === undefined) continue;
      if ((ALL_OPTIONAL as string[]).includes(key) && !have.has(key as OptionalColumn)) continue;
      data[key] = value;
    }

    const org = await prisma.organization.update({
      where: { id: req.user.orgId },
      data,
      select: selectFor(have),
    });
    return reply.send(withDefaults(org, have));
  });
}
