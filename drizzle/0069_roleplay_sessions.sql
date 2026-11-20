-- mirrai: idempotent-migration
--
-- The role swap (C4.4).
--
-- A practice session: the user plays the person, the app plays the user.
-- Bounded by time and turns, once a day. The transcript lives here and
-- nowhere else.

CREATE TABLE IF NOT EXISTS "roleplay_sessions" (
  "id" serial PRIMARY KEY NOT NULL,
  "userId" integer NOT NULL,
  "personaId" integer NOT NULL,
  "startedAt" timestamp NOT NULL,
  "endedAt" timestamp,
  "turns" integer DEFAULT 0 NOT NULL,
  "transcript" jsonb,
  "createdAt" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "roleplay_sessions_user_time_idx"
  ON "roleplay_sessions" ("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "roleplay_sessions_persona_time_idx"
  ON "roleplay_sessions" ("personaId", "createdAt");

-- mirrai: down
DROP INDEX IF EXISTS "roleplay_sessions_persona_time_idx";
DROP INDEX IF EXISTS "roleplay_sessions_user_time_idx";
DROP TABLE IF EXISTS "roleplay_sessions";
