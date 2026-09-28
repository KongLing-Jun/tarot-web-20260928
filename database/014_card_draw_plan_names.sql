BEGIN;

-- Rename only the original seeded names; preserve customized plans and balances.
UPDATE tarot_plans AS plan
SET name = names.new_name, updated_at = now()
FROM (VALUES
  ('plan_100', '100积分套餐', '100次抽卡套餐'),
  ('plan_300', '300积分套餐', '300次抽卡套餐'),
  ('plan_1000', '1000积分套餐', '1000次抽卡套餐')
) AS names(id, old_name, new_name)
WHERE plan.id = names.id AND plan.name = names.old_name;

COMMIT;
