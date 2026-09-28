BEGIN;

CREATE TABLE IF NOT EXISTS tarot_plans (
  id text PRIMARY KEY,
  name text NOT NULL,
  amount_fen integer NOT NULL CHECK (amount_fen > 0),
  points integer NOT NULL CHECK (points > 0),
  sort_order integer NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE tarot_plans IS 'Credit recharge plans; prices are stored in fen.';

-- Stable IDs make seeding repeatable without overwriting later plan edits.
INSERT INTO tarot_plans (id, name, amount_fen, points, sort_order)
VALUES
  ('plan_100', '100积分套餐', 1000, 100, 1),
  ('plan_300', '300积分套餐', 2000, 300, 2),
  ('plan_1000', '1000积分套餐', 5000, 1000, 3)
ON CONFLICT (id) DO NOTHING;

COMMIT;
