-- 036_plan_review_mode.sql
-- Per role on the evening list: 'auto' = once approved, the app takes it all the
-- way to applying; 'review' = the app writes the resume, then waits for the user
-- to read it and choose "Send it" (the app continues) or apply themselves.
-- Additive and idempotent; existing rows stay 'auto' (today's behaviour).
ALTER TABLE plan_items ADD COLUMN IF NOT EXISTS apply_mode TEXT NOT NULL DEFAULT 'auto';
ALTER TABLE plan_items DROP CONSTRAINT IF EXISTS plan_items_apply_mode_check;
ALTER TABLE plan_items ADD CONSTRAINT plan_items_apply_mode_check CHECK (apply_mode IN ('auto', 'review'));
