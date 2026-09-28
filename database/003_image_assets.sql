BEGIN;

CREATE TABLE IF NOT EXISTS tarot_image_assets (
  asset_key text PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('static', 'avatar')),
  user_id uuid REFERENCES tarot_users(id) ON DELETE CASCADE,
  object_key text NOT NULL UNIQUE,
  url text NOT NULL CHECK (url LIKE 'https://%'),
  content_type text NOT NULL,
  byte_size bigint NOT NULL CHECK (byte_size > 0),
  sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((kind = 'static' AND user_id IS NULL) OR (kind = 'avatar' AND user_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS tarot_image_assets_user_idx ON tarot_image_assets(user_id)
  WHERE user_id IS NOT NULL;

COMMIT;
