-- mirrai: idempotent-migration
--
-- A monthly limit the user sets for themselves (C8.9).
--
-- The app charges every reply to a key, and the user had no way to say
-- "do not spend more than this a month". The limit is a ceiling on the
-- optional, expensive layers — not on ordinary replies, safety paths or
-- memory extraction; those are the app working as promised.
--
-- The shape is `{ monthlyTokens?, monthlyCost? }`; empty means no
-- limit, which is the default.

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "budget" jsonb;

-- mirrai: down
ALTER TABLE "users" DROP COLUMN IF EXISTS "budget";
