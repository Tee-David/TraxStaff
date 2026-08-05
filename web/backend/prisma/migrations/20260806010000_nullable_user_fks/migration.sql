-- Let a member be hard-deleted without destroying the work they tracked.
--
-- TrackingSession.userId, Device.userId and TimeNote.userId are NOT NULL with
-- ON DELETE RESTRICT, which is why prisma.user.delete() throws today. Making
-- them nullable + SET NULL means the person's row can go while every session,
-- screenshot, activity block and note survives, owner-less.
--
-- (Notification.userId and Screenshot.deletedById are deliberately absent here:
-- both were already ON DELETE SET NULL in the database despite schema.prisma
-- not declaring it — one of this database's known drifts. The Prisma models
-- were corrected to match; no DDL is required.)
--
-- CockroachDB cannot change an existing foreign key's action in place, so each
-- constraint is dropped and recreated. TrackingSession is one of the
-- schema_locked tables (see 20260728120000_screenshot_keyset_index), hence the
-- unlock/re-lock around it; it is refused outright otherwise:
--
--   ERROR: this schema change is disallowed because table "TrackingSession" is
--   locked and this operation cannot automatically unlock the table
--   SQLSTATE: 57000
--
-- The application applies the same change at boot via ensureNullableUserFks()
-- in src/lib/ensure-schema.ts, because `prisma migrate deploy` is not safe
-- against this database (see "CockroachDB migrations" in web/README.md). This
-- file exists so the schema is reproducible from migrations alone; whichever
-- runs first, the other is a no-op.
--
-- Orphaned rows carry no orgId of their own, so every org-wide read admits them
-- through `project.orgId` instead — see src/lib/org-scope.ts. Without that,
-- SET NULL would preserve the data and then hide it.

ALTER TABLE "TrackingSession" SET (schema_locked = false);

ALTER TABLE "TrackingSession" ALTER COLUMN "userId" DROP NOT NULL;
ALTER TABLE "TrackingSession" DROP CONSTRAINT IF EXISTS "TrackingSession_userId_fkey";
ALTER TABLE "TrackingSession" ADD CONSTRAINT "TrackingSession_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL;

ALTER TABLE "TrackingSession" SET (schema_locked = true);

ALTER TABLE "Device" ALTER COLUMN "userId" DROP NOT NULL;
ALTER TABLE "Device" DROP CONSTRAINT IF EXISTS "Device_userId_fkey";
ALTER TABLE "Device" ADD CONSTRAINT "Device_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL;

ALTER TABLE "TimeNote" ALTER COLUMN "userId" DROP NOT NULL;
ALTER TABLE "TimeNote" DROP CONSTRAINT IF EXISTS "TimeNote_userId_fkey";
ALTER TABLE "TimeNote" ADD CONSTRAINT "TimeNote_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL;
