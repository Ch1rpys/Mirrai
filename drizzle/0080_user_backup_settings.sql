-- mirrai: idempotent-migration
--
-- Where a user's scheduled backups go (C8.3).
--
-- `{ enabled, frequency, target, passphraseSecret, lastRunAt,
-- lastFileName, history }`. The passphrase that encrypts the files is
-- stored wrapped by `encryptSecret` (the key derived from JWT_SECRET),
-- so an unattended nightly backup can still be encrypted and a stolen
-- database file does not hand over the backups.
--
-- Empty (NULL) means scheduled backups are off, which is the default:
-- a feature that writes to somebody's disk every day is not something
-- to switch on for them.
--
-- The column is nullable and every read of it goes through
-- `normalizeBackupSettings`, so an old row behaves exactly as it did.

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "backupSettings" jsonb;

-- mirrai: down
ALTER TABLE "users" DROP COLUMN IF EXISTS "backupSettings";
