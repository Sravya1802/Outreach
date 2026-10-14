-- 020_role_sponsorship.sql
-- What each role's job description says about visa sponsorship, read by
-- services/payEnricher.js (enrichPostingDetails) with services/sponsorship.js:
--   sponsors | no_sponsorship | citizens_only | NULL (not stated / not read)
-- sponsorship_quote keeps the sentence that decided it, so the label is checkable.
-- Additive and idempotent.

ALTER TABLE scraped_roles
  ADD COLUMN IF NOT EXISTS sponsorship TEXT CHECK (sponsorship IN ('sponsors', 'no_sponsorship', 'citizens_only')),
  ADD COLUMN IF NOT EXISTS sponsorship_quote TEXT,
  ADD COLUMN IF NOT EXISTS jd_checked_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS scraped_roles_sponsorship ON scraped_roles (sponsorship) WHERE is_active = 1;

-- Cross-source matching in the roles list compares company names case-insensitively.
CREATE INDEX IF NOT EXISTS scraped_roles_company_lower ON scraped_roles (lower(company_name)) WHERE is_active = 1;
