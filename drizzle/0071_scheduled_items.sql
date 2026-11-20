-- mirrai: idempotent-migration
--
-- Things that arrive later (C5.3): a capsule to the user's own future
-- self, a message to the persona, or a letter. One table, one sweep.

CREATE TABLE IF NOT EXISTS "scheduled_items" (
  "id" serial PRIMARY KEY NOT NULL,
  "userId" integer NOT NULL,
  "personaId" integer NOT NULL,
  "kind" varchar(16) NOT NULL,
  "body" text NOT NULL,
  "dueAt" timestamp NOT NULL,
  "status" varchar(16) DEFAULT 'scheduled' NOT NULL,
  "cancelReason" varchar(16),
  "claimedAt" timestamp,
  "deliveredAt" timestamp,
  "createdAt" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "scheduled_items_user_due_idx"
  ON "scheduled_items" ("userId", "status", "dueAt");
CREATE INDEX IF NOT EXISTS "scheduled_items_persona_idx"
  ON "scheduled_items" ("personaId", "userId");
CREATE INDEX IF NOT EXISTS "scheduled_items_due_idx"
  ON "scheduled_items" ("dueAt");

-- mirrai: down
DROP INDEX IF EXISTS "scheduled_items_due_idx";
DROP INDEX IF EXISTS "scheduled_items_persona_idx";
DROP INDEX IF EXISTS "scheduled_items_user_due_idx";
DROP TABLE IF EXISTS "scheduled_items";
