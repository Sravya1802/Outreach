-- 033_tracker_referral.sql
-- The Applications → Tracker sheet: a referral column on each application,
-- set by the user (or by a sheet import). The referral flow's own progress on
-- plan_items.referral_status shows when this is empty.
-- Additive and idempotent.

ALTER TABLE evaluations ADD COLUMN IF NOT EXISTS referral_status TEXT;
ALTER TABLE evaluations DROP CONSTRAINT IF EXISTS evaluations_referral_status_check;
ALTER TABLE evaluations ADD CONSTRAINT evaluations_referral_status_check
  CHECK (referral_status IS NULL OR referral_status IN ('yes', 'no', 'not_required', 'asked'));
