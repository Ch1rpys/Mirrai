-- mirrai: idempotent-migration
--
-- The channel enum gains the bot channels of C9.1: Telegram, Discord and
-- Matrix. They are stored on `messages.channel` like the two existing
-- channels, so a reply sent through a bot is attributed to the bot.
--
-- Adding a value is idempotent; PostgreSQL cannot remove one, so they stay
-- after a rollback.

ALTER TYPE "channel" ADD VALUE IF NOT EXISTS 'telegram';
ALTER TYPE "channel" ADD VALUE IF NOT EXISTS 'discord';
ALTER TYPE "channel" ADD VALUE IF NOT EXISTS 'matrix';

-- mirrai: down
-- PostgreSQL cannot remove a value from an enum type, so the three values
-- stay behind. What this rollback can do is refuse to pretend: a database
-- whose messages already use one of the channels cannot go back to a
-- version that does not know them, so it says so instead of rolling back
-- into a broken state.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "messages"
    WHERE "channel" IN ('telegram', 'discord', 'matrix')
  ) THEN
    RAISE EXCEPTION 'Cannot roll back 0084: messages already use the new channels; remove or migrate those rows first.';
  END IF;
END $$;
