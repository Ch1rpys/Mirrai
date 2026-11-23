-- mirrai: idempotent-migration
--
-- Group chat (C9.8).
--
-- The user turns the feature on themselves (`users.features`). A room
-- holds two to five of their own personas; the personas only speak after
-- the user does, and every line they say stays in `group_messages` — it
-- never enters `messages`, the pair's memories, the mood, the intimacy or
-- the graduation mechanism.
--
-- `group_room_members` is unique on (roomId, personaId): a persona is in
-- a room once. The duplicate `userId` on members and messages lets every
-- read filter by owner without a join.

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "features" jsonb;

CREATE TABLE IF NOT EXISTS "group_rooms" (
  "id" serial PRIMARY KEY NOT NULL,
  "userId" integer NOT NULL,
  "name" varchar(60) NOT NULL,
  "createdAt" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "group_rooms_user_idx"
  ON "group_rooms" ("userId");

CREATE TABLE IF NOT EXISTS "group_room_members" (
  "id" serial PRIMARY KEY NOT NULL,
  "roomId" integer NOT NULL,
  "userId" integer NOT NULL,
  "personaId" integer NOT NULL,
  "joinedAt" timestamp DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "group_room_members_room_persona_idx"
  ON "group_room_members" ("roomId", "personaId");
CREATE INDEX IF NOT EXISTS "group_room_members_room_idx"
  ON "group_room_members" ("roomId", "userId");
CREATE INDEX IF NOT EXISTS "group_room_members_persona_idx"
  ON "group_room_members" ("personaId", "userId");

CREATE TABLE IF NOT EXISTS "group_messages" (
  "id" serial PRIMARY KEY NOT NULL,
  "roomId" integer NOT NULL,
  "userId" integer NOT NULL,
  "role" "message_role" NOT NULL,
  "personaId" integer,
  "content" text NOT NULL,
  "metadata" jsonb,
  "createdAt" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "group_messages_room_time_idx"
  ON "group_messages" ("roomId", "createdAt");
CREATE INDEX IF NOT EXISTS "group_messages_user_idx"
  ON "group_messages" ("userId");
CREATE INDEX IF NOT EXISTS "group_messages_persona_idx"
  ON "group_messages" ("personaId", "userId");

-- mirrai: down
DROP INDEX IF EXISTS "group_messages_persona_idx";
DROP INDEX IF EXISTS "group_messages_user_idx";
DROP INDEX IF EXISTS "group_messages_room_time_idx";
DROP TABLE IF EXISTS "group_messages";
DROP INDEX IF EXISTS "group_room_members_persona_idx";
DROP INDEX IF EXISTS "group_room_members_room_idx";
DROP INDEX IF EXISTS "group_room_members_room_persona_idx";
DROP TABLE IF EXISTS "group_room_members";
DROP INDEX IF EXISTS "group_rooms_user_idx";
DROP TABLE IF EXISTS "group_rooms";
ALTER TABLE IF EXISTS "users" DROP COLUMN IF EXISTS "features";
