-- mirrai: idempotent-migration
--
-- That the after-chat question was shown (C4.2).
--
-- `session_checkins` records the answer. This records the asking, which
-- is a different fact: a person can see the question and ignore it, and
-- the app must not ask again that day — or ask the same session twice.

CREATE TABLE IF NOT EXISTS "session_checkin_prompts" (
  "id" serial PRIMARY KEY NOT NULL,
  "userId" integer NOT NULL,
  "personaId" integer NOT NULL,
  "sessionStartAt" timestamp NOT NULL,
  "promptedAt" timestamp DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "session_checkin_prompts_session_idx"
  ON "session_checkin_prompts" ("userId", "personaId", "sessionStartAt");
CREATE INDEX IF NOT EXISTS "session_checkin_prompts_user_time_idx"
  ON "session_checkin_prompts" ("userId", "promptedAt");
CREATE INDEX IF NOT EXISTS "session_checkin_prompts_persona_time_idx"
  ON "session_checkin_prompts" ("personaId", "promptedAt");

-- mirrai: down
DROP INDEX IF EXISTS "session_checkin_prompts_persona_time_idx";
DROP INDEX IF EXISTS "session_checkin_prompts_user_time_idx";
DROP INDEX IF EXISTS "session_checkin_prompts_session_idx";
DROP TABLE IF EXISTS "session_checkin_prompts";
