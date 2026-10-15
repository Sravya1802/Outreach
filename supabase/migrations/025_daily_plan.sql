-- 025_daily_plan.sql
-- The daily flow (backend/services/dailyPlan.js). Each evening the day's new
-- roles are scored against the user; the best go on a list emailed at
-- 10 PM their time; only the roles they approve move on (tailored resume →
-- referral ask → apply in the company's morning).
-- Additive and idempotent.

CREATE TABLE IF NOT EXISTS daily_plans (
  id          BIGSERIAL   PRIMARY KEY,
  user_id     UUID        NOT NULL,
  plan_date   DATE        NOT NULL,          -- the user's local date
  status      TEXT        NOT NULL DEFAULT 'building' CHECK (status IN ('building', 'ready', 'failed')),
  stats       JSONB       NOT NULL DEFAULT '{}',
  error       TEXT,
  built_at    TIMESTAMPTZ,
  emailed_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, plan_date)
);

CREATE TABLE IF NOT EXISTS plan_items (
  id              BIGSERIAL   PRIMARY KEY,
  plan_id         BIGINT      NOT NULL REFERENCES daily_plans(id) ON DELETE CASCADE,
  user_id         UUID        NOT NULL,
  scraped_role_id BIGINT      REFERENCES scraped_roles(id) ON DELETE SET NULL,
  evaluation_id   BIGINT      REFERENCES evaluations(id) ON DELETE SET NULL,
  company_name    TEXT        NOT NULL,
  title           TEXT        NOT NULL,
  apply_url       TEXT        NOT NULL,
  location        TEXT,
  pay             TEXT,
  sponsorship     TEXT,
  -- top = on the list; worth = a look (7 to the bar); low = below 7; excluded = filtered out (why in reason)
  tier            TEXT        NOT NULL CHECK (tier IN ('top', 'worth', 'low', 'excluded')),
  score           NUMERIC(3, 1),
  reason          TEXT,
  decision        TEXT        NOT NULL DEFAULT 'pending' CHECK (decision IN ('pending', 'approved', 'skipped', 'expired')),
  decided_at      TIMESTAMPTZ,
  -- what's happening to an approved role
  stage           TEXT        NOT NULL DEFAULT 'proposed' CHECK (stage IN (
                    'proposed', 'tailoring', 'asking_referral', 'waiting_referral', 'ready_to_apply',
                    'applying', 'applied', 'referred', 'needs_you', 'done')),
  stage_note      TEXT,
  tailoring_id    BIGINT      REFERENCES resume_tailorings(id) ON DELETE SET NULL,
  referral_status TEXT        NOT NULL DEFAULT 'none' CHECK (referral_status IN ('none', 'asked', 'link', 'submitted', 'declined')),
  referral_link   TEXT,
  wait_until      TIMESTAMPTZ,
  apply_after     TIMESTAMPTZ,
  applied_at      TIMESTAMPTZ,
  company_tz      TEXT,
  job_description TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, scraped_role_id)
);

CREATE INDEX IF NOT EXISTS plan_items_plan  ON plan_items (plan_id, tier, score DESC);
CREATE INDEX IF NOT EXISTS plan_items_stage ON plan_items (user_id, decision, stage);
