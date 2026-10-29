// FAANG+ / Quant tier and industry for a company name, whatever board the
// posting came from. Names the shared catalog tags (SpeedyApply's FAANG+ and
// Quant tables) plus the known-company map in categorize.js; a name that starts
// with a known one counts as it ("Amazon Web Services (AWS)" is Amazon).
import { all } from '../db.js';
import { KNOWN_COMPANIES } from './categorize.js';

const TIER_OF_SUB = { 'Big Tech / FAANG': 'faang', 'Quant Funds': 'quant', 'Prop Trading Firms': 'quant' };
// Brands that post under their own name but belong to a FAANG+ parent.
const ALIASES = { aws: 'amazon', instagram: 'meta', whatsapp: 'meta', youtube: 'google', deepmind: 'google', linkedin: 'microsoft', github: 'microsoft' };

/** "Amazon Web Services (AWS), Inc." → "amazon web services". */
export const companyKey = (name) => String(name || '').toLowerCase()
  .replace(/\([^)]*\)/g, ' ')
  .replace(/\b(inc|llc|ltd|corp|corporation|incorporated|limited|plc|co)\b\.?/g, ' ')
  .replace(/[.,]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

/** Exact name, then the longest known name it starts with, then a parent brand. */
function lookup(name, table) {
  const k = companyKey(name);
  if (!k) return null;
  if (table.has(k)) return table.get(k);
  const words = k.split(' ');
  for (let i = words.length - 1; i >= 1; i--) {
    const prefix = words.slice(0, i).join(' ');
    if (table.has(prefix)) return table.get(prefix);
  }
  const parent = ALIASES[words[0]];
  return parent && table.has(parent) ? table.get(parent) : null;
}

/** Known names → 'faang' | 'quant'. Catalog rows are { company_name, tier }. */
export function tierTable(catalogRows = []) {
  const m = new Map();
  for (const [name, v] of KNOWN_COMPANIES) if (TIER_OF_SUB[v.subcategory]) m.set(companyKey(name), TIER_OF_SUB[v.subcategory]);
  for (const r of catalogRows) if (r.tier === 'faang' || r.tier === 'quant') m.set(companyKey(r.company_name), r.tier);
  return m;
}

export const tierFor = (name, table) => lookup(name, table);

const industries = new Map([...KNOWN_COMPANIES].map(([name, v]) => [companyKey(name), v.category]));
export const industryFor = (name) => lookup(name, industries);

let cached = null;
let cachedAt = 0;
/** The tier table with the catalog's names, refreshed hourly. */
export async function companyTiers() {
  if (cached && Date.now() - cachedAt < 3_600_000) return cached;
  const rows = await all("SELECT DISTINCT company_name, tier FROM scraped_roles WHERE tier IN ('faang', 'quant')").catch(() => []);
  cached = tierTable(rows);
  cachedAt = Date.now();
  return cached;
}
