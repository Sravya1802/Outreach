-- 013_provider_cache_and_budgets.sql
-- 1. Shared cache of company-domain email searches. A domain's published
--    staff emails are the same for every user, so one paid lookup serves all
--    accounts until it expires (TTL enforced in code).
-- 2. Per-user monthly usage of the shared provider API keys, so one account
--    can't spend everyone's Hunter / Prospeo / Apollo / Serper quota.
-- Additive and idempotent.

CREATE TABLE IF NOT EXISTS provider_domain_cache (
  provider    TEXT        NOT NULL,
  domain      TEXT        NOT NULL,
  result      JSONB       NOT NULL,
  searched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (provider, domain)
);

CREATE TABLE IF NOT EXISTS provider_usage (
  user_id  UUID    NOT NULL,
  provider TEXT    NOT NULL,
  month    TEXT    NOT NULL,          -- 'YYYY-MM' (UTC)
  calls    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, provider, month)
);

-- Server-only tables: the backend uses the service connection; deny
-- PostgREST access entirely.
ALTER TABLE provider_domain_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE provider_usage        ENABLE ROW LEVEL SECURITY;
