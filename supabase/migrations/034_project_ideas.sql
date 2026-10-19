-- 034_project_ideas.sql
-- Projects suggested from the roles on the user's evening lists (weekly, or
-- on demand), not only from one weak-fit resume. `origin` says which;
-- `demand` records why: how many listed roles ask for the skills it adds.
--   demand = { roles, of, keywords: [{ term, roles }], examples: ["Company · Title"] }
-- Additive and idempotent.

ALTER TABLE planned_projects ADD COLUMN IF NOT EXISTS origin TEXT NOT NULL DEFAULT 'role';
ALTER TABLE planned_projects ADD COLUMN IF NOT EXISTS demand JSONB;
