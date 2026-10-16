-- 029_email_drafts.sql
-- Emails the app writes on its own (referral asks) wait for the user's OK:
--   • email_outbox.status 'draft' — written, not sent; a copy sits in the
--     user's Gmail Drafts so they can read (and edit) it there too
--   • attachment_file_id — the role's tailored resume, attached when sent
--   • body_html — set when the user edited the draft in Gmail (keeps their formatting)
--   • gmail_draft_hash — what we last put in Gmail Drafts, to tell their edits apart
--   • approved_at — when the user said yes
-- referral_asks.status gains 'draft' to match.
-- Additive and idempotent.

ALTER TABLE email_outbox DROP CONSTRAINT IF EXISTS email_outbox_status_check;
ALTER TABLE email_outbox ADD CONSTRAINT email_outbox_status_check
  CHECK (status IN ('draft', 'scheduled', 'sending', 'sent', 'failed', 'cancelled'));

ALTER TABLE email_outbox ADD COLUMN IF NOT EXISTS attachment_file_id BIGINT REFERENCES resume_files(id) ON DELETE SET NULL;
ALTER TABLE email_outbox ADD COLUMN IF NOT EXISTS body_html          TEXT;
ALTER TABLE email_outbox ADD COLUMN IF NOT EXISTS gmail_draft_hash   TEXT;
ALTER TABLE email_outbox ADD COLUMN IF NOT EXISTS approved_at        TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS email_outbox_drafts ON email_outbox (user_id) WHERE status = 'draft';

ALTER TABLE referral_asks DROP CONSTRAINT IF EXISTS referral_asks_status_check;
ALTER TABLE referral_asks ADD CONSTRAINT referral_asks_status_check
  CHECK (status IN ('draft', 'scheduled', 'sent', 'to_send', 'marked_sent', 'replied'));
