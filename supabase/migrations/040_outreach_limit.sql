-- 040_outreach_limit.sql
-- At most 2 recruiters per role, plus 1 engineer when the role's mode allows it.
-- referral_mode: 'recruiters' (default), 'recruiters_engineers', or 'my_contact'
-- and 'none', which get no outreach. The limit is checked here too because a
-- run writes these rows, and a company can have 64 contacts.
-- Additive and idempotent.

ALTER TABLE tailor_jobs ADD COLUMN IF NOT EXISTS referral_mode TEXT NOT NULL DEFAULT 'recruiters';
ALTER TABLE tailor_jobs DROP CONSTRAINT IF EXISTS tailor_jobs_referral_mode_check;
ALTER TABLE tailor_jobs ADD CONSTRAINT tailor_jobs_referral_mode_check
  CHECK (referral_mode IN ('recruiters', 'recruiters_engineers', 'my_contact', 'none'));

ALTER TABLE outreach_drafts ADD COLUMN IF NOT EXISTS audience TEXT NOT NULL DEFAULT 'recruiter';
ALTER TABLE outreach_drafts DROP CONSTRAINT IF EXISTS outreach_drafts_audience_check;
ALTER TABLE outreach_drafts ADD CONSTRAINT outreach_drafts_audience_check CHECK (audience IN ('recruiter', 'engineer'));

CREATE OR REPLACE FUNCTION outreach_drafts_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  role_mode TEXT;
  allowed   INT;
  taken     INT;
BEGIN
  SELECT referral_mode INTO role_mode FROM tailor_jobs WHERE plan_item_id = NEW.plan_item_id;
  role_mode := COALESCE(role_mode, 'recruiters');
  allowed := CASE
    WHEN role_mode IN ('my_contact', 'none') THEN 0
    WHEN NEW.audience = 'recruiter' THEN 2
    WHEN role_mode = 'recruiters_engineers' THEN 1
    ELSE 0
  END;
  SELECT COUNT(*) INTO taken FROM outreach_drafts
   WHERE plan_item_id = NEW.plan_item_id AND audience = NEW.audience
     AND (contact_id IS DISTINCT FROM NEW.contact_id OR NEW.contact_id IS NULL);
  IF taken >= allowed THEN
    RAISE EXCEPTION 'Role % is at its limit of % %(s) in mode %', NEW.plan_item_id, allowed, NEW.audience, role_mode;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS outreach_drafts_limit ON outreach_drafts;
CREATE TRIGGER outreach_drafts_limit BEFORE INSERT ON outreach_drafts
  FOR EACH ROW EXECUTE FUNCTION outreach_drafts_limit();

REVOKE ALL ON FUNCTION outreach_drafts_limit() FROM PUBLIC, anon, authenticated;
