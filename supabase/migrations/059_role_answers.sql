-- 059_role_answers.sql
-- Prepared answers for each ready role's application form, read every night
-- from the job board (Greenhouse, Ashby, Lever) so the filler extension has
-- them before it opens the form.
--
-- status:
--   'profile'   the filler answers it from the profile (name, email, school…)
--   'ready'     answered: source 'saved' (your Application answers), 'claude'
--               (your hourly Claude run, from master_latex) or 'you'
--   'writing'   an open question waiting for your Claude run to answer
--   'needs_you' your Claude run couldn't answer it from master_latex (note says why)
-- Idempotent.

CREATE TABLE IF NOT EXISTS role_answers (
  id           BIGSERIAL PRIMARY KEY,
  user_id      UUID NOT NULL,
  plan_item_id BIGINT NOT NULL REFERENCES plan_items(id) ON DELETE CASCADE,
  question     TEXT NOT NULL,
  question_key TEXT NOT NULL,
  field_type   TEXT,
  options      JSONB,
  required     BOOLEAN NOT NULL DEFAULT FALSE,
  answer       TEXT,
  source       TEXT CHECK (source IN ('profile', 'saved', 'claude', 'you')),
  status       TEXT NOT NULL DEFAULT 'writing' CHECK (status IN ('profile', 'ready', 'writing', 'needs_you')),
  note         TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (plan_item_id, question_key)
);
CREATE INDEX IF NOT EXISTS role_answers_user_status ON role_answers (user_id, status);

-- Server-only, like the rest: the app's API and the run's SQL use the service role.
ALTER TABLE role_answers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON role_answers FROM anon, authenticated;
REVOKE ALL ON SEQUENCE role_answers_id_seq FROM anon, authenticated;
