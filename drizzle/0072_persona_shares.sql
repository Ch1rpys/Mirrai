-- mirrai: idempotent-migration
--
-- Family sharing (C7.2): one persona owned by one person, and a second
-- row for each family member who may talk to it. The member's row keeps
-- their own conversations, mood and letters; the identity and the
-- records stay on the owner's row.

ALTER TABLE "personas" ADD COLUMN IF NOT EXISTS "sharedFromPersonaId" integer;

CREATE TABLE IF NOT EXISTS "persona_shares" (
  "id" serial PRIMARY KEY NOT NULL,
  "personaId" integer NOT NULL,
  "ownerUserId" integer NOT NULL,
  "memberUserId" integer,
  "memberPersonaId" integer,
  "status" varchar(16) DEFAULT 'invited' NOT NULL,
  "tokenHash" varchar(64) NOT NULL,
  "expiresAt" timestamp NOT NULL,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "acceptedAt" timestamp
);

CREATE UNIQUE INDEX IF NOT EXISTS "persona_shares_token_idx"
  ON "persona_shares" ("tokenHash");
CREATE INDEX IF NOT EXISTS "persona_shares_persona_idx"
  ON "persona_shares" ("personaId", "ownerUserId");
CREATE INDEX IF NOT EXISTS "persona_shares_member_idx"
  ON "persona_shares" ("memberPersonaId", "memberUserId");

-- mirrai: down
DROP TABLE IF EXISTS "persona_shares";
ALTER TABLE "personas" DROP COLUMN IF EXISTS "sharedFromPersonaId";
