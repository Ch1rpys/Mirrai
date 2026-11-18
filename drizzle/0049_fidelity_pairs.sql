-- mirrai: idempotent-migration
--
-- One A/B choice from the web chat: the line the user picked as more
-- like them, the one they passed over, and the B3.3 scoring features
-- of both. Thirty of these train the rerank weights.

CREATE TABLE IF NOT EXISTS "fidelity_pairs" (
  "id" serial PRIMARY KEY NOT NULL,
  "userId" integer NOT NULL,
  "personaId" integer NOT NULL,
  "messageId" integer NOT NULL,
  "chosenText" text NOT NULL,
  "rejectedText" text NOT NULL,
  "features" jsonb,
  "createdAt" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "fidelity_pairs_persona_user_idx"
  ON "fidelity_pairs" ("personaId", "userId");

-- mirrai: down
DROP INDEX IF EXISTS "fidelity_pairs_persona_user_idx";
DROP TABLE IF EXISTS "fidelity_pairs";
