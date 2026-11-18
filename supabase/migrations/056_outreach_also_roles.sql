-- 056_outreach_also_roles.sql
-- One person, one email per company: when the same person would be asked about
-- several roles at a company, they get one outreach_drafts row, on the
-- best-fit role, and the other roles' plan_item ids are listed here so the
-- Claude run can mention them in one line ("I would also be glad to be
-- considered for ..."). Idempotent.
ALTER TABLE outreach_drafts ADD COLUMN IF NOT EXISTS also_plan_items BIGINT[];
CREATE INDEX IF NOT EXISTS outreach_drafts_also_plan_items ON outreach_drafts USING GIN (also_plan_items);
