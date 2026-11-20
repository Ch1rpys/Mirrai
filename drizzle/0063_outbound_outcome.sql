-- mirrai: idempotent-migration
--
-- What happened after the user said it (C3.5).
--
-- `outbound_letters` recorded that "I said it" and then had no place to
-- put the rest of the sentence. These two columns hold an optional note,
-- which also becomes a relationship event. They are nullable: saying
-- nothing after saying it is a complete answer.

ALTER TABLE "outbound_letters" ADD COLUMN IF NOT EXISTS "outcomeNote" text;
ALTER TABLE "outbound_letters" ADD COLUMN IF NOT EXISTS "outcomeAt" timestamp;

-- mirrai: down
ALTER TABLE "outbound_letters" DROP COLUMN IF EXISTS "outcomeAt";
ALTER TABLE "outbound_letters" DROP COLUMN IF EXISTS "outcomeNote";
