-- 023_resume_engine.sql
-- The resume engine (backend/services/resumeEngine.js):
--   • resume_files.parsed — the master resume read into sections once per
--     upload, so tailoring never re-reads the PDF.
--   • resume_files kind 'cover_letter'.
--   • resume_tailorings — one row per tailoring or cover-letter run: status,
--     ATS score with its breakdown, the change report, and what it cost.
-- Additive and idempotent.

ALTER TABLE resume_files ADD COLUMN IF NOT EXISTS parsed    JSONB;
ALTER TABLE resume_files ADD COLUMN IF NOT EXISTS parsed_at TIMESTAMPTZ;

ALTER TABLE resume_files DROP CONSTRAINT IF EXISTS resume_files_kind_check;
ALTER TABLE resume_files ADD CONSTRAINT resume_files_kind_check
  CHECK (kind IN ('master', 'tailored', 'uploaded', 'library', 'cover_letter'));

CREATE TABLE IF NOT EXISTS resume_tailorings (
  id               BIGSERIAL   PRIMARY KEY,
  user_id          UUID        NOT NULL,
  evaluation_id    BIGINT      NOT NULL REFERENCES evaluations(id) ON DELETE CASCADE,
  kind             TEXT        NOT NULL DEFAULT 'resume' CHECK (kind IN ('resume', 'cover_letter')),
  -- running → ready (ATS ≥ 90) | needs_review (under 90: the user decides) | failed
  status           TEXT        NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'ready', 'needs_review', 'failed')),
  master_file_id   BIGINT      REFERENCES resume_files(id) ON DELETE SET NULL,
  file_id          BIGINT      REFERENCES resume_files(id) ON DELETE SET NULL,
  ats_score        INT,
  ats              JSONB,      -- coverage, matched/missing keywords, format checks
  report           JSONB,      -- changes, project choices, what was removed and why
  error            TEXT,
  cost_usd         NUMERIC(10, 5) NOT NULL DEFAULT 0,
  -- set when the user chooses to send an under-90 resume anyway
  approved_at      TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS resume_tailorings_eval ON resume_tailorings (evaluation_id, kind, id DESC);
CREATE INDEX IF NOT EXISTS resume_tailorings_user ON resume_tailorings (user_id, created_at DESC);
