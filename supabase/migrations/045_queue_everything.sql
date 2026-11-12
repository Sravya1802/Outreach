-- 045_queue_everything.sql
-- Every Roles-tab role goes to the Claude chat runs on its own, a daily cap of
-- new roles at a time, in an order the app sets (tailor_jobs.priority).
--   * scraped_roles: what the posting says (deadline, returning students only)
--     and when it was read.
--   * plan_items: tier 'queue' for roles queued straight from the Roles tab
--     (kept off the evening list's pages), and the posting's deadline.
--   * tailor_jobs: when a role was first claimed (counts toward the day's cap)
--     and when its posting was last confirmed open.
--   * claim_tailor_jobs: revisions (and roles a stopped run left behind) first,
--     then new roles by priority, at most the day's cap of new ones. The cap is
--     queueCap in the user's daily_plan_settings (default 60), the day in their
--     timezone.
-- Idempotent.

ALTER TABLE scraped_roles ADD COLUMN IF NOT EXISTS apply_deadline   DATE;
ALTER TABLE scraped_roles ADD COLUMN IF NOT EXISTS return_to_school BOOLEAN;
ALTER TABLE scraped_roles ADD COLUMN IF NOT EXISTS facts_read_at    TIMESTAMPTZ;

ALTER TABLE plan_items ADD COLUMN IF NOT EXISTS apply_deadline DATE;
ALTER TABLE plan_items DROP CONSTRAINT IF EXISTS plan_items_tier_check;
ALTER TABLE plan_items ADD CONSTRAINT plan_items_tier_check CHECK (tier IN ('top', 'worth', 'low', 'excluded', 'queue'));

ALTER TABLE tailor_jobs ADD COLUMN IF NOT EXISTS claimed_at      TIMESTAMPTZ;
ALTER TABLE tailor_jobs ADD COLUMN IF NOT EXISTS live_checked_at TIMESTAMPTZ;
-- Roles a run has already had: claimed on the day they were made, so none counts toward today's cap.
UPDATE tailor_jobs SET claimed_at = created_at WHERE claimed_at IS NULL AND (attempts > 0 OR status <> 'queued');

CREATE OR REPLACE FUNCTION claim_tailor_jobs(p_user UUID, p_run BIGINT, p_limit INT DEFAULT 20)
RETURNS SETOF tailor_jobs
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_settings JSONB;
  v_cap      INT;
  v_tz       TEXT;
  v_left     INT;
  v_again    BIGINT[];
  v_fresh    BIGINT[];
  v_all      BIGINT[];
BEGIN
  UPDATE tailor_jobs j
     SET status = CASE WHEN EXISTS (SELECT 1 FROM resume_comments c WHERE c.plan_item_id = j.plan_item_id AND c.status = 'open')
                       THEN 'revision_requested' ELSE 'queued' END,
         locked_at = NULL, locked_by_run = NULL, updated_at = NOW()
   WHERE j.user_id = p_user AND j.status = 'in_progress' AND j.locked_at < NOW() - INTERVAL '2 hours';

  BEGIN
    SELECT value::jsonb INTO v_settings FROM meta WHERE user_id = p_user AND key = 'daily_plan_settings';
  EXCEPTION WHEN others THEN v_settings := NULL;
  END;
  v_cap := COALESCE((v_settings->>'queueCap')::int, 60);
  v_tz := COALESCE(NULLIF(v_settings->>'timezone', ''), 'America/Chicago');
  IF NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = v_tz) THEN v_tz := 'America/Chicago'; END IF;
  SELECT GREATEST(v_cap - COUNT(*), 0) INTO v_left
    FROM tailor_jobs WHERE user_id = p_user AND claimed_at >= (date_trunc('day', NOW() AT TIME ZONE v_tz) AT TIME ZONE v_tz);

  -- Revisions, and roles a run already had, first: they don't count toward the cap.
  SELECT array_agg(id) INTO v_again FROM (
    SELECT j.id FROM tailor_jobs j
      JOIN plan_items pi ON pi.id = j.plan_item_id
      LEFT JOIN scraped_roles sr ON sr.id = j.scraped_role_id
     WHERE j.user_id = p_user AND (j.status = 'revision_requested' OR (j.status = 'queued' AND j.claimed_at IS NOT NULL))
     ORDER BY (j.status = 'revision_requested') DESC, j.priority DESC, COALESCE(sr.posted_at, pi.created_at) DESC
     LIMIT p_limit
       FOR UPDATE OF j SKIP LOCKED
  ) s;

  IF LEAST(v_left, p_limit - COALESCE(array_length(v_again, 1), 0)) > 0 THEN
    SELECT array_agg(id) INTO v_fresh FROM (
      SELECT j.id FROM tailor_jobs j
        JOIN plan_items pi ON pi.id = j.plan_item_id
        LEFT JOIN scraped_roles sr ON sr.id = j.scraped_role_id
       WHERE j.user_id = p_user AND j.status = 'queued' AND j.claimed_at IS NULL
       ORDER BY j.priority DESC, COALESCE(sr.posted_at, pi.created_at) DESC
       LIMIT LEAST(v_left, p_limit - COALESCE(array_length(v_again, 1), 0))
         FOR UPDATE OF j SKIP LOCKED
    ) s;
  END IF;

  v_all := COALESCE(v_again, '{}') || COALESCE(v_fresh, '{}');
  RETURN QUERY
  WITH claimed AS (
    UPDATE tailor_jobs j
       SET status = 'in_progress', attempts = j.attempts + 1, claimed_at = COALESCE(j.claimed_at, NOW()),
           locked_at = NOW(), locked_by_run = p_run, updated_at = NOW()
     WHERE j.id = ANY(v_all)
    RETURNING j.*
  )
  SELECT * FROM claimed ORDER BY array_position(v_all, claimed.id);
END;
$$;

REVOKE ALL ON FUNCTION claim_tailor_jobs(UUID, BIGINT, INT) FROM PUBLIC, anon, authenticated;
