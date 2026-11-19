-- mirrai: idempotent-migration
--
-- A reply that will be written later. The row is the moment they look
-- at their phone, not a pre-written answer: when it comes due, the
-- turn answers every user message that is still waiting.

CREATE TABLE IF NOT EXISTS "reply_jobs" (
  "id" serial PRIMARY KEY NOT NULL,
  "userId" integer NOT NULL,
  "personaId" integer NOT NULL,
  "kind" varchar(16) NOT NULL,
  "status" varchar(16) NOT NULL,
  "reason" varchar(16) NOT NULL,
  "dueAt" timestamp NOT NULL,
  "channel" varchar(16) NOT NULL,
  "targetId" varchar(255),
  "locale" varchar(8) NOT NULL,
  "periodId" varchar(64),
  "attempts" integer DEFAULT 0 NOT NULL,
  "claimedAt" timestamp,
  "payload" jsonb,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "finishedAt" timestamp
);

CREATE UNIQUE INDEX IF NOT EXISTS "reply_jobs_one_pending_reply_idx"
  ON "reply_jobs" ("userId", "personaId")
  WHERE status IN ('pending', 'running') AND kind = 'reply';

CREATE INDEX IF NOT EXISTS "reply_jobs_due_idx"
  ON "reply_jobs" ("dueAt")
  WHERE status = 'pending';

-- mirrai: down
DROP INDEX IF EXISTS "reply_jobs_due_idx";
DROP INDEX IF EXISTS "reply_jobs_one_pending_reply_idx";
DROP TABLE IF EXISTS "reply_jobs";
