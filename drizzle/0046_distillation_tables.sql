-- mirrai: idempotent-migration
--
-- Sixth-stage distillation: hashed blocks and the cards taken from
-- them, a version history of the persona, and the columns that tie a
-- memory or a speech-act label back to a record.

CREATE TABLE IF NOT EXISTS "distillation_chunks" (
  "id" serial PRIMARY KEY NOT NULL,
  "userId" integer NOT NULL,
  "personaId" integer NOT NULL,
  "chunkHash" varchar(64) NOT NULL,
  "phase" varchar(16) NOT NULL,
  "cardCount" integer NOT NULL,
  "createdAt" timestamp DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "distillation_chunks_hash_phase_idx"
  ON "distillation_chunks" ("personaId", "userId", "chunkHash", "phase");

CREATE TABLE IF NOT EXISTS "distillation_cards" (
  "id" serial PRIMARY KEY NOT NULL,
  "userId" integer NOT NULL,
  "personaId" integer NOT NULL,
  "chunkHash" varchar(64) NOT NULL,
  "periodId" varchar(32),
  "kind" varchar(16) NOT NULL,
  "dimension" varchar(16),
  "claim" text NOT NULL,
  "payload" jsonb,
  "createdAt" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "distillation_cards_kind_idx"
  ON "distillation_cards" ("personaId", "userId", "kind");

CREATE TABLE IF NOT EXISTS "persona_versions" (
  "id" serial PRIMARY KEY NOT NULL,
  "userId" integer NOT NULL,
  "personaId" integer NOT NULL,
  "reason" varchar(32) NOT NULL,
  "personaData" jsonb,
  "styleProfile" jsonb,
  "behaviorProfile" jsonb,
  "settings" jsonb,
  "evalRunId" integer,
  "createdAt" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "persona_versions_persona_created_idx"
  ON "persona_versions" ("personaId", "userId", "createdAt");

ALTER TABLE "memories" ADD COLUMN IF NOT EXISTS "recordId" integer;
ALTER TABLE "memories" ADD COLUMN IF NOT EXISTS "source" varchar(16) DEFAULT 'chat' NOT NULL;
ALTER TABLE "memories" ADD COLUMN IF NOT EXISTS "mentionCount" integer DEFAULT 0 NOT NULL;

ALTER TABLE "collected_messages" ADD COLUMN IF NOT EXISTS "act" varchar(16);
ALTER TABLE "collected_messages" ADD COLUMN IF NOT EXISTS "actSource" varchar(8);
ALTER TABLE "collected_messages" ADD COLUMN IF NOT EXISTS "emotion" varchar(16);
ALTER TABLE "collected_messages" ADD COLUMN IF NOT EXISTS "emotionSource" varchar(8);

-- mirrai: down
DROP INDEX IF EXISTS "persona_versions_persona_created_idx";
DROP TABLE IF EXISTS "persona_versions";
DROP INDEX IF EXISTS "distillation_cards_kind_idx";
DROP TABLE IF EXISTS "distillation_cards";
DROP INDEX IF EXISTS "distillation_chunks_hash_phase_idx";
DROP TABLE IF EXISTS "distillation_chunks";
ALTER TABLE "memories" DROP COLUMN IF EXISTS "recordId";
ALTER TABLE "memories" DROP COLUMN IF EXISTS "source";
ALTER TABLE "memories" DROP COLUMN IF EXISTS "mentionCount";
ALTER TABLE "collected_messages" DROP COLUMN IF EXISTS "act";
ALTER TABLE "collected_messages" DROP COLUMN IF EXISTS "actSource";
ALTER TABLE "collected_messages" DROP COLUMN IF EXISTS "emotion";
ALTER TABLE "collected_messages" DROP COLUMN IF EXISTS "emotionSource";
