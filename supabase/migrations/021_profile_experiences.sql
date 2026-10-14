-- 021_profile_experiences.sql
-- Every job, internship and research role, for forms that ask for full
-- employment history (current_company / current_title stay as the newest
-- entry for older callers). Additive and idempotent.

ALTER TABLE user_profile ADD COLUMN IF NOT EXISTS experiences JSONB NOT NULL DEFAULT '[]';
