-- mirrai: idempotent-migration
--
-- The mailbox (C8.2): one place for everything that is waiting for the
-- user, across every persona.
--
-- `letters.readAt` is when the user read this reply. A letter that was
-- answered while the user was not looking used to look exactly like one
-- they had already read.
--
-- `personas.lastReadAt` is when the user last had this persona's chat
-- page in front of them. A reply that arrived later (a deferred reply,
-- or the answer to a scheduled message) is something they have not seen.
--
-- `scheduled_items.openedAt` is when a capsule was opened after its
-- day. The inbox already knows which capsules are due; without this
-- column it cannot tell a capsule that was read from one that was not.

ALTER TABLE "letters" ADD COLUMN IF NOT EXISTS "readAt" timestamp;
ALTER TABLE "personas" ADD COLUMN IF NOT EXISTS "lastReadAt" timestamp;
ALTER TABLE "scheduled_items" ADD COLUMN IF NOT EXISTS "openedAt" timestamp;

CREATE INDEX IF NOT EXISTS "letters_user_read_idx"
  ON "letters" ("userId", "status", "readAt");
CREATE INDEX IF NOT EXISTS "scheduled_items_user_opened_idx"
  ON "scheduled_items" ("userId", "kind", "status", "openedAt");

-- mirrai: down
DROP INDEX IF EXISTS "scheduled_items_user_opened_idx";
DROP INDEX IF EXISTS "letters_user_read_idx";
ALTER TABLE "scheduled_items" DROP COLUMN IF EXISTS "openedAt";
ALTER TABLE "personas" DROP COLUMN IF EXISTS "lastReadAt";
ALTER TABLE "letters" DROP COLUMN IF EXISTS "readAt";
