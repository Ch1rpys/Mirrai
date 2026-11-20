-- mirrai: idempotent-migration
--
-- "How are you after that?" (C4.2).
--
-- One answer per session, in four words. The unique key is what makes
-- asking safe: the same session cannot be answered twice, and the client
-- does not have to be trusted to ask only once.

CREATE TABLE IF NOT EXISTS "session_checkins" (
  "id" serial PRIMARY KEY NOT NULL,
  "userId" integer NOT NULL,
  "personaId" integer NOT NULL,
  "sessionStartAt" timestamp NOT NULL,
  "answer" varchar(8) NOT NULL,
  "createdAt" timestamp DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "session_checkins_session_idx"
  ON "session_checkins" ("userId", "personaId", "sessionStartAt");
CREATE INDEX IF NOT EXISTS "session_checkins_user_time_idx"
  ON "session_checkins" ("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "session_checkins_persona_time_idx"
  ON "session_checkins" ("personaId", "createdAt");

-- mirrai: down
DROP INDEX IF EXISTS "session_checkins_persona_time_idx";
DROP INDEX IF EXISTS "session_checkins_user_time_idx";
DROP INDEX IF EXISTS "session_checkins_session_idx";
DROP TABLE IF EXISTS "session_checkins";
