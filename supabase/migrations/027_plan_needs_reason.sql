-- 027_plan_needs_reason.sql
-- Why an approved role is at "needs you": 'resume' (ATS under target or the
-- resume failed; "Send anyway" moves it on), 'referral' (a code or a link to
-- use by hand), 'apply' (apply yourself). Only 'resume' is moved on
-- automatically. Additive and idempotent.
ALTER TABLE plan_items ADD COLUMN IF NOT EXISTS needs_reason TEXT;
ALTER TABLE plan_items DROP CONSTRAINT IF EXISTS plan_items_needs_reason_check;
ALTER TABLE plan_items ADD CONSTRAINT plan_items_needs_reason_check CHECK (needs_reason IS NULL OR needs_reason IN ('resume', 'referral', 'apply'));
-- Rows already at needs you: the referral/apply ones have a referral status set.
UPDATE plan_items SET needs_reason = CASE WHEN referral_status = 'none' AND applied_at IS NULL THEN 'resume' ELSE 'apply' END
 WHERE stage = 'needs_you' AND needs_reason IS NULL;
