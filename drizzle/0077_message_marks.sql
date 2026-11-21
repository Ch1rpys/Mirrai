-- mirrai: idempotent-migration
--
-- Conversation management (C8.10): the star, the pin, and the topic
-- marker all point at one message of one conversation.
--
-- A topic is a road sign inside the same conversation — not a second
-- conversation. The label is the name the user gave it.
--
-- `(userId, messageId, kind)` is unique: starring the same message
-- twice is the same star, and a message cannot carry two topic names.

CREATE TABLE IF NOT EXISTS "message_marks" (
  "id" serial PRIMARY KEY NOT NULL,
  "userId" integer NOT NULL,
  "personaId" integer NOT NULL,
  "messageId" integer NOT NULL,
  "kind" varchar(8) NOT NULL,
  "label" varchar(60),
  "createdAt" timestamp DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "message_marks_user_message_kind_idx"
  ON "message_marks" ("userId", "messageId", "kind");
CREATE INDEX IF NOT EXISTS "message_marks_persona_idx"
  ON "message_marks" ("personaId", "userId", "kind");

-- mirrai: down
DROP TABLE IF EXISTS "message_marks";
