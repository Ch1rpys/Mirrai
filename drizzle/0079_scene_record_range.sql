-- mirrai: idempotent-migration
--
-- A scene drawn from a stretch of the record (C8.13).
--
-- The reader can take a day, or one consecutive run of lines, and ask
-- to talk in its context. The scene remembers the stretch as
-- `{ personaId, fromId, toId, from, to }`: the two record ids that end
-- it, the persona it came from, and the two days the interface names.
--
-- Only the ids and the days are stored. The six to twelve lines the
-- prompt carries are read out of the record when the scene is used, so
-- a later deletion or harm decision is respected instead of being
-- frozen into the scene.
--
-- A scene like this belongs to the persona it was taken from: the
-- activation refuses to attach it to another one.
--
-- The column is nullable: every scene that already exists has no
-- stretch, and behaves exactly as it did.

ALTER TABLE "scenes"
  ADD COLUMN IF NOT EXISTS "recordRange" jsonb;

-- mirrai: down
ALTER TABLE "scenes" DROP COLUMN IF EXISTS "recordRange";
