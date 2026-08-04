-- Backfill: any account already sitting in status = 'removed' before this
-- release still occupies its original, unique email address, which permanently
-- blocks re-inviting that address (or anyone else registering with it). The
-- application now frees the address at the moment of removal (see
-- src/routes/members.ts); this statement applies the same rewrite, once, to
-- rows that were removed before that code existed. Idempotent: rows already
-- carrying the "+removed-" tag are skipped, so re-running this is a no-op.
UPDATE "User"
SET email = split_part(email, '@', 1) || '+removed-' || substr(id::STRING, 1, 8) || '@' || split_part(email, '@', 2)
WHERE status = 'removed' AND email NOT LIKE '%+removed-%@%';
