// Job markets: each account picks one at sign-up and every role list,
// digest and auto-apply plan is filtered to it.
//   market (user_profile.job_market) → region (scraped_roles.region)
//   'usa'   → 'usa'
//   'india' → 'india'
//   'other' → 'intl'   (every other country)
import { one } from '../db.js';

export const MARKETS = ['usa', 'india', 'other'];
export const DEFAULT_MARKET = 'usa';

const REGION_BY_MARKET = { usa: 'usa', india: 'india', other: 'intl' };

export function isMarket(v) {
  return MARKETS.includes(v);
}

export function regionForMarket(market) {
  return REGION_BY_MARKET[market] || REGION_BY_MARKET[DEFAULT_MARKET];
}

// Whole words only: "Indiana" and "Indianapolis" are not India.
const INDIA_PLACES = [
  'india', 'bengaluru', 'bangalore', 'hyderabad', 'pune', 'mumbai', 'new delhi', 'delhi', 'gurgaon', 'gurugram',
  'noida', 'chennai', 'kolkata', 'ahmedabad', 'kochi', 'thiruvananthapuram', 'trivandrum', 'coimbatore', 'jaipur',
  'chandigarh', 'indore', 'mysuru', 'mysore', 'visakhapatnam', 'bhubaneswar', 'nagpur',
];
const INDIA_RE = new RegExp(`\\b(${INDIA_PLACES.join('|')})\\b`, 'i');
/** Same list for Postgres (\m and \M are its word boundaries). */
export const INDIA_PG_PATTERN = `\\m(${INDIA_PLACES.join('|')})\\M`;

export function isIndiaLocation(location) {
  return INDIA_RE.test(String(location || ''));
}

/**
 * Region for a catalog row. A source may already say 'usa' / 'intl' / 'india';
 * an international row located in India becomes 'india'. USA-list rows stay
 * USA even if one of several locations is in India.
 */
export function regionForRole(role) {
  const declared = role.region === 'india' || role.region === 'intl' ? role.region : 'usa';
  if (declared === 'intl' && isIndiaLocation(role.location)) return 'india';
  return declared;
}

/** The account's market, falling back to USA until they pick one. */
export async function marketFor(userId) {
  const row = await one('SELECT job_market FROM user_profile WHERE user_id = $1', [userId]);
  return isMarket(row?.job_market) ? row.job_market : DEFAULT_MARKET;
}
