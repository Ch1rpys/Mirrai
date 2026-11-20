-- mirrai: idempotent-migration
--
-- Oral accounts (C7.4): what the owner and the family members who were
-- let in through C7.2 remember about the person, written or spoken.
-- A draft belongs to the teller alone; the owner sees it only after the
-- teller submits it.

CREATE TABLE IF NOT EXISTS "oral_accounts" (
  "id" serial PRIMARY KEY NOT NULL,
  "personaId" integer NOT NULL,
  "userId" integer NOT NULL,
  "tellerName" varchar(64) NOT NULL,
  "body" text NOT NULL,
  "submittedAt" timestamp,
  "createdAt" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "oral_accounts_persona_idx"
  ON "oral_accounts" ("personaId", "userId");
CREATE INDEX IF NOT EXISTS "oral_accounts_submitted_idx"
  ON "oral_accounts" ("personaId", "submittedAt");

-- mirrai: down
DROP TABLE IF EXISTS "oral_accounts";
