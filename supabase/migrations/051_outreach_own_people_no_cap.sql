-- 051_outreach_own_people_no_cap.sql
-- People the user added themselves (job_contacts.source = 'manual') get a
-- draft each, however many they paste (200 a role as a sanity bound against a
-- stray paste). Found contacts keep 2 recruiters + 1 engineer; 'my_contact'
-- and 'none' still get no outreach. Replaces the function from 050. Idempotent.

CREATE OR REPLACE FUNCTION outreach_drafts_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  role_mode TEXT;
  allowed   INT;
  taken     INT;
  own       BOOLEAN;
BEGIN
  SELECT referral_mode INTO role_mode FROM tailor_jobs WHERE plan_item_id = NEW.plan_item_id;
  role_mode := COALESCE(role_mode, 'recruiters');
  SELECT (source = 'manual') INTO own FROM job_contacts WHERE id = NEW.contact_id;
  IF COALESCE(own, FALSE) THEN
    allowed := CASE WHEN role_mode IN ('my_contact', 'none') THEN 0 ELSE 200 END;
    SELECT COUNT(*) INTO taken FROM outreach_drafts d JOIN job_contacts c ON c.id = d.contact_id
     WHERE d.plan_item_id = NEW.plan_item_id AND c.source = 'manual' AND d.contact_id IS DISTINCT FROM NEW.contact_id;
    IF taken >= allowed THEN
      RAISE EXCEPTION 'Role % has % of your own people already (mode %)', NEW.plan_item_id, allowed, role_mode;
    END IF;
    RETURN NEW;
  END IF;
  allowed := CASE
    WHEN role_mode IN ('my_contact', 'none') THEN 0
    WHEN NEW.audience = 'recruiter' THEN 2
    WHEN role_mode = 'recruiters_engineers' THEN 1
    ELSE 0
  END;
  SELECT COUNT(*) INTO taken FROM outreach_drafts d LEFT JOIN job_contacts c ON c.id = d.contact_id
   WHERE d.plan_item_id = NEW.plan_item_id AND d.audience = NEW.audience AND COALESCE(c.source, '') <> 'manual'
     AND (d.contact_id IS DISTINCT FROM NEW.contact_id OR NEW.contact_id IS NULL);
  IF taken >= allowed THEN
    RAISE EXCEPTION 'Role % is at its limit of % %(s) in mode %', NEW.plan_item_id, allowed, NEW.audience, role_mode;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION outreach_drafts_limit() FROM PUBLIC, anon, authenticated;
