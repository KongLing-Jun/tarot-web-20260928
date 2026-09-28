BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- Existing and new accounts are both eligible until an explicit terminal action.
ALTER TABLE tarot_users
  ADD COLUMN IF NOT EXISTS product_tour_version integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS product_tour_status text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'tarot_users'::regclass AND conname = 'tarot_users_product_tour_state_check'
  ) THEN
    ALTER TABLE tarot_users ADD CONSTRAINT tarot_users_product_tour_state_check CHECK (
      (product_tour_version = 0 AND product_tour_status IS NULL)
      OR (product_tour_version > 0 AND product_tour_status IS NOT NULL
          AND product_tour_status IN ('completed', 'skipped'))
    );
  END IF;
END;
$$;

COMMIT;
