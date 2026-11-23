-- 062_gaps_versions_company_outreach.sql (user, 2026-11-23)
--   1. gap_chat: questions your hourly Claude run asks about a role's resume
--      gaps (with answer options), and your answers. The app writes no
--      question text; the run writes the questions and acts on the answers.
--   2. resume_versions.seen_at: when you first opened a version, so the
--      dashboard can mark a new one you haven't looked at. Existing versions
--      count as seen.
--   3. company_prefs.no_outreach: "No outreach for this company". The outreach
--      limit trigger refuses new rows for such a company, whoever inserts them.
--   4. tailor_jobs.outreach_cap: a role's people limit (12 unless you raise it).
-- RLS on, nothing for anon/authenticated (the API and the run use the service role). Idempotent.

CREATE TABLE IF NOT EXISTS gap_chat (
  id           BIGSERIAL PRIMARY KEY,
  user_id      UUID NOT NULL,
  plan_item_id BIGINT NOT NULL REFERENCES plan_items(id) ON DELETE CASCADE,
  sender       TEXT NOT NULL CHECK (sender IN ('claude', 'me')),
  text         TEXT NOT NULL,
  options      JSONB,
  answer       TEXT,
  status       TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'answered', 'applied')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  answered_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS gap_chat_role ON gap_chat (plan_item_id, created_at);
CREATE INDEX IF NOT EXISTS gap_chat_open ON gap_chat (user_id, status) WHERE status = 'open';
ALTER TABLE gap_chat ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON gap_chat FROM anon, authenticated;
REVOKE ALL ON SEQUENCE gap_chat_id_seq FROM anon, authenticated;

ALTER TABLE resume_versions ADD COLUMN IF NOT EXISTS seen_at TIMESTAMPTZ;
UPDATE resume_versions SET seen_at = NOW() WHERE seen_at IS NULL;

CREATE TABLE IF NOT EXISTS company_prefs (
  user_id     UUID NOT NULL,
  company_key TEXT NOT NULL,
  no_outreach BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, company_key)
);
ALTER TABLE company_prefs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON company_prefs FROM anon, authenticated;

ALTER TABLE tailor_jobs ADD COLUMN IF NOT EXISTS outreach_cap INT CHECK (outreach_cap BETWEEN 1 AND 50);

-- The outreach limit (061) with the role's own cap and the company switch.
CREATE OR REPLACE FUNCTION outreach_drafts_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  role_mode TEXT;
  role_cap  INT;
  company   TEXT;
  owner     UUID;
  taken     INT;
  own       BOOLEAN;
BEGIN
  IF NEW.status = 'closed' THEN RETURN NEW; END IF;
  -- Edits to a row already counted (the run writing its text, an approval) always go through.
  IF TG_OP = 'UPDATE' AND OLD.status <> 'closed' AND OLD.plan_item_id = NEW.plan_item_id THEN RETURN NEW; END IF;
  SELECT j.referral_mode, j.outreach_cap, lower(trim(pi.company_name)), pi.user_id INTO role_mode, role_cap, company, owner
    FROM tailor_jobs j JOIN plan_items pi ON pi.id = j.plan_item_id WHERE j.plan_item_id = NEW.plan_item_id;
  role_mode := COALESCE(role_mode, 'recruiters');
  IF role_mode IN ('my_contact', 'none') THEN
    RAISE EXCEPTION 'Role % emails nobody in mode %', NEW.plan_item_id, role_mode;
  END IF;
  IF EXISTS (SELECT 1 FROM company_prefs WHERE user_id = owner AND company_key = company AND no_outreach) THEN
    RAISE EXCEPTION 'Role %: no outreach for this company (%), by your choice', NEW.plan_item_id, company;
  END IF;
  SELECT (source = 'manual') INTO own FROM job_contacts WHERE id = NEW.contact_id;
  IF role_mode = 'recruiters' AND NEW.audience = 'engineer' AND NOT COALESCE(own, FALSE) THEN
    RAISE EXCEPTION 'Role % is in mode recruiters: no engineers', NEW.plan_item_id;
  END IF;
  SELECT COUNT(*) INTO taken FROM outreach_drafts d
   WHERE d.plan_item_id = NEW.plan_item_id AND d.status <> 'closed'
     AND (d.contact_id IS DISTINCT FROM NEW.contact_id OR NEW.contact_id IS NULL)
     AND d.id IS DISTINCT FROM NEW.id;
  IF taken >= COALESCE(role_cap, 12) THEN
    RAISE EXCEPTION 'Role % is at its limit of % people', NEW.plan_item_id, COALESCE(role_cap, 12);
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION outreach_drafts_limit() FROM PUBLIC, anon, authenticated;
