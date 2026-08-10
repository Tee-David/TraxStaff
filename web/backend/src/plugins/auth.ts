import fp from "fastify-plugin";
import fastifyJwt from "@fastify/jwt";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { env } from "../env";

export interface JwtPayload {
  userId: string;
  orgId: string;
  role: "owner" | "admin" | "member";
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
});
