-- mirrai: idempotent-migration
--
-- The app lock (C8.4).
--
-- `lockPinHash` is the PIN, hashed with the same scrypt the password
-- uses. It is a hash and not the PIN: the PIN is four to eight digits,
-- so a plain copy of it would be readable by anyone with the database
-- file.
--
-- `lockSettings` holds `{ enabled, idleMinutes, passkeys }`. Empty means
-- the lock is off; every read of it goes through
-- `normalizeLockSettings`, so an old row behaves exactly as it did.
--
-- Both columns are nullable and no read requires them, so the upgrade
-- is invisible to a row written before this item.

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "lockPinHash" varchar(255);

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "lockSettings" jsonb;

-- mirrai: down
ALTER TABLE "users" DROP COLUMN IF EXISTS "lockSettings";
ALTER TABLE "users" DROP COLUMN IF EXISTS "lockPinHash";
