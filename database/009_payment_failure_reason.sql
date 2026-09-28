BEGIN;
ALTER TABLE tarot_payment_orders ADD COLUMN IF NOT EXISTS failure_reason text;
COMMIT;
