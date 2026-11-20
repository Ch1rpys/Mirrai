-- mirrai: idempotent-migration
--
-- The user's own diary (C4.5).
--
-- Not the app's summary of a conversation: the words the person wrote
-- themselves. Never sent to a model, never extracted for memories. It
-- goes into the export and is deleted with the account.

CREATE TABLE IF NOT EXISTS "user_journal" (
  "id" serial PRIMARY KEY NOT NULL,
  "userId" integer NOT NULL,
  "personaId" integer,
  "body" text NOT NULL,
  "mood" varchar(16),
  "entryDate" varchar(10) NOT NULL,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "user_journal_user_date_idx"
  ON "user_journal" ("userId", "entryDate");
CREATE INDEX IF NOT EXISTS "user_journal_persona_date_idx"
  ON "user_journal" ("personaId", "entryDate");

-- mirrai: down
DROP INDEX IF EXISTS "user_journal_persona_date_idx";
DROP INDEX IF EXISTS "user_journal_user_date_idx";
DROP TABLE IF EXISTS "user_journal";
