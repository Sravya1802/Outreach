-- 058_outreach_writer.sql
-- Who wrote each outreach email, so nothing goes out that your Claude run
-- didn't write (or you didn't edit), and a 40-a-day Gmail limit.
--
-- outreach_drafts.written_by / email_outbox.written_by:
--   'claude'  your hourly Claude run wrote it (the app writes no email text)
--   'you'     you edited it (Save on the role page, Edit in Outbox, or in Gmail)
--   'app'     the app's old template writer (removed 2026-11-17); never sent
-- A draft's text changing sets it: status 'edited' (the app's Save) means you,
-- anything else means the run. Text copied into a waiting email (migration 055)
-- carries its writer. Existing rows: the old template's wording marks 'app'.
-- Idempotent.

ALTER TABLE outreach_drafts ADD COLUMN IF NOT EXISTS written_by TEXT;
ALTER TABLE email_outbox ADD COLUMN IF NOT EXISTS written_by TEXT;
DO $$ BEGIN
  ALTER TABLE outreach_drafts ADD CONSTRAINT outreach_drafts_written_by CHECK (written_by IN ('claude', 'you', 'app'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE email_outbox ADD CONSTRAINT email_outbox_written_by CHECK (written_by IN ('claude', 'you', 'app'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE OR REPLACE FUNCTION outreach_draft_writer() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF COALESCE(btrim(NEW.email_body), '') = '' THEN
    NEW.written_by := NULL;
  ELSIF TG_OP = 'INSERT' OR NEW.email_body IS DISTINCT FROM OLD.email_body OR NEW.email_subject IS DISTINCT FROM OLD.email_subject THEN
    NEW.written_by := CASE WHEN NEW.status = 'edited' THEN 'you' ELSE 'claude' END;
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS outreach_draft_writer ON outreach_drafts;
CREATE TRIGGER outreach_draft_writer
  BEFORE INSERT OR UPDATE OF email_subject, email_body ON outreach_drafts
  FOR EACH ROW EXECUTE FUNCTION outreach_draft_writer();

-- 055's copy into the waiting email now carries the writer too.
CREATE OR REPLACE FUNCTION outreach_draft_text_to_outbox() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF (NEW.email_subject IS DISTINCT FROM OLD.email_subject OR NEW.email_body IS DISTINCT FROM OLD.email_body)
     AND COALESCE(btrim(NEW.email_subject), '') <> '' AND COALESCE(btrim(NEW.email_body), '') <> '' THEN
    UPDATE email_outbox o
       SET subject = left(NEW.email_subject, 300), body = left(NEW.email_body, 20000), body_html = NULL, written_by = NEW.written_by
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

-- Existing text: the old template's wording is the app's; the rest came from runs or your edits.
UPDATE outreach_drafts SET written_by = CASE
    WHEN email_body ILIKE '%I am completing a Master of Science in Computer Science at the University of Illinois at Chicago (May 2027), after two years%'
      OR email_body ILIKE '%is how the posting describes it%' OR email_body ILIKE '%My resume shows hands-on work with%' THEN 'app'
    WHEN status = 'edited' THEN 'you' ELSE 'claude' END
 WHERE written_by IS NULL AND COALESCE(btrim(email_body), '') <> '';

UPDATE email_outbox o SET written_by = CASE
    WHEN o.body ILIKE '%I am completing a Master of Science in Computer Science at the University of Illinois at Chicago (May 2027), after two years%'
      OR o.body ILIKE '%is how the posting describes it%' OR o.body ILIKE '%My resume shows hands-on work with%' THEN 'app'
    WHEN o.purpose <> 'referral' THEN 'you'
    ELSE COALESCE((SELECT CASE WHEN d.email_body = o.body THEN d.written_by ELSE 'you' END
                     FROM referral_asks a JOIN outreach_drafts d ON d.plan_item_id = a.plan_item_id AND d.contact_id = a.contact_id
                    WHERE a.outbox_id = o.id LIMIT 1), 'claude') END
 WHERE o.written_by IS NULL AND COALESCE(btrim(o.body), '') <> '';

-- 40 emails a day from your Gmail (the old default was 20).
ALTER TABLE gmail_connections ALTER COLUMN daily_cap SET DEFAULT 40;
UPDATE gmail_connections SET daily_cap = 40 WHERE daily_cap = 20;

REVOKE ALL ON FUNCTION outreach_draft_writer() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION outreach_draft_text_to_outbox() FROM PUBLIC, anon, authenticated;
