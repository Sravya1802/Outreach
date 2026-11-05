-- 038_tailor_pipeline.sql
-- Resume tailoring, referral emails and LinkedIn notes move to scheduled Claude
-- chat runs. The app keeps the queue, the review screens, Gmail drafts and applying.
-- A role is a plan_items row and its posting a scraped_roles row; each run starts
-- with no memory, so everything it needs is in tailoring_config.
-- Row security is on with no policies and the public roles have no grants: only
-- the backend and the runs (both connect as the database owner) can reach these.
-- Additive and idempotent.

CREATE TABLE IF NOT EXISTS pipeline_runs (
  id            BIGSERIAL   PRIMARY KEY,
  user_id       UUID        NOT NULL,
  started_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at   TIMESTAMPTZ,
  roles_done    INT         NOT NULL DEFAULT 0,
  roles_failed  INT         NOT NULL DEFAULT 0,
  notes         TEXT
);
CREATE INDEX IF NOT EXISTS pipeline_runs_user ON pipeline_runs (user_id, started_at DESC);

CREATE TABLE IF NOT EXISTS tailor_jobs (
  id               BIGSERIAL   PRIMARY KEY,
  user_id          UUID        NOT NULL,
  plan_item_id     BIGINT      NOT NULL UNIQUE REFERENCES plan_items(id) ON DELETE CASCADE,
  scraped_role_id  BIGINT      REFERENCES scraped_roles(id) ON DELETE SET NULL,
  status           TEXT        NOT NULL DEFAULT 'queued'
                   CHECK (status IN ('queued', 'in_progress', 'ready', 'revision_requested', 'approved', 'applied', 'closed')),
  priority         INT         NOT NULL DEFAULT 0,
  attempts         INT         NOT NULL DEFAULT 0,
  locked_at        TIMESTAMPTZ,
  locked_by_run    BIGINT      REFERENCES pipeline_runs(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS tailor_jobs_user ON tailor_jobs (user_id, status, priority DESC);

CREATE TABLE IF NOT EXISTS resume_versions (
  id               BIGSERIAL   PRIMARY KEY,
  user_id          UUID        NOT NULL,
  plan_item_id     BIGINT      NOT NULL REFERENCES plan_items(id) ON DELETE CASCADE,
  version          INT         NOT NULL CHECK (version > 0),
  latex            TEXT        NOT NULL,
  pdf_path         TEXT,                                 -- resumes/{plan_item_id}/v{n}.pdf; NULL until the VM compiles it
  ats_before       INT,
  ats_after        INT,
  callback_before  INT,
  callback_after   INT,
  report           JSONB       NOT NULL DEFAULT '{}',    -- top 5 hiring needs, keyword table, gaps, changes made, verdict
  change_log       TEXT,                                 -- what changed from the last version and which comment it answers
  is_final         BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (plan_item_id, version)
);
CREATE UNIQUE INDEX IF NOT EXISTS resume_versions_one_final ON resume_versions (plan_item_id) WHERE is_final;
CREATE INDEX IF NOT EXISTS resume_versions_to_compile ON resume_versions (created_at) WHERE pdf_path IS NULL;

CREATE TABLE IF NOT EXISTS resume_comments (
  id                    BIGSERIAL   PRIMARY KEY,
  user_id               UUID        NOT NULL,
  plan_item_id          BIGINT      NOT NULL REFERENCES plan_items(id) ON DELETE CASCADE,
  version_id            BIGINT      NOT NULL REFERENCES resume_versions(id) ON DELETE CASCADE,
  body                  TEXT        NOT NULL,
  status                TEXT        NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'addressed')),
  addressed_in_version  INT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS resume_comments_item ON resume_comments (plan_item_id, status);

CREATE TABLE IF NOT EXISTS outreach_drafts (
  id              BIGSERIAL   PRIMARY KEY,
  user_id         UUID        NOT NULL,
  plan_item_id    BIGINT      NOT NULL REFERENCES plan_items(id) ON DELETE CASCADE,
  contact_id      BIGINT      REFERENCES job_contacts(id) ON DELETE SET NULL,
  email_subject   TEXT,
  email_body      TEXT,
  linkedin_note   TEXT        CHECK (char_length(linkedin_note) <= 300),   -- LinkedIn's limit
  gmail_draft_id  TEXT,
  status          TEXT        NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'edited', 'approved', 'sent')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (plan_item_id, contact_id)
);

-- A new version is a new row; a run reads the highest version.
CREATE TABLE IF NOT EXISTS tailoring_config (
  id              BIGSERIAL   PRIMARY KEY,
  user_id         UUID        NOT NULL,
  version         INT         NOT NULL DEFAULT 1,
  system_prompt   TEXT,
  master_latex    TEXT,
  standing_rules  TEXT,
  email_template  TEXT,
  linkedin_rules  TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, version)
);

-- A run calls this first. Rows a stopped run left in_progress for over 2 hours go
-- back in line, then the next rows are taken: revisions first, then priority, then
-- newest posting. Not by score: fit scores don't rank anything yet.
CREATE OR REPLACE FUNCTION claim_tailor_jobs(p_user UUID, p_run BIGINT, p_limit INT DEFAULT 20)
RETURNS SETOF tailor_jobs
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  UPDATE tailor_jobs j
     SET status = CASE WHEN EXISTS (SELECT 1 FROM resume_comments c WHERE c.plan_item_id = j.plan_item_id AND c.status = 'open')
                       THEN 'revision_requested' ELSE 'queued' END,
         locked_at = NULL, locked_by_run = NULL, updated_at = NOW()
   WHERE j.user_id = p_user AND j.status = 'in_progress' AND j.locked_at < NOW() - INTERVAL '2 hours';

  RETURN QUERY
  WITH picked AS (
    SELECT j.id
      FROM tailor_jobs j
      JOIN plan_items pi ON pi.id = j.plan_item_id
      LEFT JOIN scraped_roles sr ON sr.id = j.scraped_role_id
     WHERE j.user_id = p_user AND j.status IN ('revision_requested', 'queued')
     ORDER BY (j.status = 'revision_requested') DESC, j.priority DESC, COALESCE(sr.posted_at, pi.created_at) DESC
     LIMIT p_limit
       FOR UPDATE OF j SKIP LOCKED
  )
  UPDATE tailor_jobs j
     SET status = 'in_progress', attempts = j.attempts + 1, locked_at = NOW(), locked_by_run = p_run, updated_at = NOW()
    FROM picked
   WHERE j.id = picked.id
  RETURNING j.*;
END;
$$;

ALTER TABLE pipeline_runs    ENABLE ROW LEVEL SECURITY;
ALTER TABLE tailor_jobs      ENABLE ROW LEVEL SECURITY;
ALTER TABLE resume_versions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE resume_comments  ENABLE ROW LEVEL SECURITY;
ALTER TABLE outreach_drafts  ENABLE ROW LEVEL SECURITY;
ALTER TABLE tailoring_config ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON pipeline_runs, tailor_jobs, resume_versions, resume_comments, outreach_drafts, tailoring_config FROM anon, authenticated;
REVOKE ALL ON SEQUENCE pipeline_runs_id_seq, tailor_jobs_id_seq, resume_versions_id_seq, resume_comments_id_seq, outreach_drafts_id_seq, tailoring_config_id_seq FROM anon, authenticated;
REVOKE ALL ON FUNCTION claim_tailor_jobs(UUID, BIGINT, INT) FROM PUBLIC, anon, authenticated;
