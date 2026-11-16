-- mirrai: idempotent-migration
--
-- Sixth-stage per-persona switches and the measurements taken from the
-- records. Empty settings mean every default; an empty style profile
-- means nothing has been measured yet.

ALTER TABLE "personas" ADD COLUMN IF NOT EXISTS "settings" jsonb;
ALTER TABLE "personas" ADD COLUMN IF NOT EXISTS "styleProfile" jsonb;

-- mirrai: down
ALTER TABLE "personas" DROP COLUMN IF EXISTS "settings";
ALTER TABLE "personas" DROP COLUMN IF EXISTS "styleProfile";
