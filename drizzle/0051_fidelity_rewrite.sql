-- mirrai: idempotent-migration
--
-- Optional rewrite on an unlike mark: what they would actually have
-- said. Empty until the reader fills it in.

ALTER TABLE "fidelity_feedback"
  ADD COLUMN IF NOT EXISTS "rewrite" text;

-- mirrai: down
ALTER TABLE "fidelity_feedback" DROP COLUMN IF EXISTS "rewrite";
