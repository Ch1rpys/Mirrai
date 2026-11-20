-- mirrai: idempotent-migration
--
-- The meeting list (C3.7).
--
-- 「等 TA 回来再说」 was a list of notes. When the two of them finally
-- meet, some of those things have been said. A note can now be ticked
-- off, and the tick is a date so the list can show when.

ALTER TABLE "letters" ADD COLUMN IF NOT EXISTS "doneAt" timestamp;

-- mirrai: down
ALTER TABLE "letters" DROP COLUMN IF EXISTS "doneAt";
