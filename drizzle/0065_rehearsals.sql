-- mirrai: idempotent-migration
--
-- The rehearsal room (C3.2).
--
-- One row per rehearsal: the user's own sentence and the few ways the
-- record suggests the person might take it. Nothing here is a message,
-- a memory, a mood or a chat count; the page is practice, and its
-- isolation is the point.

CREATE TABLE IF NOT EXISTS "rehearsals" (
  "id" serial PRIMARY KEY NOT NULL,
  "userId" integer NOT NULL,
  "personaId" integer NOT NULL,
  "line" text NOT NULL,
  "result" jsonb NOT NULL,
  "outboundLetterId" integer,
  "createdAt" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "rehearsals_persona_time_idx"
  ON "rehearsals" ("personaId", "createdAt");
CREATE INDEX IF NOT EXISTS "rehearsals_user_time_idx"
  ON "rehearsals" ("userId", "createdAt");

-- mirrai: down
DROP INDEX IF EXISTS "rehearsals_user_time_idx";
DROP INDEX IF EXISTS "rehearsals_persona_time_idx";
DROP TABLE IF EXISTS "rehearsals";
