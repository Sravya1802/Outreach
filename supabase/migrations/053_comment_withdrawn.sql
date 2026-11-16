-- 053_comment_withdrawn.sql
-- A change request the user takes back ("Use this version anyway"): the
-- comment is kept as 'withdrawn', so the role leaves Revising and no run
-- answers it. Idempotent.
ALTER TABLE resume_comments DROP CONSTRAINT IF EXISTS resume_comments_status_check;
ALTER TABLE resume_comments ADD CONSTRAINT resume_comments_status_check CHECK (status IN ('open', 'addressed', 'withdrawn'));
