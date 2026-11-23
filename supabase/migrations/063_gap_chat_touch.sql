-- 063_gap_chat_touch.sql
-- A gap question or your answer to one moves the role's changed_at (migration
-- 060), so the cached Review queue and dashboard show it right away: a role
-- with an answer waiting for your Claude run is "Revising", not "Ready for you".
-- Idempotent.

DROP TRIGGER IF EXISTS tailor_jobs_touch_gaps ON gap_chat;
CREATE TRIGGER tailor_jobs_touch_gaps AFTER INSERT OR UPDATE OR DELETE ON gap_chat
  FOR EACH ROW EXECUTE FUNCTION tailor_jobs_touch_related();
