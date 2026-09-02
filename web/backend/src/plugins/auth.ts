import fp from "fastify-plugin";
import fastifyJwt from "@fastify/jwt";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { env } from "../env";
import { isSuperAdmin } from "../lib/superadmin";
import { prisma } from "../lib/prisma";
import {
  ACTING_ORG_ECHO_HEADER,
  ACTING_ORG_ROLE,
  resolveActingOrg,
} from "../lib/acting-org";

export interface JwtPayload {
  userId: string;
  orgId: string;
  role: "owner" | "admin" | "member";
  /**
   * Platform-level access, orthogonal to `role` — see lib/superadmin.ts.
   *
   * Carried so a client can render the staff console without an extra call, and
   * optional so a token minted before this existed still verifies. It is NOT
   * what authorises anything: `requireSuperAdmin` re-reads the flag from the
   * database, because a 7-day token would otherwise keep asserting platform
   * access for a week after it was revoked.
   */
  superAdmin?: boolean;
  // Standard JWT claims. Present on a token that has been verified, absent when
  // we're signing one — hence optional. `exp` is what the sliding renewal in
  // GET /auth/me reads to decide whether this token is due to be replaced.
  iat?: number;
  exp?: number;
}

declare module "fastify" {
  interface FastifyInstance {
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireRole: (roles: Array<"owner" | "admin" | "member">) => (
      req: FastifyRequest,
      reply: FastifyReply
    ) => Promise<void>;
    /** Authenticates AND checks platform access. Use alone, not after `authenticate`. */
    requireSuperAdmin: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: JwtPayload;
    user: JwtPayload;
  }
}

export default fp(async function authPlugin(fastify: FastifyInstance) {
  fastify.register(fastifyJwt, { secret: env.JWT_SECRET });

  /**
   * Does this organization exist?
   *
   * Parameterised, not interpolated, and the id is uuid-validated by
   * `resolveActingOrg` before it ever gets here — a header value is attacker-
   * controlled input and this is the one place it reaches SQL.
   */
  async function orgExists(orgId: string): Promise<boolean> {
    try {
      return (await prisma.organization.count({ where: { id: orgId } })) > 0;
    } catch {
      // Fail closed: an org we cannot confirm is not one we will scope to.
      return false;
    }
  }

  fastify.decorate("authenticate", async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      await req.jwtVerify();
    } catch (err) {
      // Say WHY the token was refused. The blind `catch {}` this replaces
      // collapsed every rejection into the same opaque "Unauthorized", with
      // nothing logged — so a desktop client sitting on an expired token was
      // indistinguishable from a permissions bug, both on screen and in the
      // logs. `code` is what lets a client tell "sign in again" apart from
      // "you're not allowed to do that".
      const raw = (err ?? {}) as { code?: string; name?: string };
      const expired =
        raw.code === "FAST_JWT_EXPIRED" ||
        raw.code === "FST_JWT_AUTHORIZATION_TOKEN_EXPIRED" ||
        raw.name === "TokenExpiredError";
      req.log.info({ jwtError: raw.code ?? raw.name, url: req.url }, "auth rejected");
      return reply.code(401).send({
        error: expired ? "Session expired" : "Unauthorized",
        code: expired ? "token_expired" : "unauthorized",
      });
    }

    /**
     * The acting-org switch — see lib/acting-org.ts for the full reasoning.
     *
     * This is the single line that makes the whole existing dashboard work
     * cross-org for a super admin, and the single line that would break tenant
     * isolation if `resolveActingOrg` ever said yes to the wrong person. It
     * returns null for everyone else, on every excluded path, and for every
     * malformed or unknown org — all indistinguishable from outside.
     */
    const actingOrgId = await resolveActingOrg(
      { url: req.url, headers: req.headers, userId: req.user.userId, orgId: req.user.orgId },
      { isSuperAdmin, orgExists }
    );

    if (actingOrgId) {
      req.user.orgId = actingOrgId;
      req.user.role = ACTING_ORG_ROLE;
      // Echoed so a client can prove which org answered, rather than trusting
      // that the header it sent was the one that took effect.
      reply.header(ACTING_ORG_ECHO_HEADER, actingOrgId);
      req.log.info(
        { userId: req.user.userId, actingOrgId, url: req.url },
        "super admin acting on another org"
      );
    }
  });

  fastify.decorate(
    "requireRole",
    (roles: Array<"owner" | "admin" | "member">) =>
      async (req: FastifyRequest, reply: FastifyReply) => {
        if (!roles.includes(req.user.role)) {
          reply.code(403).send({ error: "Forbidden" });
        }
      }
  );

  /**
   * The gate on every `/admin/*` route.
   *
   * Verifies the token first, then asks the DATABASE whether this account is
   * still a super admin — not the token's own claim. See the docblock on
   * `isSuperAdmin()` for why this one check is worth a round trip when org
   * roles are not: these routes reach across every organization and delete
   * things, so "revoked, but the old token is good until Thursday" is not an
   * acceptable window.
   *
   * Authenticates inline rather than being chained after `fastify.authenticate`,
   * so it cannot be mounted without one — a preHandler array that forgot the
   * authenticate step would otherwise read `req.user` off an unverified request.
   *
   * The refusal is a flat 403 with no detail. A distinct "you are not a super
   * admin" message would tell any authenticated user that this surface exists
   * and that some accounts can reach it.
   */
  fastify.decorate("requireSuperAdmin", async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      await req.jwtVerify();
    } catch {
      return reply.code(401).send({ error: "Unauthorized", code: "unauthorized" });
    }
    if (!(await isSuperAdmin(req.user.userId))) {
      req.log.warn({ userId: req.user.userId, url: req.url }, "super admin route refused");
      return reply.code(403).send({ error: "Forbidden" });
    }
  });
});
