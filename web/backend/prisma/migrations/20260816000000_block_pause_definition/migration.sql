-- Record the pause definition each activity block was measured with.
--
-- The desktop tracker now credits a short window after every input event rather
-- than only the exact second the event landed, so a natural pause between
-- keystrokes reads as work instead of as idle. The threshold is 3 seconds,
-- rounded up from the 2.5s that Chang et al. (Ergonomics, 2009; PMID 19562597)
-- validated against video observation as the most accurate estimator of
-- keyboard and mouse use time.
--
-- Storing it per block keeps every figure self-describing. Blocks written before
-- this release have no value, which reads as the original per-second sampling —
-- so a report spanning the cutover can say the two halves were measured
-- differently rather than silently averaging them together.
--
-- Nothing is backfilled and no stored percentage is recomputed. activityPct is
-- part of the tamper-evident hash chain; rewriting it would either break the
-- chain or mean forging it.

-- ActivityBlock is schema_locked (a CockroachDB changefeed optimisation), which
-- blocks DDL. Unlock, alter, then restore the lock so changefeed performance is
-- unaffected. See cockroachlabs.com/docs/v26.2/changefeed-best-practices.
ALTER TABLE "ActivityBlock" SET (schema_locked = false);

ALTER TABLE "ActivityBlock" ADD COLUMN IF NOT EXISTS "pauseDefinitionSecs" INT;

ALTER TABLE "ActivityBlock" SET (schema_locked = true);
