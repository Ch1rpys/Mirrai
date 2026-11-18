-- mirrai: idempotent-migration
--
-- Optional local embeddings for exemplar retrieval (B2.3). The vector
-- is an int8-quantised, L2-normalised embedding of the user burst that
-- came before a TA turn. See https://docs.ollama.com/api/embed

CREATE TABLE IF NOT EXISTS "record_embeddings" (
  "id" serial PRIMARY KEY NOT NULL,
  "userId" integer NOT NULL,
  "personaId" integer NOT NULL,
  "recordId" integer NOT NULL,
  "model" varchar(64) NOT NULL,
  "dim" integer NOT NULL,
  "vec" bytea NOT NULL,
  "createdAt" timestamp DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "record_embeddings_persona_record_model_idx"
  ON "record_embeddings" ("personaId", "recordId", "model");
CREATE INDEX IF NOT EXISTS "record_embeddings_persona_user_idx"
  ON "record_embeddings" ("personaId", "userId");

-- mirrai: down
DROP INDEX IF EXISTS "record_embeddings_persona_user_idx";
DROP INDEX IF EXISTS "record_embeddings_persona_record_model_idx";
DROP TABLE IF EXISTS "record_embeddings";
