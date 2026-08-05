-- Org-wide switch for the Reports page's "Website usage" panel. Defaults to
-- true so existing workspaces see no change until an admin turns it off.
--
-- The unlock/re-lock around it is required on CockroachDB, which ships tables
-- with the `schema_locked` storage parameter set. Without it the ADD COLUMN is
-- refused outright:
--
--   ERROR: this schema change is disallowed because table "Organization" is
--   locked and this operation cannot automatically unlock the table
--   SQLSTATE: 57000
--
-- Some statements unlock the table themselves; ADD COLUMN is not one of them,
-- so it is done explicitly here and the parameter restored afterwards.
ALTER TABLE "Organization" SET (schema_locked = false);

ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "showWebsiteUsage" BOOL NOT NULL DEFAULT true;

ALTER TABLE "Organization" SET (schema_locked = true);
