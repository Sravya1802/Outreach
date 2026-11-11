-- 044_engineers_by_default.sql
-- Outreach goes to the best 2 recruiters and 1 engineer unless the user picks
-- otherwise. Roles still waiting for their outreach switch too; a role whose
-- outreach is already written keeps its mode (a run never rewrites outreach).
-- Idempotent.
ALTER TABLE tailor_jobs ALTER COLUMN referral_mode SET DEFAULT 'recruiters_engineers';

UPDATE tailor_jobs j SET referral_mode = 'recruiters_engineers', updated_at = NOW()
 WHERE j.referral_mode = 'recruiters'
   AND j.status IN ('queued', 'in_progress', 'ready', 'revision_requested')
   AND NOT EXISTS (SELECT 1 FROM outreach_drafts d WHERE d.plan_item_id = j.plan_item_id);
