-- mirrai: idempotent-migration
--
-- When the current emotional state started, so inertia can tell how
-- long this stretch has already lasted.

ALTER TABLE "personas"
  ADD COLUMN IF NOT EXISTS "emotionalStateSince" timestamp;

-- mirrai: down
ALTER TABLE "personas" DROP COLUMN IF EXISTS "emotionalStateSince";
