-- Org-wide trail of destructive and membership actions.
--
-- No schema_locked unlock/re-lock here, unlike the Organization column
-- migration: that parameter guards ALTERs against existing tables, and this
-- only ever CREATEs a new one. Verified against the dev cluster.
--
-- The application also creates this at boot via ensureAuditLogTable() in
-- src/lib/ensure-schema.ts, for the same reason that function exists at all —
-- `prisma migrate deploy` is not safe against this database (see "CockroachDB
-- migrations" in web/README.md). This file is kept for parity so the schema is
-- reproducible from migrations alone; every statement is IF NOT EXISTS, so
-- whichever path runs first, the other is a no-op.
--
-- actorId is ON DELETE SET NULL on purpose: an audit row must never be the
-- reason a user delete fails, and must never be removed alongside them. The
-- readable identity of both parties lives denormalised in `payload`
-- (actorEmail / targetLabel), so an entry survives the account it describes.
CREATE TABLE IF NOT EXISTS "AuditLog" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "orgId" UUID NOT NULL,
  "actorId" UUID,
  "action" STRING NOT NULL,
  "payload" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT current_timestamp(),
  CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AuditLog_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id"),
  CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL
);

-- Serves the default listing (org-scoped, createdAt desc keyset paging).
CREATE INDEX IF NOT EXISTS "AuditLog_orgId_createdAt_idx" ON "AuditLog" ("orgId", "createdAt");

-- Serves the action filter.
CREATE INDEX IF NOT EXISTS "AuditLog_orgId_action_idx" ON "AuditLog" ("orgId", "action");
