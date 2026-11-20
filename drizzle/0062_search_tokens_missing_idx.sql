-- mirrai: idempotent-migration
--
-- The rows the C8.6 search still has to find by substring (WP11
-- acceptance follow-up).
--
-- `searchRecordsLexical`, `candidateRecordsByOverlap` and the message
-- search all keep `OR searchTokens IS NULL` so a search is correct
-- while the backfill is still running. Without an index for that
-- branch, PostgreSQL cannot combine it with the GIN index and falls
-- back to a sequential scan of every row, even after the backfill has
-- made the branch empty. These partial indexes are tiny and let the
-- planner use a BitmapOr of the GIN index and the missing-row index.

CREATE INDEX IF NOT EXISTS "collected_messages_missing_tokens_idx"
  ON "collected_messages" ("personaId", "userId")
  WHERE "searchTokens" IS NULL;

CREATE INDEX IF NOT EXISTS "messages_missing_tokens_idx"
  ON "messages" ("personaId", "userId")
  WHERE "searchTokens" IS NULL;

-- mirrai: down
DROP INDEX IF EXISTS "messages_missing_tokens_idx";
DROP INDEX IF EXISTS "collected_messages_missing_tokens_idx";
