-- 017_job_markets.sql
-- Each account picks a job market at sign-up: USA, India, or other countries.
-- Role lists, alerts and auto-apply follow it. The catalog gains an 'india'
-- region next to 'usa' and 'intl' (= every other country).
-- Additive and idempotent.

ALTER TABLE user_profile
  ADD COLUMN IF NOT EXISTS job_market TEXT CHECK (job_market IN ('usa', 'india', 'other'));

-- International listings located in India move to the India list. Whole
-- words only (\m \M), so "Indiana" and "Indianapolis" stay put. Same list
-- as services/markets.js.
UPDATE scraped_roles
   SET region = 'india'
 WHERE region = 'intl'
   AND location ~* '\m(india|bengaluru|bangalore|hyderabad|pune|mumbai|new delhi|delhi|gurgaon|gurugram|noida|chennai|kolkata|ahmedabad|kochi|thiruvananthapuram|trivandrum|coimbatore|jaipur|chandigarh|indore|mysuru|mysore|visakhapatnam|bhubaneswar|nagpur)\M';
