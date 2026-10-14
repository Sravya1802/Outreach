-- 019_ai_usage.sql
-- Every AI call's provider, model, tokens and cost (services/llm.js), so the
-- app can enforce a hard monthly budget and show spend in Settings.
-- Additive and idempotent.

CREATE TABLE IF NOT EXISTS ai_usage (
  id                  BIGSERIAL     PRIMARY KEY,
  user_id             UUID,                         -- null for background jobs
  task                TEXT          NOT NULL,       -- score | evaluate | email | categorize | resume | cover_letter
  provider            TEXT          NOT NULL,       -- groq | openai | anthropic
  model               TEXT          NOT NULL,
  input_tokens        INTEGER       NOT NULL DEFAULT 0,
  cached_input_tokens INTEGER       NOT NULL DEFAULT 0,
  output_tokens       INTEGER       NOT NULL DEFAULT 0,
  cost_usd            NUMERIC(12,6) NOT NULL DEFAULT 0,
  ok                  BOOLEAN       NOT NULL DEFAULT TRUE,
  error               TEXT,
  created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ai_usage_created ON ai_usage (created_at);
CREATE INDEX IF NOT EXISTS ai_usage_user_created ON ai_usage (user_id, created_at);

-- Server-only: deny PostgREST access.
ALTER TABLE ai_usage ENABLE ROW LEVEL SECURITY;
