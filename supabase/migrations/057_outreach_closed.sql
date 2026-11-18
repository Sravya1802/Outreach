-- 057_outreach_closed.sql
-- One email per person per company: duplicate drafts are merged into one
-- (on the best-fit role) and the other copies are closed, never deleted.
-- A closed draft keeps its text, says why (closed_reason) and when, and no
-- longer counts toward a role's outreach limit. Idempotent.
ALTER TABLE outreach_drafts DROP CONSTRAINT IF EXISTS outreach_drafts_status_check;
ALTER TABLE outreach_drafts ADD CONSTRAINT outreach_drafts_status_check CHECK (status IN ('draft', 'edited', 'approved', 'sent', 'closed'));
ALTER TABLE outreach_drafts ADD COLUMN IF NOT EXISTS closed_reason TEXT;
ALTER TABLE outreach_drafts ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ;

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
  IF NEW.status = 'closed' THEN RETURN NEW; END IF;
  SELECT referral_mode INTO role_mode FROM tailor_jobs WHERE plan_item_id = NEW.plan_item_id;
  role_mode := COALESCE(role_mode, 'recruiters');
  SELECT (source = 'manual') INTO own FROM job_contacts WHERE id = NEW.contact_id;
  IF COALESCE(own, FALSE) THEN
    allowed := CASE WHEN role_mode IN ('my_contact', 'none') THEN 0 ELSE 10 END;
    SELECT COUNT(*) INTO taken FROM outreach_drafts d JOIN job_contacts c ON c.id = d.contact_id
     WHERE d.plan_item_id = NEW.plan_item_id AND c.source = 'manual' AND d.contact_id IS DISTINCT FROM NEW.contact_id AND d.status <> 'closed';
    IF taken >= allowed THEN
      RAISE EXCEPTION 'Role % is at its limit of % of your own people in mode %', NEW.plan_item_id, allowed, role_mode;
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
   WHERE d.plan_item_id = NEW.plan_item_id AND d.audience = NEW.audience AND COALESCE(c.source, '') <> 'manual' AND d.status <> 'closed'
     AND (d.contact_id IS DISTINCT FROM NEW.contact_id OR NEW.contact_id IS NULL);
  IF taken >= allowed THEN
    RAISE EXCEPTION 'Role % is at its limit of % %(s) in mode %', NEW.plan_item_id, allowed, NEW.audience, role_mode;
  END IF;
  RETURN NEW;
END;
$$;
