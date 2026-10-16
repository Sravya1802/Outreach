-- 031_plan_contacts.sql
-- People are looked up for the evening list's best roles before the user
-- decides (referralFlow.prepareContacts), so contacts are ready in People and
-- for the referral step.
--   • contacts_at — when this role's company was checked
--   • contacts_lookup — a lookup actually ran (counts toward the per-list cap)
-- Additive and idempotent.

ALTER TABLE plan_items ADD COLUMN IF NOT EXISTS contacts_at     TIMESTAMPTZ;
ALTER TABLE plan_items ADD COLUMN IF NOT EXISTS contacts_lookup BOOLEAN NOT NULL DEFAULT false;
