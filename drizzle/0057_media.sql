-- mirrai: idempotent-migration
--
-- The recordings, photographs and videos of a record (B7.3, B7.8,
-- B7.10). A row points at the original file; the content hash keeps a
-- second import from registering it twice.

CREATE TABLE IF NOT EXISTS "media" (
  "id" serial PRIMARY KEY NOT NULL,
  "userId" integer NOT NULL,
  "personaId" integer NOT NULL,
  "kind" varchar(8) NOT NULL,
  "fileKey" varchar(500) NOT NULL,
  "mime" varchar(64),
  "bytes" integer,
  "hash" varchar(64) NOT NULL,
  "at" timestamp,
  "recordId" integer,
  "fileId" integer,
  "fromThem" boolean DEFAULT false NOT NULL,
  "durationSec" integer,
  "width" integer,
  "height" integer,
  "transcript" text,
  "transcriptEngine" varchar(32),
  "exif" jsonb,
  "createdAt" timestamp DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "media_persona_hash_idx"
  ON "media" ("personaId", "userId", "hash");

CREATE INDEX IF NOT EXISTS "media_persona_idx"
  ON "media" ("personaId", "userId");

CREATE INDEX IF NOT EXISTS "media_record_idx"
  ON "media" ("recordId");

-- mirrai: down
DROP INDEX IF EXISTS "media_record_idx";
DROP INDEX IF EXISTS "media_persona_idx";
DROP INDEX IF EXISTS "media_persona_hash_idx";
DROP TABLE IF EXISTS "media";
