-- mirrai: idempotent-migration
--
-- Full-text search over the record table (C8.6).
--
-- Chinese has no word boundaries that PostgreSQL's built-in
-- configurations could use, so the application cuts text into
-- character bigrams and writes them with array_to_tsvector. The GIN
-- index makes the containment test cheap; without it every search was
-- a sequential scan of the whole table.

ALTER TABLE "collected_messages" ADD COLUMN IF NOT EXISTS "searchTokens" tsvector;
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "searchTokens" tsvector;

CREATE INDEX IF NOT EXISTS "collected_messages_search_tokens_idx"
  ON "collected_messages" USING gin ("searchTokens");
CREATE INDEX IF NOT EXISTS "messages_search_tokens_idx"
  ON "messages" USING gin ("searchTokens");

-- mirrai: down
DROP INDEX IF EXISTS "messages_search_tokens_idx";
DROP INDEX IF EXISTS "collected_messages_search_tokens_idx";
ALTER TABLE "messages" DROP COLUMN IF EXISTS "searchTokens";
ALTER TABLE "collected_messages" DROP COLUMN IF EXISTS "searchTokens";
