-- One row per stored screenshot.
--
-- The R2 key is deterministic — `<orgId>/<sessionId>/<takenAtMs>-m<monitor>.webp`
-- — so it names exactly one image. `Screenshot` nonetheless had no unique
-- constraint and `/screenshots/confirm` was a bare `create`, so a confirm whose
-- RESPONSE was lost (a connection reset, or the desktop client's 30s timeout
-- against a cold-started backend) inserted a second row on the next retry pass:
-- same key, same object, duplicated in the gallery, one extra presigned-URL call
-- per view. On a backend that cold-starts this was routine, not exotic.
--
-- Existing duplicates are collapsed first, keeping the earliest row for each key
-- so the original `createdAt` and any `deletedAt`/`deletedById` review state on
-- it survive. Only the redundant copies are removed; no image is orphaned,
-- because every copy pointed at the same R2 object and one row still does.

ALTER TABLE "Screenshot" SET (schema_locked = false);

-- Collapse duplicates, oldest row wins.
DELETE FROM "Screenshot" s
USING "Screenshot" keep
WHERE s."r2Key" = keep."r2Key"
  AND (
    s."createdAt" > keep."createdAt"
    OR (s."createdAt" = keep."createdAt" AND s."id" > keep."id")
  );

CREATE UNIQUE INDEX IF NOT EXISTS "Screenshot_r2Key_key" ON "Screenshot" ("r2Key");

ALTER TABLE "Screenshot" SET (schema_locked = true);
