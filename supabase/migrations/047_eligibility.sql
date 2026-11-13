-- 047_eligibility.sql
-- Roles the user (F-1 MS CS, graduating May 2027) can't take, read from the job
-- description (eligibilityFor in backend/services/eligibility.js):
--   * scraped_roles.ineligible_reason: citizenship | clearance | mba | phd |
--     return_to_school, with the exact phrase that matched. Hidden from the
--     Roles tab and the daily list, never queued. The Roles tab's Removed
--     filter lists them; Restore sets eligibility_restored_at, which wins.
--   * scraped_roles.eligibility_flag: something close but not clearly a bar
--     ("Check eligibility"); the role stays.
--   * eligibility_checked_at: when the posting was last checked. A new or
--     changed description clears it (trigger), so the hourly check reads it again.
--   * tailor_jobs.closed_reason: why a queued or Ready role was closed
--     (the reasons above, field, posting_closed, deadline_passed). Rows are
--     closed, never deleted.
-- Idempotent.

ALTER TABLE scraped_roles ADD COLUMN IF NOT EXISTS ineligible_reason       TEXT;
ALTER TABLE scraped_roles ADD COLUMN IF NOT EXISTS ineligible_phrase       TEXT;
ALTER TABLE scraped_roles ADD COLUMN IF NOT EXISTS eligibility_flag        TEXT;
ALTER TABLE scraped_roles ADD COLUMN IF NOT EXISTS eligibility_checked_at   TIMESTAMPTZ;
ALTER TABLE scraped_roles ADD COLUMN IF NOT EXISTS eligibility_restored_at TIMESTAMPTZ;
ALTER TABLE scraped_roles DROP CONSTRAINT IF EXISTS scraped_roles_ineligible_reason_check;
ALTER TABLE scraped_roles ADD CONSTRAINT scraped_roles_ineligible_reason_check
  CHECK (ineligible_reason IS NULL OR ineligible_reason IN ('citizenship', 'clearance', 'mba', 'phd', 'return_to_school'));
CREATE INDEX IF NOT EXISTS scraped_roles_ineligible_idx ON scraped_roles (ineligible_reason) WHERE ineligible_reason IS NOT NULL;
CREATE INDEX IF NOT EXISTS scraped_roles_eligibility_unchecked_idx ON scraped_roles (id) WHERE eligibility_checked_at IS NULL;

CREATE OR REPLACE FUNCTION scraped_roles_recheck_eligibility() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.description IS DISTINCT FROM OLD.description
     OR NEW.sponsorship_quote IS DISTINCT FROM OLD.sponsorship_quote
     OR NEW.title IS DISTINCT FROM OLD.title THEN
    NEW.eligibility_checked_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS scraped_roles_recheck_eligibility ON scraped_roles;
CREATE TRIGGER scraped_roles_recheck_eligibility BEFORE UPDATE ON scraped_roles
  FOR EACH ROW EXECUTE FUNCTION scraped_roles_recheck_eligibility();
REVOKE ALL ON FUNCTION scraped_roles_recheck_eligibility() FROM PUBLIC, anon, authenticated;

ALTER TABLE tailor_jobs ADD COLUMN IF NOT EXISTS closed_reason TEXT;
