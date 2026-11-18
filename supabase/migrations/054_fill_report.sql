-- 054_fill_report.sql
-- Ready to submit: what the browser extension filled on a role's application
-- (count, questions left for the user, resume attached), and the role's own
-- company-board link found for a LinkedIn posting. Idempotent.
ALTER TABLE plan_items ADD COLUMN IF NOT EXISTS fill_report JSONB;
