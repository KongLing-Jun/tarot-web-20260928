BEGIN;

CREATE TABLE IF NOT EXISTS tarot_users (
  id uuid PRIMARY KEY,
  wechat_app_id text NOT NULL,
  wechat_open_id text NOT NULL,
  wechat_union_id text,
  nickname text NOT NULL,
  avatar_url text NOT NULL DEFAULT '/avatars/default.svg',
  created_at timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (wechat_app_id, wechat_open_id)
);

CREATE TABLE IF NOT EXISTS tarot_sessions (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES tarot_users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tarot_sessions_expiry_idx ON tarot_sessions(expires_at);

CREATE TABLE IF NOT EXISTS tarot_login_tickets (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES tarot_users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS tarot_login_tickets_expiry_idx ON tarot_login_tickets(expires_at);

-- Rich reading data retains the existing spread/card/follow-up format.
CREATE TABLE IF NOT EXISTS tarot_readings (
  user_id uuid NOT NULL REFERENCES tarot_users(id) ON DELETE CASCADE,
  id text NOT NULL,
  data jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, id)
);
CREATE INDEX IF NOT EXISTS tarot_readings_history_idx ON tarot_readings(user_id, created_at DESC, id DESC);

-- One row per user/assistant message. An exchange groups one request and reply.
-- The server writes these independently of the browser saving a reading.
CREATE TABLE IF NOT EXISTS tarot_chat_messages (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES tarot_users(id) ON DELETE CASCADE,
  exchange_id uuid NOT NULL,
  role text NOT NULL CHECK (role IN ('user', 'assistant')),
  content text NOT NULL DEFAULT '',
  status text NOT NULL CHECK (status IN ('pending', 'done', 'error', 'cancelled')),
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (exchange_id, role)
);
CREATE INDEX IF NOT EXISTS tarot_chat_messages_history_idx ON tarot_chat_messages(user_id, created_at DESC, id DESC);

COMMIT;
