-- mirrai: idempotent-migration
--
-- Bookmarks and notes on a record line (C2.10). The reader is the
-- user's own copy of the archive, so a mark belongs to one persona of
-- one user; a line can have one bookmark and one note.

CREATE TABLE IF NOT EXISTS "record_marks" (
  "id" serial PRIMARY KEY NOT NULL,
  "userId" integer NOT NULL,
  "personaId" integer NOT NULL,
  "recordId" integer NOT NULL,
  "kind" varchar(8) NOT NULL,
  "note" text,
  "createdAt" timestamp DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "record_marks_pair_idx"
  ON "record_marks" ("personaId", "userId", "recordId", "kind");
CREATE INDEX IF NOT EXISTS "record_marks_persona_idx"
  ON "record_marks" ("personaId", "userId");
CREATE INDEX IF NOT EXISTS "record_marks_record_idx"
  ON "record_marks" ("recordId");

-- mirrai: down
DROP INDEX IF EXISTS "record_marks_record_idx";
DROP INDEX IF EXISTS "record_marks_persona_idx";
DROP INDEX IF EXISTS "record_marks_pair_idx";
DROP TABLE IF EXISTS "record_marks";
