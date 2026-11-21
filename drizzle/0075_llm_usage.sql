-- mirrai: idempotent-migration
--
-- The cost panel (C8.9): one row per model call.
--
-- The app had no idea what it was spending. A user with a key of their
-- own could not see which feature was expensive, and the operator could
-- not tell a heavy user from a quiet one. Each call records its purpose,
-- its tokens, and — when the user has filled in a price — what it cost.
--
-- `estimated` is true when the provider did not report usage and the
-- numbers were counted locally: an estimate is not a measurement and it
-- says so.
--
-- `createdAt` is `timestamptz`: it is compared against a month boundary
-- computed in the user's own timezone, which needs a real instant.

CREATE TABLE IF NOT EXISTS "llm_usage" (
  "id" serial PRIMARY KEY NOT NULL,
  "userId" integer NOT NULL,
  "personaId" integer,
  "provider" varchar(64) NOT NULL,
  "model" varchar(128) NOT NULL,
  "purpose" varchar(16) NOT NULL,
  "promptTokens" integer NOT NULL,
  "completionTokens" integer NOT NULL,
  "estimated" boolean DEFAULT false NOT NULL,
  "costMicros" bigint,
  "jobId" varchar(64),
  "createdAt" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "llm_usage_user_created_idx"
  ON "llm_usage" ("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "llm_usage_job_idx"
  ON "llm_usage" ("jobId");

-- mirrai: down
DROP TABLE IF EXISTS "llm_usage";
