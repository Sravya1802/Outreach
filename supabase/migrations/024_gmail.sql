-- 024_gmail.sql
-- Each user connects their own Gmail (app password, encrypted by the backend
-- with TOKEN_ENC_KEY). Outreach sends from it on a schedule, follow-ups go in
-- the same thread, and a watcher reads replies (plus LinkedIn's notification
-- emails and bounces) back into the contact's status.
-- Additive and idempotent.

CREATE TABLE IF NOT EXISTS gmail_connections (
  user_id          UUID        PRIMARY KEY,
  email            TEXT        NOT NULL,
  app_password     TEXT        NOT NULL,          -- encrypted
  display_name     TEXT,
  status           TEXT        NOT NULL DEFAULT 'ok' CHECK (status IN ('ok', 'error')),
  last_error       TEXT,
  connected_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_checked_at  TIMESTAMPTZ,                   -- reply watcher's last pass
  daily_cap        INT         NOT NULL DEFAULT 20
);

CREATE TABLE IF NOT EXISTS email_outbox (
  id             BIGSERIAL   PRIMARY KEY,
  user_id        UUID        NOT NULL,
  contact_id     BIGINT      REFERENCES job_contacts(id) ON DELETE CASCADE,
  -- 0 = first email, 1 = first follow-up, 2 = second follow-up
  step           INT         NOT NULL DEFAULT 0 CHECK (step BETWEEN 0 AND 2),
  thread_root_id BIGINT      REFERENCES email_outbox(id) ON DELETE CASCADE,
  to_email       TEXT        NOT NULL,
  to_name        TEXT,
  subject        TEXT        NOT NULL,
  body           TEXT        NOT NULL,
  recipient_tz   TEXT        NOT NULL,
  send_after     TIMESTAMPTZ NOT NULL,
  status         TEXT        NOT NULL DEFAULT 'scheduled'
                 CHECK (status IN ('scheduled', 'sending', 'sent', 'failed', 'cancelled')),
  cancel_reason  TEXT,
  message_id     TEXT,
  in_reply_to    TEXT,
  attempts       INT         NOT NULL DEFAULT 0,
  error          TEXT,
  sent_at        TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS email_outbox_due     ON email_outbox (status, send_after);
CREATE INDEX IF NOT EXISTS email_outbox_user    ON email_outbox (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS email_outbox_contact ON email_outbox (contact_id);
CREATE UNIQUE INDEX IF NOT EXISTS email_outbox_message_id ON email_outbox (message_id) WHERE message_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS email_replies (
  id           BIGSERIAL   PRIMARY KEY,
  user_id      UUID        NOT NULL,
  contact_id   BIGINT      REFERENCES job_contacts(id) ON DELETE SET NULL,
  outbox_id    BIGINT      REFERENCES email_outbox(id) ON DELETE SET NULL,
  channel      TEXT        NOT NULL CHECK (channel IN ('email', 'linkedin')),
  kind         TEXT        NOT NULL CHECK (kind IN ('reply', 'auto_reply', 'bounce', 'linkedin_message', 'linkedin_accept')),
  from_email   TEXT,
  from_name    TEXT,
  subject      TEXT,
  snippet      TEXT,
  message_id   TEXT        NOT NULL,
  received_at  TIMESTAMPTZ NOT NULL,
  seen         BOOLEAN     NOT NULL DEFAULT false,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, message_id)
);

CREATE INDEX IF NOT EXISTS email_replies_user ON email_replies (user_id, received_at DESC);

ALTER TABLE job_contacts ADD COLUMN IF NOT EXISTS last_emailed_at TIMESTAMPTZ;
ALTER TABLE job_contacts ADD COLUMN IF NOT EXISTS replied_at      TIMESTAMPTZ;
