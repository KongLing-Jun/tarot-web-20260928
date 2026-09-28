BEGIN;
CREATE TABLE IF NOT EXISTS tarot_payment_orders (
  id text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES tarot_users(id) ON DELETE CASCADE,
  merchant_id text NOT NULL,
  req_date text NOT NULL,
  amount_fen integer NOT NULL CHECK (amount_fen > 0),
  points integer NOT NULL CHECK (points > 0),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'failed')),
  hf_seq_id text UNIQUE,
  request_data jsonb NOT NULL,
  pay_info jsonb,
  attempted_at timestamptz,
  lease_until timestamptz,
  next_query_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  paid_at timestamptz
);
CREATE INDEX IF NOT EXISTS tarot_payment_orders_user_idx ON tarot_payment_orders(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS tarot_payment_orders_query_idx ON tarot_payment_orders(next_query_at) WHERE status = 'pending' AND attempted_at IS NOT NULL;
CREATE TABLE IF NOT EXISTS tarot_payment_tickets (
  token_hash text PRIMARY KEY,
  order_id text NOT NULL REFERENCES tarot_payment_orders(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS tarot_credit_ledger (
  order_id text PRIMARY KEY REFERENCES tarot_payment_orders(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES tarot_users(id) ON DELETE CASCADE,
  points integer NOT NULL CHECK (points > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tarot_credit_ledger_user_idx ON tarot_credit_ledger(user_id);
COMMIT;
