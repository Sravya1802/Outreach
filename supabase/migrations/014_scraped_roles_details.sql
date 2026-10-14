-- 014_scraped_roles_details.sql
-- Keep what curated lists (SpeedyApply) publish beyond title/company/link:
--   company_url — the company's own website (lets Find Emails skip domain
--                 guessing for roles tracked from the catalog);
--   tier        — 'faang' | 'quant' | 'other' section the posting was listed in;
--   region      — 'usa' | 'intl' (SpeedyApply publishes separate USA and
--                 international lists; everything else is US-filtered).
-- salary_range / posted_at already exist and are now filled for these rows.
-- Additive and idempotent.
ALTER TABLE scraped_roles ADD COLUMN IF NOT EXISTS company_url TEXT;
ALTER TABLE scraped_roles ADD COLUMN IF NOT EXISTS tier TEXT;
ALTER TABLE scraped_roles ADD COLUMN IF NOT EXISTS region TEXT NOT NULL DEFAULT 'usa';
CREATE INDEX IF NOT EXISTS idx_scraped_roles_region ON scraped_roles (role_type, region) WHERE is_active = 1;
-- tracks — which field lists a posting belongs to: {'swe'}, {'ai'} or both
-- (SpeedyApply's SWE and AI repos overlap; other sources are classified by title).
ALTER TABLE scraped_roles ADD COLUMN IF NOT EXISTS tracks TEXT[] NOT NULL DEFAULT '{}';
CREATE INDEX IF NOT EXISTS idx_scraped_roles_tracks ON scraped_roles USING GIN (tracks);
CREATE INDEX IF NOT EXISTS idx_scraped_roles_tier ON scraped_roles (role_type, tier) WHERE is_active = 1;
