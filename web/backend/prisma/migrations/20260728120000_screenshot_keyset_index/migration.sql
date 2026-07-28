-- Keyset pagination for the screenshots gallery scans (takenAt DESC, id DESC).
-- Without a matching index every page is a full sort of the org's screenshot
-- history, which on CockroachDB Serverless burns Request Units for no reason.
--
-- Screenshot is not schema_locked (only TrackingSession and ActivityBlock are),
-- so no unlock/relock dance is needed here.
CREATE INDEX IF NOT EXISTS "Screenshot_takenAt_id_idx" ON "Screenshot" ("takenAt", "id");
