/**
 * staffing.js — is this posting from a recruiting / staffing agency rather
 * than the company that would employ you? Agencies usually mean a recruiter
 * call and a contract role, not a job at the company, so the evening list
 * leaves them out. Deterministic: agency names, name patterns and the
 * phrases agencies use in job descriptions.
 */

// Well-known agencies and job-ad networks (lowercase, matched as whole words).
const KNOWN = [
  'robert half', 'teksystems', 'insight global', 'randstad', 'adecco', 'kforce', 'aerotek', 'collabera', 'apex systems',
  'cybercoders', 'jobot', 'manpower', 'manpowergroup', 'kelly services', 'hays', 'michael page', 'allegis', 'modis', 'akkodis',
  'experis', 'beacon hill', 'motion recruitment', 'diverse lynx', 'infojini', 'tata consultancy staffing', 'mindlance', 'yoh',
  'judge group', 'the judge group', 'vaco', 'aston carter', 'actalent', 'hirequest', 'talentbridge', 'revature', 'smoothstack',
  'synergisticit', 'skillstorm', 'fdm group', 'genesis10', 'pyramid consulting', 'iconma', 'artech', 'rangam', 'tekwissen',
  'zeektek', 'ampcus', 'dice', 'jobs via dice', 'lensa', 'jobright', 'talentify', 'employia', 'talenthop', 'divine talent',
  'jobs for humanity', 'recruiting from scratch', 'hire talent', 'aavalar consulting',
];

// Words that make a company name look like an agency.
const NAME_PATTERN = /\b(staffing|recruit(ing|ment|ers)?|talent (solutions|group|partners|acquisition)|headhunt\w*|placement(s)?|manpower|workforce solutions|it solutions|consult(ing|ancy) (services|group|inc)|technolog(y|ies) solutions|infotech|systems inc|hiring)\b/i;
const NAME_WORDS = /\b(talent|staff|recruit|hire|jobs?)\b/i;

// Phrases agencies use in postings.
const JD_SIGNALS = [
  /\bour client\b/i,
  /\bon behalf of (our|a) client\b/i,
  /\b(w2|w-2)\b.*\b(c2c|corp[- ]to[- ]corp|1099)\b|\b(c2c|corp[- ]to[- ]corp)\b/i,
  /\bcontract[- ]to[- ]hire\b/i,
  /\bstaffing (agency|firm|company|partner)\b/i,
  /\b(recruiting|staffing) (agency|firm)\b/i,
  /\bh-?1b transfer\b/i,
  /\bwe are (a|an) (leading )?(staffing|recruiting|talent)\b/i,
  /\bbench sales\b/i,
  /\bplacement (fee|guarantee)\b/i,
  /\btraining (and|&) placement\b/i,
];

const lc = (s) => String(s ?? '').toLowerCase();

/** { agency: boolean, why: string|null } */
export function looksLikeAgency(company, jd = '') {
  const name = lc(company).replace(/[.,]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!name) return { agency: false, why: null };
  for (const k of KNOWN) if (new RegExp(`(^|\\s)${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|\\s)`).test(name)) return { agency: true, why: 'Recruiting agency, not the employer' };
  if (NAME_PATTERN.test(name)) return { agency: true, why: 'Recruiting agency, not the employer' };
  const hits = JD_SIGNALS.filter(re => re.test(jd)).length;
  if (hits >= 2 || (hits >= 1 && NAME_WORDS.test(name))) return { agency: true, why: 'Recruiting agency, not the employer' };
  return { agency: false, why: null };
}
