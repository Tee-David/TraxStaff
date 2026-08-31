/**
 * Platform routes — everything only a super admin can do.
 *
 * Every other route module in this backend is scoped to one organization: the
 * caller's `req.user.orgId` bounds each query, and a UUID from another org is a
 * 404 by construction. This module is the deliberate exception. It is the only
 * place in the API where `orgId` is a PARAMETER rather than a fact about the
 * caller, which is why it lives in its own file behind its own guard rather
 * than as extra branches inside the org-scoped modules — a cross-tenant
 * condition hidden in members.ts would be one refactor away from leaking.
 *
 * Mounted under `/admin/*` and gated by `fastify.requireSuperAdmin`, which
 * authenticates AND re-reads the flag from the database on every call. See the
 * docblocks in lib/superadmin.ts and plugins/auth.ts.
 *
 * NOT AUDITED — for now, and on purpose. Everything here is exactly the kind of
 * action lib/audit.ts exists to record (cross-org membership changes, deletes,
 * hours written on somebody else's record), and it will be wired to `auditLog()`
 * once the shape settles. It is left out during testing at the product owner's
 * explicit direction so the trail is not filled with throwaway fixture data.
 * `AUDIT_SUPERADMIN_ACTIONS` below is the single switch that turns it on.
 */

import type { FastifyInstance } from "fastify";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { randomBytes, randomUUID } from "node:crypto";
import { prisma } from "../lib/prisma";
import { hashPassword } from "../lib/password";
import { env } from "../env";
import { sendInviteEmail } from "../lib/mailer";
import {
  ALL_OPTIONAL,
  presentColumns,
  selectFor,
  settingsSchema,
  withDefaults,
  type OptionalColumn,
} from "./orgs";
import {
  MAX_DAYS_PER_REQUEST,
  MAX_HOURS_PER_DAY,
  derivePattern,
  formatTimeOfDay,
  planBackfill,
  rechainActivity,
  replanActivity,
  type BusySpan,
  type MemberPattern,
  type PlannedDay,
} from "../lib/backfill";
import { addDays, localDayKey, localDayStartMs, weekStartKey } from "../lib/digests";
import { effectiveEnd, workedSeconds } from "../lib/duration";
import { weightedActivity } from "../lib/activity";
import { captureSessions, platformLog, saveSnapshot } from "../lib/platform-log";

/**
 * Flip to `true` to start writing an audit trail for the actions in this file.
 * Deliberately a constant and not an env var: turning the trail on is a decision
 * about the product, not about one deployment.
 */
const AUDIT_SUPERADMIN_ACTIONS = false;

const TOKEN_TTL = "7d";
const INVITE_TTL_MS = 24 * 60 * 60 * 1000;

/** Default when an org has no timezone column/value — matches routes/orgs.ts. */
const FALLBACK_TZ = "Africa/Lagos";

const dateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");

const updateUserSchema = z.object({
  // `owner` is included where routes/members.ts excludes it. That module refuses
  // to touch an owner at all (see its 400s), which is right for an admin acting
  // inside their own org and wrong for platform staff: transferring ownership
  // after a handover is precisely the thing only this role should be able to do.
  role: z.enum(["owner", "admin", "member"]).optional(),
  status: z.enum(["invited", "active", "disabled"]).optional(),
  name: z.string().trim().min(1).max(120).optional(),
  dailyTargetMinutes: z.number().int().min(0).max(1440).nullable().optional(),
  weeklyTargetMinutes: z.number().int().min(0).max(10080).nullable().optional(),
  isSuperAdmin: z.boolean().optional(),
  /** Set a password directly. No current-password check — that is the point of the role. */
  password: z.string().min(8).max(200).optional(),
});

const inviteSchema = z.object({
  email: z.string().email(),
  // Unlike POST /auth/invite, `owner` is offered: seeding a brand-new customer
  // org with its first owner is a platform action, not an in-org one.
  role: z.enum(["owner", "admin", "member"]),
});

/**
 * The manual time-entry request.
 *
 * `mode` exists so the three shapes a supervisor actually thinks in — "that
 * Tuesday", "last week", "the 3rd to the 19th" — are each one obvious call
 * rather than the caller doing calendar arithmetic to fill in `from`/`to`.
 * They all reduce to the same inclusive range before anything is planned.
 */
const backfillSchema = z
  .object({
    userId: z.string().uuid(),
    projectId: z.string().uuid(),
    taskId: z.string().uuid().optional(),

    mode: z.enum(["day", "week", "range", "days"]).default("range"),
    /** `days` only: the exact days to write, which need not be contiguous. */
    days: z.array(dateKey).min(1).max(MAX_DAYS_PER_REQUEST).optional(),
    /** `day`: the day. `week`: any day inside the wanted week. Ignored for `range`. */
    date: dateKey.optional(),
    /** `range` only. */
    from: dateKey.optional(),
    to: dateKey.optional(),

    /** Per included day. Mutually exclusive with `totalHours`. */
    hoursPerDay: z.number().positive().max(MAX_HOURS_PER_DAY).optional(),
    /** Spread evenly across the included days — "40 hours last week". */
    totalHours: z.number().positive().max(MAX_HOURS_PER_DAY * MAX_DAYS_PER_REQUEST).optional(),

    startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
    breakMinutes: z.number().int().min(0).max(8 * 60).optional(),
    activityPct: z.number().min(0).max(100).optional(),
    activityJitter: z.number().min(0).max(50).optional(),
    includeWeekends: z.boolean().optional(),

    /**
     * `topUp` treats the hours as a TARGET and writes only what is missing,
     * fitted around whatever the member already tracked. `add` writes them
     * regardless. `replace` clears the manually-entered time in the range first
     * and writes the new figures over it — the revision case, "make last week
     * 38 hours at 50% instead of the 32 at 20% we entered".
     *
     * Default is `topUp`, because the wrong answer here silently doubles
     * somebody's week: an offsite member who ran the tracker for two hours
     * before leaving has two hours recorded, and `add` would credit ten.
     *
     * `replace` only ever removes MANUAL rows. Captured sessions are evidence —
     * hash-chained, screenshotted — and a revision request is not grounds to
     * delete them; they stay, and the new target is measured on top of them.
     */
    fill: z.enum(["topUp", "add", "replace"]).default("topUp"),
    /**
     * Let `replace` remove CAPTURED sessions too, not just manual ones.
     *
     * Off by default and separately named because it is a different act. A
     * manual row is somebody's earlier data entry and replacing it corrects a
     * mistake; a captured row is evidence — a hash chain, activity blocks, and
     * screenshots of the member's screen — and deleting it destroys the record
     * of work that genuinely happened. There is no undo.
     *
     * It exists because a super admin is sometimes correcting a period the
     * tracker got wrong (a machine left running overnight, a session that
     * double-counted), where the captured rows are exactly what has to go. That
     * is a real need, but it must be asked for in so many words rather than
     * arrived at by leaving a default alone.
     */
    replaceCaptured: z.boolean().default(false),
    /** The local window a top-up may place time inside. */
    windowStart: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
    windowEnd: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
    /**
     * Take the unspecified defaults — start time, day length, activity — from
     * this member's OWN tracked history rather than the generic ones, so entered
     * days resemble their real ones. Anything given explicitly still wins.
     */
    matchMemberPattern: z.boolean().default(true),
    /** Day-to-day variation. Lengths are renormalised, so the total is unchanged. */
    startJitterMinutes: z.number().int().min(0).max(180).optional(),
    lengthJitterPct: z.number().min(0).max(50).optional(),
    /** Defaults to the target user's org timezone. */
    timezone: z.string().min(1).max(64).optional(),

    /**
     * Whether the rows are stamped as manually entered or as ordinary tracked
     * work.
     *
     * `manual` is the honest default: `isManual: true` plus `manualReason` is
     * what tells every later reader that these hours were entered by a person
     * rather than captured by the tracker, and it is what makes them safe to
     * revise or delete later (both of those routes refuse captured rows).
     *
     * `tracked` writes them indistinguishable from real capture. It exists
     * because an offsite day entered from a paper timesheet IS the member's
     * real work and an org may not want it flagged differently in every report
     * — but it gives up the audit distinction and puts the rows behind the same
     * guards as genuine capture.
     */
    recordAs: z.enum(["manual", "tracked"]).default("manual"),
    reason: z.string().trim().min(1).max(500),
    /** What to do about a day that already has tracked time. */
    onOverlap: z.enum(["skip", "fail"]).default("skip"),
    /** Return the plan without writing anything. */
    dryRun: z.boolean().default(false),
  })
  .refine((b) => Boolean(b.hoursPerDay) !== Boolean(b.totalHours), {
    message: "Provide exactly one of hoursPerDay or totalHours",
  });

const activitySchema = z.object({
  activityPct: z.number().min(0).max(100),
  activityJitter: z.number().min(0).max(50).default(8),
});

/**
 * Resolve `mode` + its date fields into an inclusive `[from, to]` span and, for
 * `days`, the exact set inside it that should be written.
 */
export function resolveRange(body: {
  mode: "day" | "week" | "range" | "days";
  date?: string;
  days?: string[];
  from?: string;
  to?: string;
}): { from: string; to: string; only?: string[] } {
  if (body.mode === "days") {
    if (!body.days || body.days.length === 0) {
      throw new Error("`days` is required when mode is `days`");
    }
    const sorted = [...new Set(body.days)].sort();
    return { from: sorted[0], to: sorted[sorted.length - 1], only: sorted };
  }
  if (body.mode === "day") {
    if (!body.date) throw new Error("`date` is required when mode is `day`");
    return { from: body.date, to: body.date };
  }
  if (body.mode === "week") {
    if (!body.date) throw new Error("`date` is required when mode is `week`");
    // Monday-based, matching weekStartKey() and every client-side copy of it.
    const start = weekStartKey(body.date);
    return { from: start, to: addDays(start, 6) };
  }
  if (!body.from) throw new Error("`from` is required when mode is `range`");
  return { from: body.from, to: body.to ?? body.from };
}

/** The org's timezone, tolerating the column not existing yet. */
export async function orgTimezone(orgId: string): Promise<string> {
  try {
    const rows = await prisma.$queryRaw<{ timezone: string | null }[]>`
      SELECT "timezone" FROM "Organization" WHERE "id" = ${orgId}::uuid LIMIT 1
    `;
    const tz = rows[0]?.timezone;
    if (!tz) return FALLBACK_TZ;
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    return FALLBACK_TZ;
  }
}

/** Local minutes past midnight, for derivePattern. */
export function localMinutesOf(d: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(d);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0) % 24;
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return hour * 60 + minute;
}

/**
 * How this member's real tracked days look, over the 60 days before `before`.
 *
 * Manual rows are excluded deliberately. The pattern is meant to describe how
 * this person actually works, and a previous backfill is not evidence of that —
 * including it would let one guessed default reinforce itself into a habit the
 * member never had.
 */
export async function loadPattern(
  userId: string,
  timezone: string,
  before: Date
): Promise<MemberPattern | null> {
  const since = new Date(before.getTime() - 60 * 86_400_000);
  const sessions = await prisma.trackingSession.findMany({
    where: {
      userId,
      isManual: false,
      startedAt: { gte: since, lt: before },
      endedAt: { not: null },
    },
    select: {
      startedAt: true,
      endedAt: true,
      lastSyncAt: true,
      activityBlocks: {
        select: { activityPct: true, creditedSeconds: true, blockStart: true, blockEnd: true },
      },
    },
    take: 500,
  });

  return derivePattern(
    sessions.map((s) => ({
      startedAt: s.startedAt,
      endedAt: s.endedAt,
      seconds: Math.round(workedSeconds(s)),
      activityPct: weightedActivity(s.activityBlocks),
    })),
    timezone,
    localMinutesOf
  );
}

export default async function superAdminRoutes(fastify: FastifyInstance) {
  // One guard for the whole module. Registered as a preHandler hook rather than
  // repeated per route so a route added later cannot be published unguarded.
  fastify.addHook("preHandler", fastify.requireSuperAdmin);

  // ─── Organizations ────────────────────────────────────────────────────────

  /** Every org on the platform, with enough counts to pick one out of a list. */
  fastify.get("/admin/orgs", async (_req, reply) => {
    const orgs = await prisma.organization.findMany({
      select: {
        id: true,
        name: true,
        // Selected explicitly, and load-bearing: the console renders a
        // "Suspended" badge off this, and the switcher marks a frozen org in its
        // dropdown. Without it both silently render nothing at all.
        status: true,
        createdAt: true,
        _count: { select: { users: true, projects: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    return reply.send(
      orgs.map((o) => ({
        id: o.id,
        name: o.name,
        status: o.status,
        createdAt: o.createdAt,
        memberCount: o._count.users,
        projectCount: o._count.projects,
      }))
    );
  });

  /**
   * Create an organization, optionally with its first owner in the same call.
   *
   * Org creation has only ever happened through POST /auth/register, which mints
   * an org and an owner together from a self-service signup. That is the wrong
   * shape for platform staff onboarding a customer: the owner's address is known
   * but their password is not, so the account has to be INVITED rather than
   * created with a password somebody else chose.
   *
   * `ownerEmail` is therefore an invite, not a registration — the same 24-hour
   * token flow as POST /auth/invite, and the link comes back in the response so
   * it can be handed over directly.
   */
  fastify.post("/admin/orgs", async (req, reply) => {
    const body = z
      .object({
        name: z.string().trim().min(1).max(120),
        ownerEmail: z.string().email().optional(),
        timezone: z.string().min(1).max(64).optional(),
        dailyTargetMinutes: z.number().int().min(0).max(1440).optional(),
        weeklyTargetMinutes: z.number().int().min(0).max(10080).optional(),
      })
      .parse(req.body);

    if (body.timezone) {
      try {
        new Intl.DateTimeFormat("en-US", { timeZone: body.timezone });
      } catch {
        return reply.code(400).send({ error: `Unknown timezone: ${body.timezone}` });
      }
    }

    // Checked before the org is created, so a taken address does not leave an
    // empty organization behind for someone to clean up.
    if (body.ownerEmail) {
      const existing = await prisma.user.findUnique({ where: { email: body.ownerEmail } });
      if (existing && existing.status !== "invited") {
        return reply.code(409).send({ error: "Email already in use" });
      }
    }

    const have = await presentColumns();
    // `name` is pulled out of the loose bag so Prisma can see the one required
    // field it needs; the optional columns stay dynamic because whether they
    // exist is a runtime question.
    const optional: Record<string, unknown> = {};
    const data = { name: body.name, ...optional } as Prisma.OrganizationCreateInput;
    if (body.dailyTargetMinutes !== undefined) data.dailyTargetMinutes = body.dailyTargetMinutes;
    if (body.weeklyTargetMinutes !== undefined) data.weeklyTargetMinutes = body.weeklyTargetMinutes;
    // Dropped rather than refused when the column is absent — same tolerance as
    // PATCH /orgs/settings, see the long note in routes/orgs.ts.
    if (body.timezone !== undefined && have.has("timezone" as OptionalColumn)) {
      (data as Record<string, unknown>).timezone = body.timezone;
    }

    const org = await prisma.organization.create({ data, select: selectFor(have) });
    const orgId = (org as { id: string }).id;

    let invite: { email: string; inviteUrl: string; emailed: boolean } | null = null;
    if (body.ownerEmail) {
      const token = randomBytes(32).toString("hex");
      const expiresAt = new Date(Date.now() + INVITE_TTL_MS);

      await prisma.$transaction(async (tx) => {
        await tx.user.upsert({
          where: { email: body.ownerEmail! },
          create: { orgId, email: body.ownerEmail!, role: "owner", status: "invited" },
          update: { orgId, role: "owner" },
        });
        await tx.inviteToken.create({
          data: { orgId, email: body.ownerEmail!, role: "owner", token, expiresAt },
        });
      });

      const inviteUrl = `${env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/accept-invite?token=${token}`;
      const emailed = await sendInviteEmail(body.ownerEmail, inviteUrl, body.name);
      invite = { email: body.ownerEmail, inviteUrl, emailed };
    }

    await platformLog({
      actorId: req.user.userId,
      action: "org.created",
      orgId,
      details: { name: body.name, ownerEmail: body.ownerEmail ?? null },
    });

    return reply.code(201).send({ org: withDefaults(org, have), owner: invite });
  });

  /** One org in full: settings, members, projects. */
  fastify.get("/admin/orgs/:orgId", async (req, reply) => {
    const { orgId } = req.params as { orgId: string };
    const have = await presentColumns();

    const org = await prisma.organization.findUnique({
      where: { id: orgId },
      // `selectFor` covers the columns routes/orgs.ts probes for. `status` is
      // not one of those — it is guaranteed present by ensureOrgStatusColumn —
      // so it is added here rather than being threaded through that mechanism,
      // which exists specifically for columns that may be absent.
      select: { ...selectFor(have), status: true },
    });
    if (!org) return reply.code(404).send({ error: "Org not found" });

    const [members, projects] = await Promise.all([
      prisma.user.findMany({
        where: { orgId },
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          status: true,
          isSuperAdmin: true,
          createdAt: true,
          dailyTargetMinutes: true,
          weeklyTargetMinutes: true,
        },
        orderBy: { createdAt: "asc" },
      }),
      prisma.project.findMany({
        where: { orgId },
        select: { id: true, name: true, clientTag: true, archivedAt: true },
        orderBy: { name: "asc" },
      }),
    ]);

    return reply.send({ org: withDefaults(org, have), members, projects });
  });

  /**
   * Change any org's settings. Same schema and same missing-column tolerance as
   * PATCH /orgs/settings — see the long note in routes/orgs.ts for why a field
   * whose column is absent is dropped rather than 400'd.
   */
  fastify.patch("/admin/orgs/:orgId/settings", async (req, reply) => {
    const { orgId } = req.params as { orgId: string };
    const body = settingsSchema.parse(req.body);
    const have = await presentColumns();

    const exists = await prisma.organization.count({ where: { id: orgId } });
    if (exists === 0) return reply.code(404).send({ error: "Org not found" });

    const data: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(body)) {
      if (value === undefined) continue;
      if ((ALL_OPTIONAL as string[]).includes(key) && !have.has(key as OptionalColumn)) continue;
      data[key] = value;
    }

    const org = await prisma.organization.update({
      where: { id: orgId },
      data,
      select: selectFor(have),
    });

    await platformLog({
      actorId: req.user.userId,
      action: "org.settings_changed",
      orgId,
      details: { changed: Object.keys(data) },
    });

    return reply.send(withDefaults(org, have));
  });

  /**
   * Delete an organization and everything inside it. Irreversible.
   *
   * Requires the org's own name echoed back in `confirm`. A UUID in a URL is
   * easy to paste wrong and there is no undo — the name is the one thing the
   * caller has to have actually looked at.
   *
   * Children are removed explicitly, deepest first, because almost every FK in
   * schema.prisma is the implicit `Restrict`: the handful that are `SetNull`
   * (TrackingSession.userId, Notification.userId, Screenshot.deletedById,
   * AuditLog.actorId) exist to let ONE member be deleted while their work
   * survives, which is the opposite of what is wanted here.
   */
  fastify.delete("/admin/orgs/:orgId", async (req, reply) => {
    const { orgId } = req.params as { orgId: string };
    const body = z.object({ confirm: z.string() }).parse(req.body ?? {});

    const org = await prisma.organization.findUnique({ where: { id: orgId } });
    if (!org) return reply.code(404).send({ error: "Org not found" });
    if (body.confirm !== org.name) {
      return reply.code(400).send({ error: "Confirmation does not match the organization name" });
    }

    const sessionScope = { session: { project: { orgId } } };
    const userScope = { user: { orgId } };

    // Sequential, not one $transaction: CockroachDB will not take this many
    // dependent DDL-adjacent deletes in a single implicit transaction on a large
    // org, and a partial delete is recoverable by re-running this call.
    const deleted: Record<string, number> = {};
    const step = async (label: string, run: () => Promise<{ count: number }>) => {
      deleted[label] = (await run()).count;
    };

    await step("screenshots", () => prisma.screenshot.deleteMany({ where: sessionScope }));
    await step("flags", () => prisma.unusualActivityFlag.deleteMany({ where: sessionScope }));
    await step("activityBlocks", () => prisma.activityBlock.deleteMany({ where: sessionScope }));
    await step("appUsage", () => prisma.appUsage.deleteMany({ where: sessionScope }));
    await step("urlUsage", () => prisma.urlUsage.deleteMany({ where: sessionScope }));
    await step("idleDiscards", () => prisma.idleDiscard.deleteMany({ where: sessionScope }));
    await step("timeNotes", () => prisma.timeNote.deleteMany({ where: sessionScope }));
    await step("sessions", () =>
      prisma.trackingSession.deleteMany({ where: { project: { orgId } } })
    );
    await step("devices", () => prisma.device.deleteMany({ where: userScope }));
    await step("projectMembers", () =>
      prisma.projectMember.deleteMany({ where: { project: { orgId } } })
    );
    await step("tasks", () => prisma.task.deleteMany({ where: { project: { orgId } } }));
    await step("notifications", () => prisma.notification.deleteMany({ where: { orgId } }));
    await step("auditLogs", () => prisma.auditLog.deleteMany({ where: { orgId } }));
    await step("invites", () => prisma.inviteToken.deleteMany({ where: { orgId } }));
    await step("passwordResets", () => prisma.passwordResetToken.deleteMany({ where: userScope }));
    await step("projects", () => prisma.project.deleteMany({ where: { orgId } }));
    await step("users", () => prisma.user.deleteMany({ where: { orgId } }));

    await prisma.organization.delete({ where: { id: orgId } });

    // Logged with the org's NAME, not just its id: after this line the id
    // resolves to nothing, and "some org was deleted" is not a record.
    await platformLog({
      actorId: req.user.userId,
      action: "org.deleted",
      orgId,
      details: { orgName: org.name, deleted },
    });

    return reply.send({ ok: true, deleted });
  });

  // ─── Users, across every org ──────────────────────────────────────────────

  /** Search users platform-wide. `?orgId=` narrows, `?q=` matches email or name. */
  fastify.get("/admin/users", async (req, reply) => {
    const q = req.query as { orgId?: string; q?: string; limit?: string };
    const limit = Math.min(Number(q.limit) || 100, 500);

    const users = await prisma.user.findMany({
      where: {
        ...(q.orgId ? { orgId: q.orgId } : {}),
        ...(q.q
          ? {
              OR: [
                { email: { contains: q.q, mode: "insensitive" as const } },
                { name: { contains: q.q, mode: "insensitive" as const } },
              ],
            }
          : {}),
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        status: true,
        isSuperAdmin: true,
        orgId: true,
        createdAt: true,
        org: { select: { name: true } },
      },
      orderBy: { createdAt: "desc" },
      take: limit,
    });

    return reply.send(
      users.map((u) => ({ ...u, orgName: u.org.name, org: undefined }))
    );
  });

  /**
   * Change any user in any org — role (owner included), status, targets, name,
   * password, and platform access itself.
   *
   * None of members.ts's owner protections apply here. Those exist to stop one
   * admin quietly demoting the person who owns the account; platform staff
   * performing a handover is the case they were never meant to block.
   */
  fastify.patch("/admin/users/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = updateUserSchema.parse(req.body);

    const target = await prisma.user.findUnique({ where: { id } });
    if (!target) return reply.code(404).send({ error: "User not found" });

    // The one self-protection worth keeping: a super admin cannot revoke their
    // own platform access. With one super admin configured that is a locked
    // door with the key inside — recoverable only by redeploying with
    // SUPERADMIN_EMAILS, which is not a thing to discover at 2am.
    if (body.isSuperAdmin === false && id === req.user.userId) {
      return reply
        .code(400)
        .send({ error: "You cannot remove your own super admin access" });
    }

    const data: Record<string, unknown> = {};
    if (body.role !== undefined) data.role = body.role;
    if (body.status !== undefined) data.status = body.status;
    if (body.name !== undefined) data.name = body.name;
    if (body.dailyTargetMinutes !== undefined) data.dailyTargetMinutes = body.dailyTargetMinutes;
    if (body.weeklyTargetMinutes !== undefined) data.weeklyTargetMinutes = body.weeklyTargetMinutes;
    if (body.isSuperAdmin !== undefined) data.isSuperAdmin = body.isSuperAdmin;
    if (body.password !== undefined) data.passwordHash = await hashPassword(body.password);

    const updated = await prisma.user.update({
      where: { id },
      data,
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        status: true,
        isSuperAdmin: true,
        orgId: true,
        dailyTargetMinutes: true,
        weeklyTargetMinutes: true,
      },
    });

    // Every outstanding reset link is burned when a password is set from here,
    // so a link already sitting in an inbox cannot undo the change.
    if (body.password !== undefined) {
      await prisma.passwordResetToken.updateMany({
        where: { userId: id, usedAt: null },
        data: { usedAt: new Date() },
      });
    }

    await platformLog({
      actorId: req.user.userId,
      action:
        body.isSuperAdmin === true
          ? "superadmin.granted"
          : body.isSuperAdmin === false
            ? "superadmin.revoked"
            : "user.updated",
      orgId: target.orgId,
      details: {
        targetEmail: target.email,
        changed: Object.keys(data),
        // Never the password itself, and not a hash either — only that one was set.
        passwordSet: body.password !== undefined,
        ...(body.role ? { role: { from: target.role, to: body.role } } : {}),
        ...(body.status ? { status: { from: target.status, to: body.status } } : {}),
      },
    });

    return reply.send(updated);
  });

  /**
   * Hard-delete any user in any org, owner included.
   *
   * The same shape as DELETE /members/:id: the work they tracked survives with
   * `userId` set to NULL and stays reachable through its project (see the
   * SetNull FKs and lib/org-scope.ts). Only the rows that mean nothing without
   * them are removed, since both are required FKs that would block the delete.
   */
  fastify.delete("/admin/users/:id", async (req, reply) => {
    const { id } = req.params as { id: string };

    const target = await prisma.user.findUnique({ where: { id } });
    if (!target) return reply.code(404).send({ error: "User not found" });
    if (target.id === req.user.userId) {
      return reply.code(400).send({ error: "You cannot delete your own account" });
    }

    await prisma.$transaction([
      prisma.projectMember.deleteMany({ where: { userId: id } }),
      prisma.passwordResetToken.deleteMany({ where: { userId: id } }),
      prisma.user.delete({ where: { id } }),
    ]);

    await platformLog({
      actorId: req.user.userId,
      action: "user.deleted",
      orgId: target.orgId,
      details: { targetEmail: target.email, role: target.role, status: target.status },
    });

    return reply.code(204).send();
  });

  /**
   * Invite someone into ANY org, at any role — the cross-org counterpart of
   * POST /auth/invite, which can only ever invite into the caller's own.
   */
  fastify.post("/admin/orgs/:orgId/invite", async (req, reply) => {
    const { orgId } = req.params as { orgId: string };
    const body = inviteSchema.parse(req.body);

    const org = await prisma.organization.findUnique({ where: { id: orgId } });
    if (!org) return reply.code(404).send({ error: "Org not found" });

    const existing = await prisma.user.findUnique({ where: { email: body.email } });
    if (existing && existing.status !== "invited") {
      return reply.code(409).send({ error: "Email already in use" });
    }

    const token = randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + INVITE_TTL_MS);

    await prisma.$transaction(async (tx) => {
      await tx.user.upsert({
        where: { email: body.email },
        create: { orgId, email: body.email, role: body.role, status: "invited" },
        update: { orgId, role: body.role },
      });
      // Supersede any earlier unaccepted token, exactly as POST /auth/invite
      // does — otherwise a resend widens the window instead of moving it.
      await tx.inviteToken.updateMany({
        where: { email: body.email, acceptedAt: null, expiresAt: { gt: new Date() } },
        data: { expiresAt: new Date() },
      });
      await tx.inviteToken.create({
        data: { orgId, email: body.email, role: body.role, token, expiresAt },
      });
    });

    const inviteUrl = `${env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/accept-invite?token=${token}`;
    const emailed = await sendInviteEmail(body.email, inviteUrl, org.name);

    // The link comes back either way here, unlike POST /auth/invite which only
    // returns it on a delivery failure. Platform staff seeding an org routinely
    // need to hand the link over by another channel.
    await platformLog({
      actorId: req.user.userId,
      action: "user.invited",
      orgId,
      details: { email: body.email, role: body.role, orgName: org.name, emailed },
    });

    return reply.code(201).send({ ok: true, emailed, inviteUrl });
  });

  /**
   * Mint a token for any user — support access, "what do they actually see".
   *
   * The token is an ordinary one for that account with that account's own org
   * role, so it grants nothing the person themselves does not have. It never
   * carries `superAdmin`, whoever it is minted for: an impersonation session
   * that could reach these routes would be a way to launder a platform action
   * into looking like somebody else's.
   */
  fastify.post("/admin/impersonate/:userId", async (req, reply) => {
    const { userId } = req.params as { userId: string };

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, orgId: true, role: true, email: true, status: true },
    });
    if (!user) return reply.code(404).send({ error: "User not found" });
    if (user.status !== "active") {
      return reply.code(400).send({ error: "That account is not active" });
    }

    const token = fastify.jwt.sign(
      { userId: user.id, orgId: user.orgId, role: user.role },
      { expiresIn: TOKEN_TTL }
    );

    // Recorded before the token is handed over. Minting a credential for
    // somebody else's account is the single most sensitive thing on this
    // surface, and it is the one action whose trail must not depend on what the
    // holder does with it afterwards.
    await platformLog({
      actorId: req.user.userId,
      action: "user.impersonated",
      orgId: user.orgId,
      details: { targetEmail: user.email, targetRole: user.role },
    });

    return reply.send({
      token,
      user: { id: user.id, email: user.email, role: user.role, orgId: user.orgId },
    });
  });

  // ─── Manual hours and activity, for any staff in any org ──────────────────

  /**
   * Write tracked time onto somebody else's record.
   *
   * The case this exists for: staff working offsite are not running the tracker,
   * their hours are taken on paper, and a supervisor enters them afterwards.
   * `POST /sessions/manual` cannot serve that — it writes one session, for the
   * CALLER, in the caller's own org, from two explicit instants.
   *
   * What this adds:
   *   - a target user in any organization;
   *   - a day, a week, or an arbitrary range in one call (see `resolveRange`);
   *   - activity blocks, hash-chained like real ones, so the entry has an
   *     activity percentage instead of reading as hours with no work behind them
   *     (lib/backfill.ts);
   *   - a per-day overlap check, so re-running a week after fixing one day
   *     tops up the gaps rather than double-crediting the days already entered.
   *
   * The sessions it writes carry `isManual: true` and the caller's `reason` in
   * `manualReason`, so nothing here is disguised as tracker-captured work.
   */
  fastify.post("/admin/time", async (req, reply) => {
    const body = backfillSchema.parse(req.body);

    let range: { from: string; to: string; only?: string[] };
    try {
      range = resolveRange(body);
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : "Invalid range" });
    }

    const user = await prisma.user.findUnique({
      where: { id: body.userId },
      select: { id: true, email: true, orgId: true },
    });
    if (!user) return reply.code(404).send({ error: "User not found" });

    // The project must belong to the TARGET's org, not the caller's. This is the
    // one check that keeps a cross-org route from stitching one org's hours onto
    // another org's project, which would put them in that org's reports.
    const project = await prisma.project.findUnique({ where: { id: body.projectId } });
    if (!project || project.orgId !== user.orgId) {
      return reply.code(404).send({ error: "Project not found in that user's organization" });
    }
    if (body.taskId) {
      const task = await prisma.task.findUnique({ where: { id: body.taskId } });
      if (!task || task.projectId !== project.id) {
        return reply.code(404).send({ error: "Task not found on that project" });
      }
    }

    const timezone = body.timezone ?? (await orgTimezone(user.orgId));
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: timezone });
    } catch {
      return reply.code(400).send({ error: `Unknown timezone: ${timezone}` });
    }

    // Everything this member already has in the range, loaded BEFORE planning
    // rather than checked after it. In `topUp` mode the plan is a function of
    // what is already there — the shortfall and where it fits — so it cannot be
    // computed and then reconciled afterwards.
    const rangeFrom = new Date(localDayStartMs(range.from, timezone));
    const rangeTo = new Date(localDayStartMs(addDays(range.to, 1), timezone));
    const existing = await prisma.trackingSession.findMany({
      where: {
        userId: user.id,
        startedAt: { lt: rangeTo },
        OR: [{ endedAt: null }, { endedAt: { gt: rangeFrom } }],
      },
      select: { id: true, startedAt: true, endedAt: true, lastSyncAt: true, isManual: true },
    });
    const manualIds = new Set(existing.filter((sn) => sn.isManual).map((sn) => sn.id));

    // An open session counts as running to its last evidence of life, not to
    // `now` — the whole point of effectiveEnd(). Treating it as "still running"
    // would make one forgotten row block a fortnight of legitimate entry.
    // `replace` revises what was entered before, so the manual rows in range are
    // not "busy" — they are what is being superseded. Captured rows still are:
    // the new target is measured on top of real tracking, never instead of it.
    const superseded =
      body.fill === "replace"
        ? existing.filter((sn) => body.replaceCaptured || manualIds.has(sn.id))
        : [];
    const supersededIds = new Set(superseded.map((sn) => sn.id));

    const busy: BusySpan[] = existing
      .filter((sn) => !supersededIds.has(sn.id))
      .map((sn) => ({
        startMs: sn.startedAt.getTime(),
        endMs: effectiveEnd(sn).getTime(),
      }));

    // Defaults drawn from this member's own tracked history, so entered days
    // resemble their real ones. Anything the caller specified still wins — the
    // pattern only fills in what was left unsaid.
    const pattern = body.matchMemberPattern
      ? await loadPattern(user.id, timezone, rangeFrom)
      : null;
    // Below three days the "pattern" is one or two sessions, which is not a
    // habit — fall back to the generic defaults rather than copying an outlier.
    const usablePattern = pattern && pattern.sampleDays >= 3 ? pattern : null;

    const startTime = body.startTime ?? (usablePattern ? formatTimeOfDay(usablePattern.startMinutes) : undefined);
    const activityPct = body.activityPct ?? usablePattern?.activityPct;

    // `totalHours` is spread over the days that will actually be INCLUDED, so
    // "40 hours last week" with weekends off is five 8-hour days, not seven
    // 5h43m ones of which two are then dropped.
    let hoursPerDay = body.hoursPerDay ?? 0;
    if (body.totalHours) {
      const probe = planBackfill({
        ...range,
        hoursPerDay: 1,
        includeWeekends: body.includeWeekends,
        timezone,
        sessionIdFor: () => randomUUID(),
      });
      const includedDays = new Set(probe.map((d) => d.dayKey)).size;
      if (includedDays === 0) {
        return reply.code(400).send({ error: "That range contains no working days" });
      }
      hoursPerDay = body.totalHours / includedDays;
      if (hoursPerDay > MAX_HOURS_PER_DAY) {
        return reply
          .code(400)
          .send({ error: `That works out to more than ${MAX_HOURS_PER_DAY} hours a day` });
      }
    }

    let plan: PlannedDay[];
    try {
      plan = planBackfill({
        ...range,
        hoursPerDay,
        startTime,
        breakMinutes: body.breakMinutes,
        activityPct,
        activityJitter: body.activityJitter,
        includeWeekends: body.includeWeekends,
        timezone,
        // `replace` plans like `add` — the rows it would otherwise have topped up
        // against are the ones being removed, so the requested figure is written
        // in full. What survives in `busy` is captured time, which `topUp`
        // semantics would then work around; that is handled by planning `add`
        // and letting the clash check below refuse a genuine collision.
        fill: body.fill === "replace" ? "add" : body.fill,
        busy,
        ...(body.windowStart && body.windowEnd
          ? { dayWindow: { start: body.windowStart, end: body.windowEnd } }
          : {}),
        startJitterMinutes: body.startJitterMinutes,
        lengthJitterPct: body.lengthJitterPct,
        sessionIdFor: () => randomUUID(),
      });
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : "Invalid plan" });
    }

    if (plan.length === 0) {
      return reply.send({
        written: false,
        reason:
          body.fill === "topUp"
            ? "every day in that range already meets the target"
            : "that range contains no working days",
        range,
        timezone,
        pattern: usablePattern,
      });
    }

    // Nothing may be dated into the future — the same rule POST /sessions/manual
    // enforces, and for the same reason: hours nobody has worked yet.
    const now = Date.now();
    if (plan.some((d) => d.endedAt.getTime() > now)) {
      return reply.code(400).send({ error: "That range extends into the future" });
    }

    // In `topUp` mode the plan was built out of the free gaps, so nothing here
    // should clash. Checked anyway: this is the guard against double-crediting
    // somebody's hours, and it is worth re-asserting rather than assuming the
    // planner got it right.
    const clashes = (day: PlannedDay) =>
      busy.filter((b) => b.startMs < day.endedAt.getTime() && b.endMs > day.startedAt.getTime());

    const conflicted = plan.filter((d) => clashes(d).length > 0);
    if (conflicted.length > 0 && body.onOverlap === "fail") {
      return reply.code(409).send({
        error: "Some days already have tracked time",
        days: [...new Set(conflicted.map((d) => d.dayKey))],
      });
    }

    const writable = plan.filter((d) => clashes(d).length === 0);
    const skipped = [...new Set(conflicted.map((d) => d.dayKey))];

    const summary = {
      user: { id: user.id, email: user.email, orgId: user.orgId },
      project: { id: project.id, name: project.name },
      timezone,
      range,
      hoursPerDay: +hoursPerDay.toFixed(4),
      days: writable.map((d) => ({
        dayKey: d.dayKey,
        sessionId: d.sessionId,
        startedAt: d.startedAt,
        endedAt: d.endedAt,
        seconds: d.seconds,
        blocks: d.blocks.length,
      })),
      skippedDays: skipped,
      totalSeconds: writable.reduce((sum, d) => sum + d.seconds, 0),
      fill: body.fill,
      // Echoed back so the caller can see WHY the shape came out as it did —
      // which defaults were taken from the member's own history and which were
      // the generic ones. Null means there was not enough history to learn from.
      pattern: usablePattern,
      alreadyTrackedSeconds: Math.round(
        busy.reduce((sum, b) => sum + (b.endMs - b.startMs) / 1000, 0)
      ),
      // What `replace` is about to remove. Reported even on a dry run, because
      // "this will delete 4 entries totalling 32 hours" is the single most
      // important thing to see before confirming a revision.
      supersededSessions: superseded.map((sn) => ({
        id: sn.id,
        startedAt: sn.startedAt,
        endedAt: sn.endedAt,
        seconds: Math.round(workedSeconds(sn)),
        isManual: sn.isManual,
      })),
      supersededSeconds: superseded.reduce((sum, sn) => sum + Math.round(workedSeconds(sn)), 0),
      // Called out separately from the count above, because this is the number
      // that cannot be undone: captured rows carry screenshots and a hash chain.
      supersededCaptured: superseded.filter((sn) => !sn.isManual).length,
    };

    if (body.dryRun) return reply.send({ ...summary, dryRun: true, written: false });
    if (writable.length === 0) {
      return reply.send({ ...summary, written: false, reason: "every day already had time" });
    }

    // Snapshot before destroying anything, and REFUSE if it cannot be stored.
    //
    // Proceeding without a snapshot would be the worst of both worlds: the
    // operator has been told there is an undo, so they approve a delete they
    // would otherwise have thought twice about, and then there is no undo. A
    // 503 that changes nothing is the honest failure.
    let snapshotId: string | null = null;
    if (superseded.length > 0) {
      const snapshot = await saveSnapshot({
        actorId: req.user.userId,
        kind: "time.replace",
        userId: user.id,
        orgId: user.orgId,
        payload: await captureSessions(superseded.map((sn) => sn.id)),
      });
      if (!snapshot) {
        return reply.code(503).send({
          error:
            "Could not store an undo snapshot, so nothing was changed. Check that PlatformSnapshot exists.",
        });
      }
      snapshotId = snapshot.id;
    }

    // Clear the superseded manual rows first. Their children go with them — the
    // activity blocks are the whole reason a stale row would keep showing the
    // old percentage after the hours had been revised.
    for (const sn of superseded) {
      await prisma.$transaction([
        prisma.screenshot.deleteMany({ where: { sessionId: sn.id } }),
        prisma.unusualActivityFlag.deleteMany({ where: { sessionId: sn.id } }),
        prisma.activityBlock.deleteMany({ where: { sessionId: sn.id } }),
        prisma.appUsage.deleteMany({ where: { sessionId: sn.id } }),
        prisma.urlUsage.deleteMany({ where: { sessionId: sn.id } }),
        prisma.idleDiscard.deleteMany({ where: { sessionId: sn.id } }),
        prisma.timeNote.deleteMany({ where: { sessionId: sn.id } }),
        prisma.trackingSession.delete({ where: { id: sn.id } }),
      ]);
    }

    // One device for the whole backfill, labelled so these rows are identifiable
    // as entered rather than captured. `platform: "manual"` is what
    // POST /sessions/manual already uses.
    const device = await prisma.device.create({
      data: {
        userId: user.id,
        platform: body.recordAs === "manual" ? "manual" : "desktop",
        appVersion: "superadmin",
      },
    });

    for (const day of writable) {
      // Per day, not one transaction for the whole week: a 31-day range is
      // thousands of blocks, and CockroachDB will refuse a transaction that
      // large. A day is the unit the caller thinks in, so a day is the unit
      // that either lands or does not.
      await prisma.$transaction([
        prisma.trackingSession.create({
          data: {
            id: day.sessionId,
            userId: user.id,
            projectId: project.id,
            taskId: body.taskId,
            deviceId: device.id,
            startedAt: day.startedAt,
            endedAt: day.endedAt,
            endReason: "stopped",
            isManual: body.recordAs === "manual",
            // The reason is recorded either way. On a `tracked` row it does not
            // show as a manual note, but it is still the only trace of why this
            // time exists, and dropping it would make the row unexplainable.
            manualReason: body.reason,
          },
        }),
        prisma.activityBlock.createMany({
          data: day.blocks.map((b) => ({
            sessionId: day.sessionId,
            blockStart: b.blockStart,
            blockEnd: b.blockEnd,
            keyboardPct: b.keyboardPct,
            mousePct: b.mousePct,
            activityPct: b.activityPct,
            idleSeconds: b.idleSeconds,
            sequenceNo: b.sequenceNo,
            prevHash: b.prevHash,
            hash: b.hash,
            creditedSeconds: b.creditedSeconds,
          })),
        }),
      ]);
    }

    await platformLog({
      actorId: req.user.userId,
      action: superseded.length > 0 ? "time.replaced" : "time.written",
      orgId: user.orgId,
      details: {
        targetEmail: user.email,
        project: project.name,
        range,
        days: writable.length,
        totalSeconds: summary.totalSeconds,
        supersededSessions: superseded.length,
        supersededCaptured: summary.supersededCaptured,
        recordAs: body.recordAs,
        fill: body.fill,
        reason: body.reason,
        snapshotId,
      },
    });

    return reply.code(201).send({ ...summary, written: true, snapshotId });
  });

  /**
   * Correct the activity percentage recorded against an existing session.
   *
   * A rewrite of the whole chain, not an edit of one block — schema.prisma's own
   * note says `activityPct` sits inside the hash and is not ours to change, and
   * editing one block in place would break every link after it and leave the
   * session reading as tampered-with. See `replanActivity` in lib/backfill.ts.
   *
   * Restricted to manual sessions. Rewriting the measured activity of a session
   * the tracker actually captured would destroy evidence — the hash chain exists
   * precisely so that captured blocks cannot be quietly altered, and a route
   * that bypasses it for real sessions would make the guarantee worthless.
   */
  fastify.patch("/admin/sessions/:id/activity", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = activitySchema.parse(req.body);

    const session = await prisma.trackingSession.findUnique({ where: { id } });
    if (!session) return reply.code(404).send({ error: "Session not found" });
    if (!session.isManual) {
      return reply.code(400).send({
        error:
          "Only manually-entered sessions can have their activity rewritten — a captured session's blocks are hash-chained evidence",
      });
    }
    if (!session.endedAt) {
      return reply.code(400).send({ error: "That session is still open" });
    }

    const blocks = replanActivity(
      session.id,
      session.startedAt,
      session.endedAt,
      body.activityPct,
      body.activityJitter
    );

    await prisma.$transaction([
      // Screenshots hang off blocks, so they go first. A manual session has none
      // (nothing captured them), but the delete has to be ordered correctly for
      // the FK regardless.
      prisma.screenshot.deleteMany({ where: { sessionId: id } }),
      prisma.activityBlock.deleteMany({ where: { sessionId: id } }),
      prisma.activityBlock.createMany({
        data: blocks.map((b) => ({
          sessionId: id,
          blockStart: b.blockStart,
          blockEnd: b.blockEnd,
          keyboardPct: b.keyboardPct,
          mousePct: b.mousePct,
          activityPct: b.activityPct,
          idleSeconds: b.idleSeconds,
          sequenceNo: b.sequenceNo,
          prevHash: b.prevHash,
          hash: b.hash,
          creditedSeconds: b.creditedSeconds,
        })),
      }),
    ]);

    return reply.send({ sessionId: id, blocks: blocks.length, activityPct: body.activityPct });
  });

  /**
   * Set activity across a whole period for one person — the counterpart of
   * POST /admin/time, for when the hours are already right and only the
   * activity figure is wrong.
   *
   * The two are deliberately separate endpoints rather than optional halves of
   * one: writing hours creates rows, and rewriting activity edits rows that
   * already exist. Collapsing them would mean a request that silently did
   * either depending on which fields were filled in, on a surface where the
   * difference is somebody's timesheet.
   *
   * Manual sessions only, and the same day/week/range/days selector as
   * POST /admin/time so the two are driven the same way.
   */
  fastify.patch("/admin/users/:id/activity", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = z
      .object({
        mode: z.enum(["day", "week", "range", "days"]).default("range"),
        date: dateKey.optional(),
        days: z.array(dateKey).min(1).max(MAX_DAYS_PER_REQUEST).optional(),
        from: dateKey.optional(),
        to: dateKey.optional(),
        activityPct: z.number().min(0).max(100),
        activityJitter: z.number().min(0).max(50).default(8),
        /**
         * Include captured sessions, not just manually-entered ones.
         *
         * Captured blocks are rewritten IN PLACE — same rows, same ids, same
         * spans, only the percentages change and the chain is recomputed over
         * them. That is not a stylistic choice: `Screenshot.activityBlockId` is
         * a required FK, so the delete-and-regenerate path used for manual
         * sessions would take every screenshot on the session with it. On a real
         * tracked week that is hundreds of images destroyed to change a number.
         */
        includeCaptured: z.boolean().default(false),
        dryRun: z.boolean().default(false),
      })
      .parse(req.body);

    const user = await prisma.user.findUnique({
      where: { id },
      select: { id: true, email: true, orgId: true },
    });
    if (!user) return reply.code(404).send({ error: "User not found" });

    let range: { from: string; to: string; only?: string[] };
    try {
      range = resolveRange(body);
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : "Invalid range" });
    }

    const timezone = await orgTimezone(user.orgId);
    const rangeFrom = new Date(localDayStartMs(range.from, timezone));
    const rangeTo = new Date(localDayStartMs(addDays(range.to, 1), timezone));
    const only = range.only ? new Set(range.only) : null;

    const sessions = await prisma.trackingSession.findMany({
      where: {
        userId: id,
        ...(body.includeCaptured ? {} : { isManual: true }),
        endedAt: { not: null },
        startedAt: { lt: rangeTo, gte: rangeFrom },
      },
      select: {
        id: true,
        startedAt: true,
        endedAt: true,
        isManual: true,
        _count: { select: { screenshots: true } },
        activityBlocks: {
          select: { id: true, sequenceNo: true, blockStart: true, blockEnd: true },
          orderBy: { sequenceNo: "asc" },
        },
      },
      orderBy: { startedAt: "asc" },
    });

    // With `mode: "days"` the span between the first and last named day also
    // contains the days that were NOT named, so the set has to be re-applied
    // after the query rather than trusted from the range alone.
    const targets = sessions.filter(
      (sn) => !only || only.has(localDayKey(sn.startedAt, timezone))
    );

    if (targets.length === 0) {
      return reply.send({
        user,
        range,
        timezone,
        updated: 0,
        reason: "no manually-entered sessions in that period",
      });
    }

    const summary = {
      user,
      range,
      timezone,
      activityPct: body.activityPct,
      sessions: targets.map((sn) => ({
        id: sn.id,
        dayKey: localDayKey(sn.startedAt, timezone),
        startedAt: sn.startedAt,
        endedAt: sn.endedAt,
        isManual: sn.isManual,
        existingBlocks: sn.activityBlocks.length,
        screenshots: sn._count.screenshots,
        // Says which of the two paths below this session will take, so a dry run
        // makes the screenshot consequence visible before anything happens.
        strategy: sn.activityBlocks.length > 0 ? "rechain-in-place" : "generate",
      })),
    };

    if (body.dryRun) return reply.send({ ...summary, updated: 0, dryRun: true });

    let updated = 0;
    let rechained = 0;
    let generated = 0;

    for (const sn of targets) {
      if (!sn.endedAt) continue;

      if (sn.activityBlocks.length > 0) {
        // The session already has blocks — rewrite them where they are, so the
        // screenshots hanging off them survive. Sequence order matters: the
        // chain is recomputed in `sequenceNo` order, which is how the query
        // above returns them.
        const blocks = rechainActivity(
          sn.id,
          sn.activityBlocks,
          body.activityPct,
          body.activityJitter
        );
        await prisma.$transaction(
          blocks.map((b) =>
            prisma.activityBlock.update({
              where: { id: b.id },
              data: {
                keyboardPct: b.keyboardPct,
                mousePct: b.mousePct,
                activityPct: b.activityPct,
                idleSeconds: b.idleSeconds,
                prevHash: b.prevHash,
                hash: b.hash,
              },
            })
          )
        );
        rechained += 1;
      } else {
        // No blocks at all — a manual entry written before activity was
        // generated for them. There is nothing to preserve and nothing to
        // destroy, so the session gets a fresh chain covering its span.
        const blocks = replanActivity(
          sn.id,
          sn.startedAt,
          sn.endedAt,
          body.activityPct,
          body.activityJitter
        );
        await prisma.activityBlock.createMany({
          data: blocks.map((b) => ({
            sessionId: sn.id,
            blockStart: b.blockStart,
            blockEnd: b.blockEnd,
            keyboardPct: b.keyboardPct,
            mousePct: b.mousePct,
            activityPct: b.activityPct,
            idleSeconds: b.idleSeconds,
            sequenceNo: b.sequenceNo,
            prevHash: b.prevHash,
            hash: b.hash,
            creditedSeconds: b.creditedSeconds,
          })),
        });
        generated += 1;
      }
      updated += 1;
    }

    await platformLog({
      actorId: req.user.userId,
      action: "activity.rewritten",
      orgId: user.orgId,
      details: {
        targetEmail: user.email,
        range,
        activityPct: body.activityPct,
        includeCaptured: body.includeCaptured,
        updated,
        rechained,
        generated,
      },
    });

    return reply.send({ ...summary, updated, rechained, generated });
  });

  /**
   * Remove a manually-entered session outright — the undo for a backfill that
   * went in wrong. Manual only, for the same reason as the route above.
   */
  fastify.delete("/admin/sessions/:id", async (req, reply) => {
    const { id } = req.params as { id: string };

    const session = await prisma.trackingSession.findUnique({ where: { id } });
    if (!session) return reply.code(404).send({ error: "Session not found" });
    if (!session.isManual) {
      return reply
        .code(400)
        .send({ error: "Only manually-entered sessions can be deleted here" });
    }

    await prisma.$transaction([
      prisma.screenshot.deleteMany({ where: { sessionId: id } }),
      prisma.unusualActivityFlag.deleteMany({ where: { sessionId: id } }),
      prisma.activityBlock.deleteMany({ where: { sessionId: id } }),
      prisma.appUsage.deleteMany({ where: { sessionId: id } }),
      prisma.urlUsage.deleteMany({ where: { sessionId: id } }),
      prisma.idleDiscard.deleteMany({ where: { sessionId: id } }),
      prisma.timeNote.deleteMany({ where: { sessionId: id } }),
      prisma.trackingSession.delete({ where: { id } }),
    ]);

    await platformLog({
      actorId: req.user.userId,
      action: "session.deleted",
      details: { sessionId: id, startedAt: session.startedAt, endedAt: session.endedAt },
    });

    return reply.code(204).send();
  });

  /**
   * What a user's recorded time actually looks like over a range — the readback
   * for the routes above, so an entry can be checked without leaving the API.
   */
  fastify.get("/admin/users/:id/time", async (req, reply) => {
    const { id } = req.params as { id: string };
    const q = req.query as { from?: string; to?: string };

    const user = await prisma.user.findUnique({
      where: { id },
      select: { id: true, email: true, orgId: true },
    });
    if (!user) return reply.code(404).send({ error: "User not found" });

    const timezone = await orgTimezone(user.orgId);
    const from = q.from ? new Date(q.from) : new Date(Date.now() - 30 * 86_400_000);
    const to = q.to ? new Date(q.to) : new Date();

    const sessions = await prisma.trackingSession.findMany({
      where: {
        userId: id,
        startedAt: { lte: to },
        OR: [{ endedAt: null }, { endedAt: { gte: from } }],
      },
      select: {
        id: true,
        startedAt: true,
        endedAt: true,
        lastSyncAt: true,
        isManual: true,
        manualReason: true,
        project: { select: { id: true, name: true } },
        // `blockEnd` is not decoration: workedSeconds() reads the blocks as
        // evidence of life when a session has no `endedAt`, so omitting it
        // would silently mis-measure any still-open row in the range.
        activityBlocks: { select: { activityPct: true, creditedSeconds: true, blockEnd: true } },
      },
      orderBy: { startedAt: "desc" },
    });

    return reply.send({
      user,
      timezone,
      sessions: sessions.map((s) => ({
        id: s.id,
        dayKey: localDayKey(s.startedAt, timezone),
        project: s.project,
        startedAt: s.startedAt,
        endedAt: s.endedAt,
        seconds: Math.round(workedSeconds(s)),
        isManual: s.isManual,
        manualReason: s.manualReason,
        blocks: s.activityBlocks.length,
      })),
    });
  });
}
