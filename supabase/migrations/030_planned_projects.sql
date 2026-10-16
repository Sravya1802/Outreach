-- 030_planned_projects.sql
-- Projects the resume engine suggests when a job's fit is weak: the user
-- builds it, pushes it to GitHub and marks it built (repo + dates). Only a
-- built project ever goes on a resume; until then it's a suggestion with a
-- build plan. Built projects become part of the candidate's material for
-- every later tailoring.
-- Additive and idempotent.

CREATE TABLE IF NOT EXISTS planned_projects (
  id             BIGSERIAL   PRIMARY KEY,
  user_id        UUID        NOT NULL,
  evaluation_id  BIGINT      REFERENCES evaluations(id) ON DELETE SET NULL,   -- the role it was suggested for
  tailoring_id   BIGINT      REFERENCES resume_tailorings(id) ON DELETE SET NULL,
  name           TEXT        NOT NULL,
  tech           JSONB       NOT NULL DEFAULT '[]',
  bullets        JSONB       NOT NULL DEFAULT '[]',
  covers         JSONB       NOT NULL DEFAULT '[]',    -- job keywords it adds
  why            TEXT,
  plan           JSONB       NOT NULL DEFAULT '[]',    -- build steps
  status         TEXT        NOT NULL DEFAULT 'suggested' CHECK (status IN ('suggested', 'built', 'dismissed')),
  repo_url       TEXT,
  start_date     TEXT,                                 -- as shown on the resume ("Jun 2026")
  end_date       TEXT,
  built_at       TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS planned_projects_user ON planned_projects (user_id, status, created_at DESC);
