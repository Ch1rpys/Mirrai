-- mirrai: idempotent-migration
--
-- Named people, places, and things on a memory, so retrieval can hop
-- from one memory to another that shares them.

ALTER TABLE "memories"
  ADD COLUMN IF NOT EXISTS "entities" jsonb;

-- mirrai: down
ALTER TABLE "memories" DROP COLUMN IF EXISTS "entities";
