-- mirrai: idempotent-migration
--
-- Fifth-stage tables and columns: the unlike mark, per-turn metadata,
-- memory conflict status, the two default-off switches, and the cached
-- speech-act on an evaluation case.

CREATE TABLE IF NOT EXISTS "fidelity_feedback" (
  "id" serial PRIMARY KEY NOT NULL,
  "userId" integer NOT NULL,
  "personaId" integer NOT NULL,
  "messageId" integer NOT NULL,
  "reason" varchar(16) NOT NULL,
  "createdAt" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "fidelity_feedback_persona_user_idx"
  ON "fidelity_feedback" ("personaId", "userId");
CREATE INDEX IF NOT EXISTS "fidelity_feedback_message_idx"
  ON "fidelity_feedback" ("messageId");

ALTER TABLE "messages"
  ADD COLUMN IF NOT EXISTS "metadata" jsonb;

ALTER TABLE "memories"
  ADD COLUMN IF NOT EXISTS "status" varchar(16) DEFAULT 'active' NOT NULL;
ALTER TABLE "memories"
  ADD COLUMN IF NOT EXISTS "supersededBy" integer;

ALTER TABLE "personas"
  ADD COLUMN IF NOT EXISTS "rerankEnabled" boolean DEFAULT false NOT NULL;
ALTER TABLE "personas"
  ADD COLUMN IF NOT EXISTS "timingEnabled" boolean DEFAULT false NOT NULL;

ALTER TABLE "eval_cases"
  ADD COLUMN IF NOT EXISTS "expectedAct" varchar(32);
ALTER TABLE "eval_cases"
  ADD COLUMN IF NOT EXISTS "expectedActSource" varchar(16);

-- mirrai: down
DROP TABLE IF EXISTS "fidelity_feedback";
ALTER TABLE "messages" DROP COLUMN IF EXISTS "metadata";
ALTER TABLE "memories" DROP COLUMN IF EXISTS "status";
ALTER TABLE "memories" DROP COLUMN IF EXISTS "supersededBy";
ALTER TABLE "personas" DROP COLUMN IF EXISTS "rerankEnabled";
ALTER TABLE "personas" DROP COLUMN IF EXISTS "timingEnabled";
ALTER TABLE "eval_cases" DROP COLUMN IF EXISTS "expectedAct";
ALTER TABLE "eval_cases" DROP COLUMN IF EXISTS "expectedActSource";
