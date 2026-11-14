-- 048_no_opt_badge.sql
-- A posting that says OPT / CPT / F-1 students aren't eligible is never a
-- reason to remove a role (the user applies anyway): the words are saved
-- (no_opt_phrase, set by the hourly eligibility check) for a "Says no OPT/CPT"
-- badge, and such a role still goes to the queue even when the sponsorship
-- check calls it "won't sponsor". Idempotent.
ALTER TABLE scraped_roles ADD COLUMN IF NOT EXISTS no_opt_phrase TEXT;
