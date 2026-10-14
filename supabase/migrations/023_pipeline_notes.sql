-- 023_pipeline_notes.sql
-- Pipeline page: a free-text note and a dated next step per application, and
-- when the stage last changed (so "Updated" and follow-up nudges mean
-- something). Additive and idempotent.

ALTER TABLE evaluations ADD COLUMN IF NOT EXISTS notes            TEXT;
ALTER TABLE evaluations ADD COLUMN IF NOT EXISTS next_step        TEXT;
ALTER TABLE evaluations ADD COLUMN IF NOT EXISTS next_step_at     DATE;
ALTER TABLE evaluations ADD COLUMN IF NOT EXISTS stage_changed_at TIMESTAMPTZ;
