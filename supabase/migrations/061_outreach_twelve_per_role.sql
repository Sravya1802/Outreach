-- 061_outreach_twelve_per_role.sql
-- Outreach is individual emails to up to 12 people per role (user, 2026-11-20),
-- replacing 2 recruiters + 1 engineer (and 10 of your own people):
--   • 'my_contact' and 'none' still get no outreach
--   • 'recruiters': up to 12, no engineers (except people you added yourself)
--   • 'recruiters_engineers': up to 12, any mix
-- Closed rows (merged copies) don't count. The daily Gmail send cap goes from
-- 40 to 450 (Gmail allows 500 a day, which covers normal mail too). Idempotent.

CREATE OR REPLACE FUNCTION outreach_drafts_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  role_mode TEXT;
  taken     INT;
  own       BOOLEAN;
BEGIN
  IF NEW.status = 'closed' THEN RETURN NEW; END IF;
  -- Edits to a row already counted (the run writing its text, an approval) always go through.
  IF TG_OP = 'UPDATE' AND OLD.status <> 'closed' AND OLD.plan_item_id = NEW.plan_item_id THEN RETURN NEW; END IF;
  SELECT referral_mode INTO role_mode FROM tailor_jobs WHERE plan_item_id = NEW.plan_item_id;
  role_mode := COALESCE(role_mode, 'recruiters');
  IF role_mode IN ('my_contact', 'none') THEN
    RAISE EXCEPTION 'Role % emails nobody in mode %', NEW.plan_item_id, role_mode;
  END IF;
  SELECT (source = 'manual') INTO own FROM job_contacts WHERE id = NEW.contact_id;
  IF role_mode = 'recruiters' AND NEW.audience = 'engineer' AND NOT COALESCE(own, FALSE) THEN
    RAISE EXCEPTION 'Role % is in mode recruiters: no engineers', NEW.plan_item_id;
  END IF;
  SELECT COUNT(*) INTO taken FROM outreach_drafts d
   WHERE d.plan_item_id = NEW.plan_item_id AND d.status <> 'closed'
     AND (d.contact_id IS DISTINCT FROM NEW.contact_id OR NEW.contact_id IS NULL)
     AND d.id IS DISTINCT FROM NEW.id;
  IF taken >= 12 THEN
    RAISE EXCEPTION 'Role % is at its limit of 12 people', NEW.plan_item_id;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION outreach_drafts_limit() FROM PUBLIC, anon, authenticated;

ALTER TABLE gmail_connections ALTER COLUMN daily_cap SET DEFAULT 450;
UPDATE gmail_connections SET daily_cap = 450 WHERE daily_cap IN (20, 40);
