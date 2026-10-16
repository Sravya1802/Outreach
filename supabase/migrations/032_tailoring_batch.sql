-- 032_tailoring_batch.sql
-- Nightly resumes run through Anthropic's Message Batches (half price). A
-- tailoring started from the evening list waits here between steps:
--   { phase: queued | drafting | revise_queued | revising, batchId, customId,
--     jd (keywords, focus, title), draft, notes, model, cost, tries, submittedAt }
-- NULL for a tailoring run straight through (the "Tailor my resume" button),
-- and cleared when a batched one finishes.
-- Additive and idempotent.

ALTER TABLE resume_tailorings ADD COLUMN IF NOT EXISTS batch JSONB;
CREATE INDEX IF NOT EXISTS resume_tailorings_batch ON resume_tailorings ((batch->>'phase')) WHERE batch IS NOT NULL AND status = 'running';
