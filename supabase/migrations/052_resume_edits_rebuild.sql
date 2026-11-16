-- 052_resume_edits_rebuild.sql
-- A resume version edited in place (its latex or change_log changed, e.g. a
-- Claude chat fix across many resumes) gets a new PDF: the trigger clears
-- pdf_path and checked_at, so the app's check pass compiles it again, and
-- stamps edited_at. The review list shows "Updated" until the user opens the
-- role (update_seen_at). Idempotent.

ALTER TABLE resume_versions ADD COLUMN IF NOT EXISTS edited_at      TIMESTAMPTZ;
ALTER TABLE resume_versions ADD COLUMN IF NOT EXISTS update_seen_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION resume_versions_edited() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.latex IS DISTINCT FROM OLD.latex OR NEW.change_log IS DISTINCT FROM OLD.change_log THEN
    NEW.edited_at := NOW();
    IF NEW.latex IS DISTINCT FROM OLD.latex THEN
      NEW.pdf_path := NULL;
      NEW.checked_at := NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS resume_versions_edited ON resume_versions;
CREATE TRIGGER resume_versions_edited BEFORE UPDATE ON resume_versions
  FOR EACH ROW EXECUTE FUNCTION resume_versions_edited();
REVOKE ALL ON FUNCTION resume_versions_edited() FROM PUBLIC, anon, authenticated;

-- The Nov 16 chatbot edit (AWS to Azure) on 885 versions.
UPDATE resume_versions SET edited_at = COALESCE(edited_at, NOW())
 WHERE change_log ~ 'Nov 16: Cancer Center chatbot deployment changed from AWS to Azure';
