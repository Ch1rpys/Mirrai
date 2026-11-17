-- mirrai: idempotent-migration
--
-- One sitting of the in-app blind test: the groups keep the truth, the
-- answers do not see it until the sitting is finished.

CREATE TABLE IF NOT EXISTS "blind_sessions" (
  "id" serial PRIMARY KEY NOT NULL,
  "userId" integer NOT NULL,
  "personaId" integer NOT NULL,
  "subject" varchar(8) NOT NULL,
  "tokenHash" varchar(64),
  "expiresAt" timestamp,
  "groups" jsonb NOT NULL,
  "answers" jsonb,
  "summary" jsonb,
  "startedAt" timestamp DEFAULT now() NOT NULL,
  "finishedAt" timestamp,
  "createdAt" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "blind_sessions_persona_user_idx"
  ON "blind_sessions" ("personaId", "userId");

CREATE UNIQUE INDEX IF NOT EXISTS "blind_sessions_token_hash_idx"
  ON "blind_sessions" ("tokenHash");

-- mirrai: down
DROP INDEX IF EXISTS "blind_sessions_token_hash_idx";
DROP INDEX IF EXISTS "blind_sessions_persona_user_idx";
DROP TABLE IF EXISTS "blind_sessions";
