-- 049_graduation_reason.sql
-- A graduation window that holds neither May 2027 nor December 2027 (the
-- user's two possible graduations) is its own reason, 'graduation', for
-- internships and new grad alike; 'return_to_school' is kept for internships
-- that say the intern goes back to school afterwards. Idempotent.
ALTER TABLE scraped_roles DROP CONSTRAINT IF EXISTS scraped_roles_ineligible_reason_check;
ALTER TABLE scraped_roles ADD CONSTRAINT scraped_roles_ineligible_reason_check
  CHECK (ineligible_reason IS NULL OR ineligible_reason IN ('citizenship', 'clearance', 'mba', 'phd', 'return_to_school', 'graduation'));
