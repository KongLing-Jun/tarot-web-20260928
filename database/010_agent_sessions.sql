BEGIN;

-- Only ordered task references live here; replies remain in readings/messages.
CREATE TABLE IF NOT EXISTS tarot_agent_sessions (
  user_id uuid PRIMARY KEY REFERENCES tarot_users(id) ON DELETE CASCADE,
  tasks jsonb NOT NULL DEFAULT '[]'::jsonb,
  revision integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMIT;
