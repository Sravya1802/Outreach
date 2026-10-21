-- 035_whatsapp_waiting.sql
-- A message that couldn't go out because its template isn't approved by Meta
-- yet (error 132001, outside the 24-hour window) waits here with what it
-- needs to be sent, and is retried every 30 minutes for up to 3 days.
-- status 'waiting_template' → 'sent_late' | 'expired'.
-- Additive and idempotent.

ALTER TABLE whatsapp_messages ADD COLUMN IF NOT EXISTS payload JSONB;
CREATE INDEX IF NOT EXISTS whatsapp_messages_waiting ON whatsapp_messages (created_at) WHERE status = 'waiting_template';
