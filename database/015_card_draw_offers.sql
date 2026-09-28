BEGIN;

-- Keep stable plan IDs and all existing order snapshots and user balances.
-- Matching the previous defaults makes repeated migrations preserve later edits.
UPDATE tarot_plans AS plan
SET name = offers.new_name,
    amount_fen = offers.new_amount_fen,
    points = offers.new_points,
    updated_at = now()
FROM (VALUES
  ('plan_100', '100次抽卡套餐', 1000, 100, '5 次卡', 1000, 5),
  ('plan_300', '300次抽卡套餐', 2000, 300, '月订阅', 2880, 20),
  ('plan_1000', '1000次抽卡套餐', 5000, 1000, '年订阅', 9800, 100)
) AS offers(id, old_name, old_amount_fen, old_points, new_name, new_amount_fen, new_points)
WHERE plan.id = offers.id
  AND plan.name = offers.old_name
  AND plan.amount_fen = offers.old_amount_fen
  AND plan.points = offers.old_points;

COMMIT;
