-- mirrai: idempotent-migration
--
-- Whether a letter's words came from the wording assistant (C3.6).
--
-- The suggestion is only ever offered; the user has to adopt it and save
-- it. This column is how the interface can say, afterwards, which
-- sentences the model helped with.

ALTER TABLE "outbound_letters"
  ADD COLUMN IF NOT EXISTS "wordingAssisted" boolean NOT NULL DEFAULT false;

-- mirrai: down
ALTER TABLE "outbound_letters" DROP COLUMN IF EXISTS "wordingAssisted";
