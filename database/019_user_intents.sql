BEGIN;

-- Snapshots are append-only in application code; corrections create a new revision.
CREATE TABLE IF NOT EXISTS tarot_user_intents (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES tarot_users(id) ON DELETE CASCADE,
  previous_id uuid,
  revision integer NOT NULL CHECK (revision > 0),
  snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, id),
  FOREIGN KEY (user_id, previous_id) REFERENCES tarot_user_intents(user_id, id)
);
CREATE INDEX IF NOT EXISTS tarot_user_intents_history_idx
  ON tarot_user_intents(user_id, created_at DESC);

COMMIT;
