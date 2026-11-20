-- 060_tailor_jobs_changed_at.sql
-- The Review queue is cached on the server: the database is a 220 ms round
-- trip away and the full list (2,700+ roles) took 4–8 s, after every button.
-- tailor_jobs.changed_at moves whenever anything the list shows changes for a
-- role: the job itself, its plan item, a resume version, its outreach or a
-- comment. The server then re-reads only the roles changed since its last read.
-- Idempotent.

ALTER TABLE tailor_jobs ADD COLUMN IF NOT EXISTS changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
CREATE INDEX IF NOT EXISTS tailor_jobs_user_changed ON tailor_jobs (user_id, changed_at);

CREATE OR REPLACE FUNCTION tailor_jobs_touch_self() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.changed_at := clock_timestamp();
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS tailor_jobs_touch_self ON tailor_jobs;
CREATE TRIGGER tailor_jobs_touch_self BEFORE UPDATE ON tailor_jobs
  FOR EACH ROW EXECUTE FUNCTION tailor_jobs_touch_self();

-- A change to a related row moves its role's changed_at (plan_items by id, the rest by plan_item_id).
CREATE OR REPLACE FUNCTION tailor_jobs_touch_related() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  item BIGINT;
BEGIN
  IF TG_TABLE_NAME = 'plan_items' THEN
    item := COALESCE(NEW.id, OLD.id);
  ELSIF TG_OP = 'DELETE' THEN
    item := OLD.plan_item_id;
  ELSE
    item := NEW.plan_item_id;
  END IF;
  IF item IS NOT NULL THEN
    UPDATE tailor_jobs SET changed_at = clock_timestamp() WHERE plan_item_id = item;
  END IF;
  RETURN NULL;
END
$$;

DROP TRIGGER IF EXISTS tailor_jobs_touch_plan_items ON plan_items;
CREATE TRIGGER tailor_jobs_touch_plan_items AFTER UPDATE ON plan_items
  FOR EACH ROW EXECUTE FUNCTION tailor_jobs_touch_related();
DROP TRIGGER IF EXISTS tailor_jobs_touch_versions ON resume_versions;
CREATE TRIGGER tailor_jobs_touch_versions AFTER INSERT OR UPDATE OR DELETE ON resume_versions
  FOR EACH ROW EXECUTE FUNCTION tailor_jobs_touch_related();
DROP TRIGGER IF EXISTS tailor_jobs_touch_drafts ON outreach_drafts;
CREATE TRIGGER tailor_jobs_touch_drafts AFTER INSERT OR UPDATE OR DELETE ON outreach_drafts
  FOR EACH ROW EXECUTE FUNCTION tailor_jobs_touch_related();
DROP TRIGGER IF EXISTS tailor_jobs_touch_comments ON resume_comments;
CREATE TRIGGER tailor_jobs_touch_comments AFTER INSERT OR UPDATE OR DELETE ON resume_comments
  FOR EACH ROW EXECUTE FUNCTION tailor_jobs_touch_related();

REVOKE ALL ON FUNCTION tailor_jobs_touch_self() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION tailor_jobs_touch_related() FROM PUBLIC, anon, authenticated;
