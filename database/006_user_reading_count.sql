BEGIN;

-- Keep writes out while installing the counter and backfilling existing users.
LOCK TABLE tarot_readings IN SHARE ROW EXCLUSIVE MODE;

ALTER TABLE tarot_users
  ADD COLUMN IF NOT EXISTS reading_count integer NOT NULL DEFAULT 0 CHECK (reading_count >= 0);

COMMENT ON COLUMN tarot_users.reading_count IS
  'Lifetime saved reading count; excludes daily cards and follow-ups. Deleting history does not decrease it.';

-- Migrations may be rerun: never reset accumulated counts after history deletion.
UPDATE tarot_users u
SET reading_count = GREATEST(u.reading_count, history.total)
FROM (
  SELECT user_id, count(*)::integer AS total FROM tarot_readings GROUP BY user_id
) history
WHERE u.id = history.user_id AND u.reading_count < history.total;

CREATE OR REPLACE FUNCTION tarot_increment_reading_count()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE tarot_users SET reading_count = reading_count + 1 WHERE id = NEW.user_id;
  RETURN NEW;
END;
$$;

-- AFTER INSERT only fires for a new row, not the UPDATE branch of an upsert.
DROP TRIGGER IF EXISTS tarot_readings_count_insert ON tarot_readings;
CREATE TRIGGER tarot_readings_count_insert
AFTER INSERT ON tarot_readings
FOR EACH ROW EXECUTE FUNCTION tarot_increment_reading_count();

COMMIT;
