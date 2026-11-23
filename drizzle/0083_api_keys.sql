-- mirrai: idempotent-migration
--
-- The keys of the OpenAI-compatible endpoint (C9.2).
--
-- A key is shown once, when it is created. The database keeps only its
-- sha256 hash and the first characters for the list, so a backup of this
-- table does not contain a usable credential.
--
-- `scopes` says what the key may do: `["chat"]` to talk to a persona,
-- `["read"]` for the read-only MCP server (C9.3).

CREATE TABLE IF NOT EXISTS "api_keys" (
  "id" serial PRIMARY KEY NOT NULL,
  "userId" integer NOT NULL,
  "name" varchar(64) NOT NULL,
  "keyHash" varchar(64) NOT NULL,
  "prefix" varchar(12) NOT NULL,
  "scopes" jsonb DEFAULT '["chat"]'::jsonb NOT NULL,
  "lastUsedAt" timestamp,
  "revokedAt" timestamp,
  "createdAt" timestamp DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "api_keys_hash_idx" ON "api_keys" ("keyHash");
CREATE INDEX IF NOT EXISTS "api_keys_user_idx" ON "api_keys" ("userId");

-- The channel enum gains a value for messages that arrived through the
-- endpoint. Adding a value is idempotent; removing one is not possible in
-- PostgreSQL, so it stays after a rollback.
ALTER TYPE "channel" ADD VALUE IF NOT EXISTS 'api';

-- mirrai: down
DROP TABLE IF EXISTS "api_keys";
-- PostgreSQL cannot remove a value from an enum type. The 'api' value of
-- "channel" stays after this rollback; it is harmless, because nothing
-- writes it unless the endpoint is used.
