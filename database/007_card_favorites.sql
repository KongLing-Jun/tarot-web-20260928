BEGIN;

CREATE TABLE IF NOT EXISTS tarot_card_favorites (
  user_id uuid NOT NULL REFERENCES tarot_users(id) ON DELETE CASCADE,
  card_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, card_id)
);

COMMIT;
