-- mirrai: idempotent-migration
--
-- The photographs attached to a memory (B7.8). The photo itself is a
-- row in `media`; this table is the link. A memory can carry more than
-- one photo, and the same photo can be attached to more than one
-- memory.

CREATE TABLE IF NOT EXISTS "memory_media" (
  "id" serial PRIMARY KEY NOT NULL,
  "userId" integer NOT NULL,
  "personaId" integer NOT NULL,
  "memoryId" integer NOT NULL,
  "mediaId" integer NOT NULL,
  "createdAt" timestamp DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "memory_media_pair_idx"
  ON "memory_media" ("memoryId", "mediaId");

CREATE INDEX IF NOT EXISTS "memory_media_persona_idx"
  ON "memory_media" ("personaId", "userId");

CREATE INDEX IF NOT EXISTS "memory_media_media_idx"
  ON "memory_media" ("mediaId");

-- mirrai: down
DROP INDEX IF EXISTS "memory_media_media_idx";
DROP INDEX IF EXISTS "memory_media_persona_idx";
DROP INDEX IF EXISTS "memory_media_pair_idx";
DROP TABLE IF EXISTS "memory_media";
