-- 043_outreach_due.sql
-- A Ready role whose recruiters were found after its resume was written. The next
-- run writes its emails and notes without a new resume version, then clears this.
-- Additive and idempotent.

ALTER TABLE tailor_jobs ADD COLUMN IF NOT EXISTS outreach_due BOOLEAN NOT NULL DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS tailor_jobs_outreach_due ON tailor_jobs (user_id) WHERE outreach_due;
