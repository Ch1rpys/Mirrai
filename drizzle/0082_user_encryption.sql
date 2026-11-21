-- mirrai: idempotent-migration
--
-- The per-user key that encrypts the contents of the database (C8.5).
--
-- `{ enabled, wrappedKey, salt, kdf, recoveryWrappedKey? }`:
--
--  - `enabled` says whether this account's content is encrypted;
--  - `wrappedKey` is the 32-byte data key, wrapped with a key derived
--    from the login password (scrypt). The data key itself is never
--    stored;
--  - `salt` is the salt the login-password key was derived with;
--  - `recoveryWrappedKey` is the same data key wrapped with a key
--    derived from the one-time recovery code.
--
-- Empty means the account's content is plaintext, which is what every
-- row written before this migration is.
--
-- The column is nullable and every read goes through
-- `normalizeUserEncryption`, so an old row behaves exactly as it did.

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "encryption" jsonb;

-- mirrai: down
ALTER TABLE "users" DROP COLUMN IF EXISTS "encryption";
