-- 039_close_public_access.sql
-- Tables added since 025 never turned on row security, and Supabase grants new
-- tables to anon and authenticated. Anyone with the public key in the website
-- could read and change them through the REST API. The backend connects as the
-- table owner and the website reads no tables directly, so neither needs this.
-- A new table needs the same two lines, as in 038.
-- Additive and idempotent.

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'daily_plans', 'email_outbox', 'email_replies', 'gmail_connections', 'linkedin_connections', 'plan_items',
    'planned_projects', 'referral_asks', 'resume_files', 'resume_tailorings', 'whatsapp_links', 'whatsapp_messages'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON %I FROM anon, authenticated', t);
  END LOOP;
END $$;
