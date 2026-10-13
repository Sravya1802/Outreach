// ── Contact rules: who's worth contacting, names, email quality ──────────────
// Pure functions shared by Find People, bulk Find Emails and per-contact Find
// Email. Matching is on whole words — the old substring checks treated
// "Creative Director" as a CTO ("dire-cto-r") and "Salesforce Developer" as
// sales.

const words = (list) => new RegExp(`\\b(?:${list.join('|')})\\b`, 'i');

// People an intern / new-grad candidate should reach: engineering ICs and
// leads, technical leadership, founders, and recruiting / people teams.
const RELEVANT = words([
  'engineer(?:ing)?', 'developer', 'programmer', 'architect', 'sre', 'devops', 'swe',
  'cto', 'chief technology officer', 'chief technical officer', 'vp of engineering', 'vp engineering',
  'head of engineering', 'head of (?:data|ai|ml|platform|infrastructure|product)', 'tech(?:nical)? lead',
  'staff', 'principal', 'scientist', 'researcher', 'machine learning', 'ml', 'ai', 'data',
  'quant(?:itative)?', 'founder', 'co-?founder', 'ceo', 'chief executive officer', 'president',
  'recruit(?:er|ing|ment)?', 'talent', 'sourcer', 'hiring manager', 'university relations',
  'campus', 'early careers?', 'people operations', 'people partner', 'human resources', 'hr',
  'hrbp', 'chief people officer', 'head of people',
]);

// Clearly not useful, unless the title also says engineering/recruiting
// (e.g. "Sales Engineer" stays, "Account Executive" goes).
const IRRELEVANT = words([
  'sales', 'account executive', 'account manager', 'marketing', 'brand', 'copywriter', 'social media',
  'public relations', 'legal', 'counsel', 'attorney', 'paralegal', 'compliance', 'accountant',
  'accounting', 'bookkeeper', 'controller', 'finance', 'financial advisor', 'insurance', 'agent',
  'customer success', 'customer support', 'office manager', 'executive assistant', 'administrative',
  'receptionist', 'facilities', 'intern',
]);
const STRONG_RELEVANT = words([
  'engineer(?:ing)?', 'developer', 'scientist', 'recruit(?:er|ing|ment)?', 'talent', 'cto', 'founder', 'co-?founder',
]);

/**
 * Should this person be saved as an outreach contact?
 * Empty titles are kept (providers often omit them) unless `requireTitle`.
 */
export function isRelevantContact(title, { requireTitle = false } = {}) {
  const t = String(title || '').trim();
  if (!t) return !requireTitle;
  if (IRRELEVANT.test(t) && !STRONG_RELEVANT.test(t)) return false;
  return RELEVANT.test(t);
}

export function isRecruiterTitle(title) {
  return words(['recruit(?:er|ing|ment)?', 'talent', 'sourcer', 'university relations', 'campus', 'early careers?', 'people', 'hr', 'human resources'])
    .test(String(title || ''));
}

/** Ranking for display/insertion order: founders/CTOs first, then leaders, recruiters, ICs. */
export function seniorityScore(title = '') {
  const t = String(title || '');
  if (words(['founder', 'co-?founder', 'ceo', 'chief executive officer']).test(t)) return 10;
  if (words(['cto', 'chief technology officer', 'cpo', 'chief product officer']).test(t)) return 9;
  if (words(['vp', 'vice president']).test(t)) return 8;
  if (words(['director']).test(t)) return 7;
  if (words(['head of']).test(t)) return 6;
  if (isRecruiterTitle(t)) return 6; // recruiters are high-value for internship outreach
  if (words(['principal', 'staff']).test(t)) return 5;
  if (words(['manager', 'lead']).test(t)) return 4;
  if (words(['senior', 'sr']).test(t)) return 3;
  if (words(['engineer(?:ing)?', 'developer', 'scientist']).test(t)) return 2;
  return 1;
}

const HONORIFICS = new Set(['mr', 'mrs', 'ms', 'miss', 'mx', 'dr', 'prof', 'sir', 'dame']);
const SUFFIXES = new Set(['jr', 'sr', 'ii', 'iii', 'iv', 'phd', 'md', 'mba', 'cpa', 'pe', 'esq', 'msc', 'ms', 'bsc', 'pmp']);
const PARTICLES = new Set(['van', 'von', 'der', 'den', 'de', 'del', 'della', 'da', 'di', 'dos', 'du', 'la', 'le', 'bin', 'al', 'st']);

/**
 * "Dr. Jane van der Berg, PhD (she/her)" → { first: 'Jane', last: 'van der Berg' }.
 * Returns null when there is no usable first + last name.
 */
export function splitName(full) {
  let s = String(full || '')
    .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')      // (she/her), [Hiring]
    .replace(/\s+[|·•–—-]\s+.*$/, '')           // "Jane Doe - Engineer at X"
    .split(',')[0]                              // "Jane Doe, PhD"
    .replace(/[^\p{L}\p{M}'’\-.\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const parts = s.split(' ').filter(Boolean);
  while (parts.length && HONORIFICS.has(parts[0].toLowerCase().replace(/\.$/, ''))) parts.shift();
  while (parts.length && SUFFIXES.has(parts[parts.length - 1].toLowerCase().replace(/\./g, ''))) parts.pop();
  if (parts.length < 2) return null;
  const first = parts[0].replace(/\.$/, '');
  // Last name = final word plus any particles directly before it.
  let i = parts.length - 1;
  while (i > 1 && PARTICLES.has(parts[i - 1].toLowerCase())) i--;
  const last = parts.slice(i).join(' ');
  if (first.length < 1 || last.replace(/[^\p{L}]/gu, '').length < 1) return null;
  s = `${first} ${last}`;
  return { first, last, full: s };
}

/** Lowercase key for "is this the same person?" checks across sources. */
export function nameKey(full) {
  const n = splitName(full);
  return (n ? `${n.first} ${n.last}` : String(full || '')).toLowerCase().normalize('NFKD').replace(/[^a-z]/g, '');
}

// Role / team inboxes — real addresses, but not a person to contact.
const ROLE_LOCALPARTS = /^(info|hello|hi|hey|contact|support|help|team|admin|office|press|media|pr|jobs|careers|recruiting|talent|hr|sales|marketing|billing|invoices|accounts|privacy|legal|security|abuse|webmaster|postmaster|noreply|no-reply|donotreply|do-not-reply|notifications?|newsletter)@/i;

/** Plausible personal work email? Rejects role inboxes and provider placeholders. */
export function isUsableEmail(email) {
  const e = String(email || '').trim().toLowerCase();
  if (!/^[a-z0-9._%+'-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(e)) return false;
  if (e.startsWith('email_not_unlocked@') || e.includes('domain.com') || e.endsWith('@example.com')) return false;
  return !ROLE_LOCALPARTS.test(e);
}

/**
 * One vocabulary for every provider:
 *   valid      — the provider verified the mailbox accepts mail
 *   risky      — catch-all / accept-all domain, or provider unsure but likely
 *   unverified — a guess (score or pattern only), never shown as good
 *   invalid    — provider says it bounces
 */
export function normalizeEmailStatus(provider, raw = {}) {
  const status = String(raw.status ?? raw.verification_status ?? raw.email_status ?? '').toLowerCase().trim();
  const score = Number(raw.score ?? raw.confidence);
  if (['invalid', 'undeliverable', 'bounced', 'disposable'].includes(status)) return 'invalid';
  if (['valid', 'verified', 'deliverable'].includes(status)) return 'valid';
  if (['accept_all', 'accept-all', 'catch_all', 'catch-all', 'catchall', 'likely', 'guessed', 'webmail', 'risky'].includes(status)) return 'risky';
  if (provider === 'website' || provider === 'serper') return 'risky'; // published by the company itself / found in the wild
  if (Number.isFinite(score) && score >= 90) return 'risky';
  return 'unverified';
}

const STATUS_RANK = { valid: 3, risky: 2, unverified: 1, invalid: 0 };

/** Pick the better of two candidates ({email, status, confidence}). */
export function betterCandidate(a, b) {
  if (!a) return b;
  if (!b) return a;
  const d = (STATUS_RANK[b.status] ?? 0) - (STATUS_RANK[a.status] ?? 0);
  if (d !== 0) return d > 0 ? b : a;
  return (Number(b.confidence) || 0) > (Number(a.confidence) || 0) ? b : a;
}

export function isGoodEnough(candidate) {
  return candidate?.status === 'valid' || candidate?.status === 'risky';
}
