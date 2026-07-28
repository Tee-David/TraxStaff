-- Tamper-resistant timing.
--
-- Credited work duration now comes from the client's monotonic clock
-- (QueryUnbiasedInterruptTimePrecise on Windows) instead of a wall-clock
-- subtraction, so changing the system clock cannot change tracked hours.
-- The server additionally caps credited time against its own clock, measured
-- from TrackingSession.lastSyncAt.
--
-- All new columns are nullable: blocks already stored, and blocks arriving from
-- clients predating this release, simply have no monotonic reading.

-- New tamper signals. CockroachDB requires each enum value to be added
-- separately, and IF NOT EXISTS keeps this migration re-runnable.
ALTER TYPE "FlagType" ADD VALUE IF NOT EXISTS 'clock_skew_detected';
ALTER TYPE "FlagType" ADD VALUE IF NOT EXISTS 'exceeds_elapsed_cap';
ALTER TYPE "FlagType" ADD VALUE IF NOT EXISTS 'block_outside_session_window';

-- These tables are schema_locked (a CockroachDB changefeed optimisation), which
-- blocks DDL. Unlock, alter, then restore the lock so changefeed performance is
-- unaffected. See cockroachlabs.com/docs/v26.2/changefeed-best-practices.
ALTER TABLE "TrackingSession" SET (schema_locked = false);

-- Server-witnessed sync anchor. Set from the server clock only.
ALTER TABLE "TrackingSession" ADD COLUMN IF NOT EXISTS "lastSyncAt" TIMESTAMP(3);

ALTER TABLE "TrackingSession" SET (schema_locked = true);

ALTER TABLE "ActivityBlock" SET (schema_locked = false);

-- Monotonic timing per activity block.
--   creditedSeconds  — awake time only; immune to system-clock changes
--   suspendedSeconds — time asleep; recorded, never credited
--   clockSkewSeconds — wall-clock drift vs the monotonic counter (tamper signal)
ALTER TABLE "ActivityBlock" ADD COLUMN IF NOT EXISTS "creditedSeconds" INT;
ALTER TABLE "ActivityBlock" ADD COLUMN IF NOT EXISTS "suspendedSeconds" INT;
ALTER TABLE "ActivityBlock" ADD COLUMN IF NOT EXISTS "clockSkewSeconds" INT;

ALTER TABLE "ActivityBlock" SET (schema_locked = true);
