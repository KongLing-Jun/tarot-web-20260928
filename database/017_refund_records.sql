BEGIN;

-- Completed refunds recorded from the payment provider's back office.
-- These records are informational; they do not change the credit balance.
CREATE TABLE IF NOT EXISTS tarot_refund_records (
  id text PRIMARY KEY,
  order_id text NOT NULL REFERENCES tarot_payment_orders(id) ON DELETE CASCADE,
  amount_fen integer NOT NULL CHECK (amount_fen > 0),
  refunded_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tarot_refund_records_order_idx ON tarot_refund_records(order_id);
CREATE INDEX IF NOT EXISTS tarot_refund_records_time_idx ON tarot_refund_records(refunded_at DESC, id);

COMMIT;
