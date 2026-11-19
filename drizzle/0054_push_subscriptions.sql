-- mirrai: idempotent-migration
--
-- Browser push subscriptions. One endpoint is one browser; repeating
-- it updates the keys instead of inserting a second row.

CREATE TABLE IF NOT EXISTS "push_subscriptions" (
  "id" serial PRIMARY KEY NOT NULL,
  "userId" integer NOT NULL,
  "endpoint" text NOT NULL,
  "p256dh" text NOT NULL,
  "auth" text NOT NULL,
  "userAgent" varchar(255),
  "showPreview" boolean DEFAULT false NOT NULL,
  "failCount" integer DEFAULT 0 NOT NULL,
  "lastSuccessAt" timestamp,
  "createdAt" timestamp DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "push_subscriptions_endpoint_idx"
  ON "push_subscriptions" ("endpoint");

CREATE INDEX IF NOT EXISTS "push_subscriptions_user_idx"
  ON "push_subscriptions" ("userId");

-- mirrai: down
DROP INDEX IF EXISTS "push_subscriptions_user_idx";
DROP INDEX IF EXISTS "push_subscriptions_endpoint_idx";
DROP TABLE IF EXISTS "push_subscriptions";
