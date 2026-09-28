BEGIN;

-- Add a one-card offer without overwriting later plan edits on reruns.
INSERT INTO tarot_plans (id, name, amount_fen, points, sort_order, is_active)
VALUES ('plan_1', '1 次卡', 1, 1, 0, true)
ON CONFLICT (id) DO NOTHING;

COMMIT;
