-- mirrai: idempotent-migration
--
-- The stickers the person really used (B7.1). One row per key per
-- persona; re-registering updates the counts instead of adding a row.

CREATE TABLE IF NOT EXISTS "stickers" (
  "id" serial PRIMARY KEY NOT NULL,
  "userId" integer NOT NULL,
  "personaId" integer NOT NULL,
  "key" varchar(128) NOT NULL,
  "label" varchar(64) NOT NULL,
  "fileKey" varchar(500),
  "mime" varchar(64),
  "usesByThem" integer DEFAULT 0 NOT NULL,
  "usesByMe" integer DEFAULT 0 NOT NULL,
  "firstUsedAt" timestamp,
  "lastUsedAt" timestamp,
  "enabled" boolean DEFAULT true NOT NULL,
  "createdAt" timestamp DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "stickers_persona_key_idx"
  ON "stickers" ("personaId", "userId", "key");

CREATE INDEX IF NOT EXISTS "stickers_persona_idx"
  ON "stickers" ("personaId", "userId");

-- mirrai: down
DROP INDEX IF EXISTS "stickers_persona_idx";
DROP INDEX IF EXISTS "stickers_persona_key_idx";
DROP TABLE IF EXISTS "stickers";
