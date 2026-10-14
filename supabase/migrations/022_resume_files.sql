-- 022_resume_files.sql
-- Every resume PDF lives in Supabase Storage; this table is the index.
--   master   — the PDF the user uploads on Profile → Resume (every version kept;
--              is_current marks the live one)
--   tailored — written for one evaluation
--   uploaded — the user's own PDF for one evaluation
--   library  — an archetype PDF from the older resume library, recorded the
--              first time an application uses it
-- evaluations.resume_file_id is the file that will go with that application;
-- evaluations.applied_resume_file_id is the exact file that was submitted.
-- Additive and idempotent.

CREATE TABLE IF NOT EXISTS resume_files (
  id             BIGSERIAL   PRIMARY KEY,
  user_id        UUID        NOT NULL,
  kind           TEXT        NOT NULL CHECK (kind IN ('master', 'tailored', 'uploaded', 'library')),
  bucket         TEXT        NOT NULL,
  object_path    TEXT        NOT NULL,
  filename       TEXT        NOT NULL,
  size_bytes     INT,
  sha256         TEXT,
  -- user_profile.job_market when the file was made (usa | india | other)
  market         TEXT,
  evaluation_id  BIGINT      REFERENCES evaluations(id) ON DELETE SET NULL,
  is_current     BOOLEAN     NOT NULL DEFAULT false,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (bucket, object_path)
);

CREATE INDEX IF NOT EXISTS resume_files_user_kind ON resume_files (user_id, kind, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS resume_files_one_current_master
  ON resume_files (user_id) WHERE kind = 'master' AND is_current;

ALTER TABLE evaluations ADD COLUMN IF NOT EXISTS resume_file_id         BIGINT REFERENCES resume_files(id) ON DELETE SET NULL;
ALTER TABLE evaluations ADD COLUMN IF NOT EXISTS applied_resume_file_id BIGINT REFERENCES resume_files(id) ON DELETE SET NULL;
