BEGIN;

-- Serialize ledger writes while installing the balance table and its backfill.
LOCK TABLE tarot_credit_ledger IN SHARE ROW EXCLUSIVE MODE;

CREATE TABLE IF NOT EXISTS tarot_user_credits (
  user_id uuid PRIMARY KEY REFERENCES tarot_users(id) ON DELETE CASCADE,
  balance bigint NOT NULL DEFAULT 0 CHECK (balance >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE tarot_user_credits IS
  'Current user credit balances. Users without a row have zero credits.';

-- Preserve existing balances when migrations are rerun.
INSERT INTO tarot_user_credits (user_id, balance)
SELECT user_id, sum(points) FROM tarot_credit_ledger GROUP BY user_id
ON CONFLICT (user_id) DO NOTHING;

CREATE OR REPLACE FUNCTION tarot_increment_user_credits()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO tarot_user_credits (user_id, balance)
  VALUES (NEW.user_id, NEW.points)
  ON CONFLICT (user_id) DO UPDATE
  SET balance = tarot_user_credits.balance + EXCLUDED.balance,
      updated_at = now();
  RETURN NEW;
END;
$$;

-- Replayed settlements do not insert a ledger row, so they never add credits.
DROP TRIGGER IF EXISTS tarot_credit_ledger_balance_insert ON tarot_credit_ledger;
CREATE TRIGGER tarot_credit_ledger_balance_insert
AFTER INSERT ON tarot_credit_ledger
FOR EACH ROW EXECUTE FUNCTION tarot_increment_user_credits();

COMMIT;
