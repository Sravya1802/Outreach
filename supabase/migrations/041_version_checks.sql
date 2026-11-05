-- 041_version_checks.sql
-- What the VM found when it compiled a run's resume. check_status is 'passed' or
-- 'flagged'; a flagged version can't be approved. keywords holds how many of the
-- report's keywords are in the PDF word for word: the table lists concepts too,
-- so a miss is shown to the user and never flags a version.
-- Additive and idempotent.

ALTER TABLE resume_versions ADD COLUMN IF NOT EXISTS pages        INT;
ALTER TABLE resume_versions ADD COLUMN IF NOT EXISTS check_status TEXT;
ALTER TABLE resume_versions ADD COLUMN IF NOT EXISTS check_errors JSONB NOT NULL DEFAULT '[]';
ALTER TABLE resume_versions ADD COLUMN IF NOT EXISTS keywords     JSONB;
ALTER TABLE resume_versions ADD COLUMN IF NOT EXISTS checked_at   TIMESTAMPTZ;
ALTER TABLE resume_versions DROP CONSTRAINT IF EXISTS resume_versions_check_status_check;
ALTER TABLE resume_versions ADD CONSTRAINT resume_versions_check_status_check
  CHECK (check_status IS NULL OR check_status IN ('passed', 'flagged'));

DROP INDEX IF EXISTS resume_versions_to_compile;
CREATE INDEX IF NOT EXISTS resume_versions_to_check ON resume_versions (created_at) WHERE checked_at IS NULL;
