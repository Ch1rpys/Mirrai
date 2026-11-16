-- mirrai: idempotent-migration
--
-- The collected-messages table becomes the record table: every real
-- chat line, from an upload or a collector, lands here with its kind,
-- speaker, source file and type-specific meta. Uploaded files remember
-- whether they have been parsed.

ALTER TABLE "collected_messages" ADD COLUMN IF NOT EXISTS "kind" varchar(16) DEFAULT 'text' NOT NULL;
ALTER TABLE "collected_messages" ADD COLUMN IF NOT EXISTS "speaker" varchar(100);
ALTER TABLE "collected_messages" ADD COLUMN IF NOT EXISTS "fileId" integer;
ALTER TABLE "collected_messages" ADD COLUMN IF NOT EXISTS "lineNo" integer;
ALTER TABLE "collected_messages" ADD COLUMN IF NOT EXISTS "meta" jsonb;

CREATE INDEX IF NOT EXISTS "collected_messages_persona_time_idx"
  ON "collected_messages" ("personaId", "userId", "timestamp");
CREATE INDEX IF NOT EXISTS "collected_messages_file_idx"
  ON "collected_messages" ("personaId", "userId", "fileId");

ALTER TABLE "persona_files" ADD COLUMN IF NOT EXISTS "parseStatus" varchar(16);
ALTER TABLE "persona_files" ADD COLUMN IF NOT EXISTS "parseReport" jsonb;

ALTER TYPE "file_type" ADD VALUE IF NOT EXISTS 'chat_export';
ALTER TYPE "file_type" ADD VALUE IF NOT EXISTS 'archive';

-- mirrai: down
DROP INDEX IF EXISTS "collected_messages_persona_time_idx";
DROP INDEX IF EXISTS "collected_messages_file_idx";
ALTER TABLE "collected_messages" DROP COLUMN IF EXISTS "kind";
ALTER TABLE "collected_messages" DROP COLUMN IF EXISTS "speaker";
ALTER TABLE "collected_messages" DROP COLUMN IF EXISTS "fileId";
ALTER TABLE "collected_messages" DROP COLUMN IF EXISTS "lineNo";
ALTER TABLE "collected_messages" DROP COLUMN IF EXISTS "meta";
ALTER TABLE "persona_files" DROP COLUMN IF EXISTS "parseStatus";
ALTER TABLE "persona_files" DROP COLUMN IF EXISTS "parseReport";
-- A Postgres enum value cannot be dropped. Rows that used the new
-- values are moved onto ones that already existed, the column is
-- rebuilt around the old type, and the old type is dropped.
UPDATE "persona_files" SET "fileType" = 'chat_txt' WHERE "fileType" = 'chat_export';
UPDATE "persona_files" SET "fileType" = 'collected' WHERE "fileType" = 'archive';
ALTER TYPE "file_type" RENAME TO "file_type_old";
CREATE TYPE "file_type" AS ENUM (
  'chat_txt',
  'chat_csv',
  'image',
  'video',
  'collected'
);
ALTER TABLE "persona_files"
  ALTER COLUMN "fileType" TYPE "file_type"
  USING "fileType"::text::"file_type";
DROP TYPE "file_type_old";
