BEGIN;

-- Amount and credits remain order snapshots even if a plan is edited or removed.
ALTER TABLE tarot_payment_orders
  ADD COLUMN IF NOT EXISTS plan_id text REFERENCES tarot_plans(id) ON DELETE SET NULL;

COMMIT;
