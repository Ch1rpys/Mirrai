-- mirrai: idempotent-migration
--
-- Consent (C10.3).
--
-- The other person can say no, and then the persona is removed for good.
-- One row is left behind: the owner and the moment. It carries no
-- content, no name and no persona id — it is the record that the promise
-- ("say no and it will be deleted") was kept, and nothing else.

CREATE TABLE IF NOT EXISTS "consent_removals" (
  "id" serial PRIMARY KEY NOT NULL,
  "userId" integer NOT NULL,
  "createdAt" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "consent_removals_user_idx"
  ON "consent_removals" ("userId");

-- mirrai: down
DROP INDEX IF EXISTS "consent_removals_user_idx";
DROP TABLE IF EXISTS "consent_removals";
