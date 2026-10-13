-- 012_contact_finding.sql
-- Support the rebuilt people/email finder:
--   • remember where a company's email domain came from, so a guess is never
--     mistaken for a verified domain on the next lookup;
--   • remember per-contact lookups (when, confidence, why it missed) so a
--     miss isn't re-paid on every click;
--   • stop the same person being stored twice under name variants.
-- Additive and idempotent.

ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS domain_source TEXT;   -- override | known | stored | careers | mx | provider

ALTER TABLE job_contacts
  ADD COLUMN IF NOT EXISTS email_confidence INTEGER,
  ADD COLUMN IF NOT EXISTS email_lookup_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS email_lookup_note TEXT;

-- Empty strings were stored for "no value"; NULL lets the partial unique
-- indexes below ignore them.
UPDATE job_contacts SET linkedin_url = NULL WHERE linkedin_url = '';
UPDATE job_contacts SET email = NULL WHERE email = '';

-- One row per person per company, whichever identifier we learn first.
CREATE UNIQUE INDEX IF NOT EXISTS idx_job_contacts_user_job_email_unique
  ON job_contacts (user_id, job_id, lower(email))
  WHERE email IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_job_contacts_user_job_linkedin_unique
  ON job_contacts (user_id, job_id, lower(linkedin_url))
  WHERE linkedin_url IS NOT NULL;
