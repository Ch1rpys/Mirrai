-- mirrai: idempotent-migration
--
-- The cached annual report of one persona (C2.4). The row carries the
-- records version it was built from, so a new import rebuilds it and
-- an unchanged record is not read again.

CREATE TABLE IF NOT EXISTS "record_reports" (
  "id" serial PRIMARY KEY NOT NULL,
  "userId" integer NOT NULL,
  "personaId" integer NOT NULL,
  "recordsVersion" varchar(64) NOT NULL,
  "report" jsonb NOT NULL,
  "createdAt" timestamp DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "record_reports_persona_idx"
  ON "record_reports" ("personaId", "userId");
CREATE INDEX IF NOT EXISTS "record_reports_user_idx"
  ON "record_reports" ("userId");

-- mirrai: down
DROP INDEX IF EXISTS "record_reports_user_idx";
DROP INDEX IF EXISTS "record_reports_persona_idx";
DROP TABLE IF EXISTS "record_reports";
