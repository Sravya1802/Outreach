-- 016_github_projects.sql
-- "Sign in with GitHub": one connection per user (tokens encrypted by the
-- backend with TOKEN_ENC_KEY) and that user's public repos, the pool of
-- projects resume tailoring picks from. Additive and idempotent.

CREATE TABLE IF NOT EXISTS github_connections (
  user_id            UUID        PRIMARY KEY,
  github_id          BIGINT      NOT NULL,
  login              TEXT        NOT NULL,
  avatar_url         TEXT,
  access_token       TEXT        NOT NULL,   -- encrypted
  access_expires_at  TIMESTAMPTZ,            -- null = token doesn't expire
  refresh_token      TEXT,                   -- encrypted
  refresh_expires_at TIMESTAMPTZ,
  scope              TEXT,
  connected_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_synced_at     TIMESTAMPTZ,
  sync_status        TEXT        NOT NULL DEFAULT 'idle' CHECK (sync_status IN ('idle', 'syncing', 'error')),
  sync_error         TEXT
);

CREATE TABLE IF NOT EXISTS github_repos (
  user_id     UUID        NOT NULL,
  repo_id     BIGINT      NOT NULL,
  full_name   TEXT        NOT NULL,
  name        TEXT        NOT NULL,
  description TEXT,
  html_url    TEXT        NOT NULL,
  homepage    TEXT,
  language    TEXT,
  languages   JSONB       NOT NULL DEFAULT '{}',   -- {"TypeScript": 51234, ...} bytes
  topics      TEXT[]      NOT NULL DEFAULT '{}',
  stars       INTEGER     NOT NULL DEFAULT 0,
  fork        BOOLEAN     NOT NULL DEFAULT FALSE,
  archived    BOOLEAN     NOT NULL DEFAULT FALSE,
  pushed_at   TIMESTAMPTZ,
  readme      TEXT,                                -- trimmed plain text
  include     BOOLEAN     NOT NULL DEFAULT TRUE,   -- user can exclude a repo from tailoring
  synced_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, repo_id)
);

-- Server-only tables: deny PostgREST access.
ALTER TABLE github_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE github_repos       ENABLE ROW LEVEL SECURITY;
