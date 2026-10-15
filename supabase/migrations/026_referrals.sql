-- 026_referrals.sql
-- Referral first, then apply (backend/services/referralFlow.js):
--   • linkedin_connections — the user's own LinkedIn export (Connections.csv),
--     so roles at companies where they know someone are flagged and those
--     people are asked first
--   • referral_asks — who was asked for which approved role, and how
--     (email through the outbox, a LinkedIn note the user sends, or a search
--     link when nobody is known yet)
--   • email_outbox.purpose — referral asks get no generic follow-ups; an
--     "I've applied" note goes in the same thread instead
-- Additive and idempotent.

CREATE TABLE IF NOT EXISTS linkedin_connections (
  id           BIGSERIAL   PRIMARY KEY,
  user_id      UUID        NOT NULL,
  full_name    TEXT        NOT NULL,
  first_name   TEXT,
  last_name    TEXT,
  profile_url  TEXT,
  email        TEXT,
  company      TEXT,
  company_key  TEXT,                 -- normalized company name for matching
  position     TEXT,
  connected_on DATE,
  imported_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, full_name, company)
);
CREATE INDEX IF NOT EXISTS linkedin_connections_company ON linkedin_connections (user_id, company_key);

CREATE TABLE IF NOT EXISTS referral_asks (
  id            BIGSERIAL   PRIMARY KEY,
  user_id       UUID        NOT NULL,
  plan_item_id  BIGINT      NOT NULL REFERENCES plan_items(id) ON DELETE CASCADE,
  channel       TEXT        NOT NULL CHECK (channel IN ('email', 'linkedin', 'search')),
  person_name   TEXT,
  person_title  TEXT,
  linkedin_url  TEXT,
  email         TEXT,
  contact_id    BIGINT      REFERENCES job_contacts(id) ON DELETE SET NULL,
  connection_id BIGINT      REFERENCES linkedin_connections(id) ON DELETE SET NULL,
  outbox_id     BIGINT      REFERENCES email_outbox(id) ON DELETE SET NULL,
  subject       TEXT,
  message       TEXT        NOT NULL,
  -- scheduled/sent = email; to_send/marked_sent = LinkedIn note or search; replied = they answered
  status        TEXT        NOT NULL DEFAULT 'to_send' CHECK (status IN ('scheduled', 'sent', 'to_send', 'marked_sent', 'replied')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS referral_asks_item ON referral_asks (plan_item_id);

ALTER TABLE email_outbox ADD COLUMN IF NOT EXISTS purpose TEXT NOT NULL DEFAULT 'outreach';
ALTER TABLE email_outbox DROP CONSTRAINT IF EXISTS email_outbox_purpose_check;
ALTER TABLE email_outbox ADD CONSTRAINT email_outbox_purpose_check CHECK (purpose IN ('outreach', 'referral'));

