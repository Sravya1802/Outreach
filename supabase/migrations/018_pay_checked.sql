-- 018_pay_checked.sql
-- When the posted-pay lookup (services/payEnricher.js) last looked at a role,
-- so roles whose posting states no pay aren't re-fetched every day.
-- Additive and idempotent.

ALTER TABLE scraped_roles ADD COLUMN IF NOT EXISTS pay_checked_at TIMESTAMPTZ;
