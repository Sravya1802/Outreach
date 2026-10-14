-- 015_application_answers.sql
-- The answer bank auto-apply fills forms from. One row per distinct question
-- per user. Questions a form asked that have no answer yet are stored as
-- 'pending' so the user can answer once and every later form reuses it.
-- Additive and idempotent.

CREATE TABLE IF NOT EXISTS application_answers (
  id            BIGSERIAL   PRIMARY KEY,
  user_id       UUID        NOT NULL,
  question      TEXT        NOT NULL,          -- as first seen / typed
  question_key  TEXT        NOT NULL,          -- normalized, see answerBank.js
  answer        TEXT,
  status        TEXT        NOT NULL DEFAULT 'answered' CHECK (status IN ('answered', 'pending')),
  asked_by      TEXT,                          -- "Figma · Software Engineer Intern"
  evaluation_id BIGINT,                        -- the application that asked it
  use_count     INTEGER     NOT NULL DEFAULT 0,
  last_used_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, question_key)
);

CREATE INDEX IF NOT EXISTS application_answers_user_status ON application_answers (user_id, status);

-- Server-only: the backend uses the service connection; deny PostgREST access.
ALTER TABLE application_answers ENABLE ROW LEVEL SECURITY;
