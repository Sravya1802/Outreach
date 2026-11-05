-- 042_finish_screens.sql
-- repo_verified_at: when the app last opened a built project's GitHub link. A built
-- project without one can't go on a resume.
-- notified_at: a finished run has been announced. Runs before this one never are.
-- referrers: a person the user can ask at a company. Roles there skip recruiter
-- outreach: a new queue row starts on My contact, and a run writes no drafts for it.
-- Additive and idempotent.

ALTER TABLE planned_projects ADD COLUMN IF NOT EXISTS repo_verified_at TIMESTAMPTZ;

ALTER TABLE pipeline_runs ADD COLUMN IF NOT EXISTS notified_at TIMESTAMPTZ;
UPDATE pipeline_runs SET notified_at = NOW() WHERE notified_at IS NULL AND finished_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS referrers (
  id            BIGSERIAL   PRIMARY KEY,
  user_id       UUID        NOT NULL,
  company_name  TEXT        NOT NULL,
  contact_name  TEXT        NOT NULL,
  note          TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS referrers_company ON referrers (user_id, lower(company_name));
ALTER TABLE referrers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON referrers FROM anon, authenticated;

CREATE OR REPLACE FUNCTION tailor_jobs_referrer() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM referrers r JOIN plan_items pi ON pi.id = NEW.plan_item_id
              WHERE r.user_id = NEW.user_id AND lower(r.company_name) = lower(trim(pi.company_name))) THEN
    NEW.referral_mode := 'my_contact';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS tailor_jobs_referrer ON tailor_jobs;
CREATE TRIGGER tailor_jobs_referrer BEFORE INSERT ON tailor_jobs FOR EACH ROW EXECUTE FUNCTION tailor_jobs_referrer();
