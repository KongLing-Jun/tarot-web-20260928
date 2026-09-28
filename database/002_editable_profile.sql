BEGIN;

-- Keep all session/history foreign keys on the immutable internal UUID.
ALTER TABLE tarot_users ADD COLUMN IF NOT EXISTS profile_id text
  CHECK (profile_id ~ '^[A-Za-z0-9_]{4,24}$');
CREATE UNIQUE INDEX IF NOT EXISTS tarot_users_profile_id_unique
  ON tarot_users (lower(profile_id)) WHERE profile_id IS NOT NULL;

COMMIT;
