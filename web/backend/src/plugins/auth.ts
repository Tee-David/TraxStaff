import fp from "fastify-plugin";
import fastifyJwt from "@fastify/jwt";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { env } from "../env";

export interface JwtPayload {
  userId: string;
  orgId: string;
  role: "owner" | "admin" | "member";
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
    } catch {
      reply.code(401).send({ error: "Unauthorized" });
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
