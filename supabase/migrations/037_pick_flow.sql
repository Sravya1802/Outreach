-- 037_pick_flow.sql
-- The day's roles go out in the morning and the user picks each one:
-- 'app' = the app drafts the resume now and waits for Approve at list time;
-- 'self' = the user writes it (reminded at list time), then uploads it for the
-- app to apply or marks it applied. NULL = not picked yet (expires with the list).
-- daily_plans.update_at / evening_at: the 2 PM update and the list-time message went out.
-- Additive and idempotent.
ALTER TABLE plan_items ADD COLUMN IF NOT EXISTS pick TEXT;
ALTER TABLE plan_items DROP CONSTRAINT IF EXISTS plan_items_pick_check;
ALTER TABLE plan_items ADD CONSTRAINT plan_items_pick_check CHECK (pick IS NULL OR pick IN ('app', 'self'));
ALTER TABLE plan_items ADD COLUMN IF NOT EXISTS picked_at TIMESTAMPTZ;
ALTER TABLE daily_plans ADD COLUMN IF NOT EXISTS update_at TIMESTAMPTZ;
ALTER TABLE daily_plans ADD COLUMN IF NOT EXISTS evening_at TIMESTAMPTZ;
