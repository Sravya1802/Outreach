-- 055_outreach_text_sync.sql
-- Gmail always has the latest text of an email waiting for the user's OK.
--
-- 1. A role's email changes in outreach_drafts (the Claude run rewrites it,
--    or anyone edits it) after it was approved into email_outbox: the waiting
--    email (draft or scheduled) and its referral_asks row take the new text.
--    The LinkedIn note's ask (not sent yet) takes the new note.
-- 2. An email waiting in email_outbox with a Gmail copy changes text (from 1,
--    or any other update): gmail_sync_due is set, and the app's 2-minute pass
--    replaces the Gmail draft with the new text, then clears it.
-- Empty text never overwrites anything. Idempotent.

ALTER TABLE email_outbox ADD COLUMN IF NOT EXISTS gmail_sync_due BOOLEAN NOT NULL DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS email_outbox_gmail_sync_due ON email_outbox (id) WHERE gmail_sync_due;

CREATE OR REPLACE FUNCTION outreach_draft_text_to_outbox() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF (NEW.email_subject IS DISTINCT FROM OLD.email_subject OR NEW.email_body IS DISTINCT FROM OLD.email_body)
     AND COALESCE(btrim(NEW.email_subject), '') <> '' AND COALESCE(btrim(NEW.email_body), '') <> '' THEN
    UPDATE email_outbox o
       SET subject = left(NEW.email_subject, 300), body = left(NEW.email_body, 20000), body_html = NULL
      FROM referral_asks a
     WHERE a.outbox_id = o.id AND a.plan_item_id = NEW.plan_item_id AND a.contact_id = NEW.contact_id AND a.channel = 'email'
       AND o.status IN ('draft', 'scheduled')
       AND (o.subject IS DISTINCT FROM left(NEW.email_subject, 300) OR o.body IS DISTINCT FROM left(NEW.email_body, 20000));
    UPDATE referral_asks a
       SET subject = NEW.email_subject, message = NEW.email_body
      FROM email_outbox o
     WHERE a.outbox_id = o.id AND a.plan_item_id = NEW.plan_item_id AND a.contact_id = NEW.contact_id AND a.channel = 'email'
       AND o.status IN ('draft', 'scheduled');
  END IF;
  IF NEW.linkedin_note IS DISTINCT FROM OLD.linkedin_note AND COALESCE(btrim(NEW.linkedin_note), '') <> '' THEN
    UPDATE referral_asks
       SET message = NEW.linkedin_note
     WHERE plan_item_id = NEW.plan_item_id AND contact_id = NEW.contact_id AND channel = 'linkedin' AND status = 'to_send';
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS outreach_draft_text_to_outbox ON outreach_drafts;
CREATE TRIGGER outreach_draft_text_to_outbox
  AFTER UPDATE OF email_subject, email_body, linkedin_note ON outreach_drafts
  FOR EACH ROW EXECUTE FUNCTION outreach_draft_text_to_outbox();

CREATE OR REPLACE FUNCTION outbox_text_changed() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'draft' AND NEW.gmail_draft_hash IS NOT NULL
     AND (NEW.subject IS DISTINCT FROM OLD.subject OR NEW.body IS DISTINCT FROM OLD.body) THEN
    NEW.gmail_sync_due := TRUE;
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS outbox_text_changed ON email_outbox;
CREATE TRIGGER outbox_text_changed
  BEFORE UPDATE OF subject, body ON email_outbox
  FOR EACH ROW EXECUTE FUNCTION outbox_text_changed();

-- Trigger functions only: nobody calls them directly.
REVOKE ALL ON FUNCTION outreach_draft_text_to_outbox() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION outbox_text_changed() FROM PUBLIC, anon, authenticated;
