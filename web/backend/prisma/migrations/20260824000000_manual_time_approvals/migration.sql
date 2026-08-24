-- Manual-time approvals + per-user email notification preferences.
--
-- Every statement is additive and nullable: existing manual entries come back
-- with approvalStatus NULL, which the API treats as approved (see
-- lib/approval.ts), so no historic time changes meaning when this lands.
--
-- Mirrors lib/ensure-schema.ts `ensureApprovalColumns`, which applies the same
-- DDL at boot. See "CockroachDB migrations" in web/README.md for why this
-- database is not migrated with `prisma migrate deploy`.

ALTER TABLE "TrackingSession" ADD COLUMN IF NOT EXISTS "approvalStatus" STRING;
ALTER TABLE "TrackingSession" ADD COLUMN IF NOT EXISTS "decidedAt" TIMESTAMP(3);
ALTER TABLE "TrackingSession" ADD COLUMN IF NOT EXISTS "decidedById" UUID;
ALTER TABLE "TrackingSession" ADD COLUMN IF NOT EXISTS "decidedByEmail" STRING;
ALTER TABLE "TrackingSession" ADD COLUMN IF NOT EXISTS "decisionNote" STRING;
ALTER TABLE "TrackingSession" ADD COLUMN IF NOT EXISTS "addedById" UUID;
ALTER TABLE "TrackingSession" ADD COLUMN IF NOT EXISTS "addedByEmail" STRING;

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "emailPrefs" JSONB;
