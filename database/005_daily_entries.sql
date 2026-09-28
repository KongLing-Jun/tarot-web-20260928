BEGIN;

CREATE TABLE IF NOT EXISTS tarot_daily_entries (
  user_id uuid NOT NULL REFERENCES tarot_users(id) ON DELETE CASCADE,
  date_key date NOT NULL,
  card_id text NOT NULL,
  is_reversed boolean NOT NULL,
  note text NOT NULL DEFAULT '' CHECK (length(note) <= 10000),
  note_updated_at timestamptz,
  interpretation text NOT NULL DEFAULT '',
  interpretation_status text CHECK (interpretation_status IN ('pending', 'done', 'error', 'cancelled')),
  exchange_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, date_key)
);

COMMIT;
