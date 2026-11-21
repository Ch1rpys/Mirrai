-- mirrai: idempotent-migration
--
-- Undo and the recycle bin (C8.11).
--
-- Deleting a persona, a message or a memory used to be immediate and
-- irreversible. The row now carries the moment it was put in the bin,
-- and every ordinary read leaves those rows out. `NULL` means "not
-- deleted", which is why the column is nullable rather than a boolean:
-- the index and the thirty-day sweep both need the moment.
--
-- A deleted persona's messages and memories carry the same moment, so a
-- restore puts back exactly what the deletion took.
--
-- The rows are hard-deleted by `purgeExpiredPersonas` once they are
-- older than thirty days, and immediately by an account deletion.

ALTER TABLE "personas"
  ADD COLUMN IF NOT EXISTS "deletedAt" timestamp;

ALTER TABLE "messages"
  ADD COLUMN IF NOT EXISTS "deletedAt" timestamp;

ALTER TABLE "memories"
  ADD COLUMN IF NOT EXISTS "deletedAt" timestamp;

-- The sweep looks for the oldest deleted persona first, and the
-- recycle bin lists one user's deleted personas newest first.
CREATE INDEX IF NOT EXISTS "personas_user_deleted_idx"
  ON "personas" ("userId", "deletedAt");
CREATE INDEX IF NOT EXISTS "personas_deleted_idx"
  ON "personas" ("deletedAt");
CREATE INDEX IF NOT EXISTS "messages_deleted_idx"
  ON "messages" ("deletedAt");
CREATE INDEX IF NOT EXISTS "memories_deleted_idx"
  ON "memories" ("deletedAt");

-- mirrai: down
DROP INDEX IF EXISTS "memories_deleted_idx";
DROP INDEX IF EXISTS "messages_deleted_idx";
DROP INDEX IF EXISTS "personas_deleted_idx";
DROP INDEX IF EXISTS "personas_user_deleted_idx";
ALTER TABLE "memories" DROP COLUMN IF EXISTS "deletedAt";
ALTER TABLE "messages" DROP COLUMN IF EXISTS "deletedAt";
ALTER TABLE "personas" DROP COLUMN IF EXISTS "deletedAt";
