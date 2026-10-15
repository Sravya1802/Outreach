-- 028_whatsapp.sql
-- WhatsApp through Meta's Cloud API (backend/services/whatsapp.js). One
-- OutreachOS business number; each user links their own phone by sending
-- "JOIN <code>" to it from WhatsApp (proves the number and opts them in).
-- Outbound: the 10 PM list, reply alerts, "needs you", the morning summary.
-- Inbound: YES / YES 1 3 / SKIP 2 / LIST / STOP / START / HELP.
-- Additive and idempotent.

CREATE TABLE IF NOT EXISTS whatsapp_links (
  user_id           UUID        PRIMARY KEY,
  phone             TEXT,                      -- digits only, country code first (E.164 without +)
  verified_at       TIMESTAMPTZ,
  enabled           BOOLEAN     NOT NULL DEFAULT true,
  prefs             JSONB       NOT NULL DEFAULT '{"list": true, "replies": true, "needs": true, "summary": true}',
  join_code         TEXT,
  join_code_expires TIMESTAMPTZ,
  last_inbound_at   TIMESTAMPTZ,                -- opens Meta's 24-hour window for free-form replies
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_links_phone ON whatsapp_links (phone) WHERE phone IS NOT NULL AND verified_at IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_links_code ON whatsapp_links (join_code) WHERE join_code IS NOT NULL;

CREATE TABLE IF NOT EXISTS whatsapp_messages (
  id            BIGSERIAL   PRIMARY KEY,
  user_id       UUID,
  direction     TEXT        NOT NULL CHECK (direction IN ('in', 'out')),
  wa_message_id TEXT,
  kind          TEXT,                           -- list | reply | needs | summary | test | command | text
  body          TEXT,
  status        TEXT,                           -- sent | delivered | read | failed | received
  error         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_messages_wa_id ON whatsapp_messages (wa_message_id, direction) WHERE wa_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS whatsapp_messages_user ON whatsapp_messages (user_id, created_at DESC);

ALTER TABLE daily_plans ADD COLUMN IF NOT EXISTS whatsapp_at TIMESTAMPTZ;
ALTER TABLE plan_items  ADD COLUMN IF NOT EXISTS whatsapp_needs_at TIMESTAMPTZ;
