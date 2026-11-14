// Can the user (F-1 MS CS student, graduating May 2027) take this role? Read
// from the job description and the title. Pure functions, no I/O.
//
//   eligibilityFor({ title, text, roleType }) →
//     { reason, phrase }  remove: 'citizenship' | 'clearance' | 'mba' | 'phd' | 'return_to_school'
//     { flag }            keep, but "Check eligibility": the posting says something close
//     null                nothing found
//
// Never removed: bachelor's-only roles, "Master's or PhD", "PhD/MBA preferred",
// "must be authorized to work in the US" alone, and postings that also take
// F-1/CPT/OPT students or anyone authorized to work.
import { RETURN_TO_SCHOOL, notReturnToSchool } from './gradYear.js';

/**
 * SQL (on scraped_roles, `p` its alias with the dot): a role the user can take.
 * Restored by the user wins; else no reason found, and not a return-to-school
 * internship by the older check (for rows not read yet).
 */
export const eligibleSql = (p = '') =>
  `(${p}eligibility_restored_at IS NOT NULL OR (${p}ineligible_reason IS NULL AND ${notReturnToSchool(`${p}role_type`, `${p}description`, `${p}return_to_school`)}))`;
/** SQL: removed for eligibility, not restored. */
export const removedSql = (p = '') => `(${p}ineligible_reason IS NOT NULL AND ${p}eligibility_restored_at IS NULL)`;

/** The note a closed queue role gets. */
export function closedNote(reason, phrase) {
  const why = {
    citizenship: 'the posting requires a U.S. citizen or green card holder',
    clearance: 'the posting requires a security clearance',
    mba: 'the role requires an MBA',
    phd: 'the role requires a PhD',
    return_to_school: 'the internship is for students returning to school afterwards',
    field: 'the title is outside software, data and AI',
  }[reason] || reason;
  return `Removed: ${why}${phrase ? ` (“${String(phrase).slice(0, 160)}”)` : ''}.`;
}

export const REASONS = ['citizenship', 'clearance', 'mba', 'phd', 'return_to_school'];
export const REASON_LABEL = {
  citizenship: 'U.S. citizen or green card only',
  clearance: 'Security clearance',
  mba: 'MBA required',
  phd: 'PhD required',
  return_to_school: 'Return to school',
};

const clip = (s) => String(s).replace(/\s+/g, ' ').trim().slice(0, 200);
/** The text around a match, for the phrase shown to the user. */
const around = (t, m, before = 0, after = 0) => clip(t.slice(Math.max(0, m.index - before), m.index + m[0].length + after));

// ── Citizenship ───────────────────────────────────────────────────────────────
const US = String.raw`(?:u\.?\s?s\.?|united states)`;
const CITIZENSHIP = [
  new RegExp(String.raw`\b(?:must|required to|need to|needs to|have to|shall)\s+(?:be|hold|possess|have)\s+(?:an?\s+)?(?:\(?[ivx1-4]+\)\s*)?(?:active\s+)?${US}\s+(?:citizen(?:ship)?|persons?|national)`, 'i'),
  new RegExp(String.raw`\b(?:must|required to|need to)\s+be\s+(?:an?\s+)?(?:\(?[ivx1-4]+\)\s*)?(?:${US}\s+)?(?:citizen|permanent resident|lawful permanent resident|green card holder)s?\b`, 'i'),
  new RegExp(String.raw`\b${US}\s+citizenship\s+(?:is\s+)?(?:required|needed|mandatory)`, 'i'),
  new RegExp(String.raw`\b(?:requires?|requiring|required:?)\s+(?:active\s+|current\s+)?${US}\s+(?:citizenship|citizens?|persons?)`, 'i'),
  new RegExp(String.raw`\b${US}\s+(?:citizens?|persons?)\s+only\b`, 'i'),
  new RegExp(String.raw`\b(?:open|available|limited)\s+(?:only\s+)?to\s+${US}\s+(?:citizens?|persons?)\b`, 'i'),
  new RegExp(String.raw`\bonly\s+${US}\s+(?:citizens?|persons?)\b`, 'i'),
  new RegExp(String.raw`\b(?:citizens?|persons?)\s+of\s+the\s+united states\s+(?:only|required)\b`, 'i'),
  // Export control with U.S. persons as the bar.
  new RegExp(String.raw`\b(?:itar|ear|export[-\s]control(?:led)?|export administration regulations|international traffic in arms)\b[^.]{0,250}\b${US}\s+persons?\b[^.]{0,120}|\b${US}\s+persons?\b[^.]{0,250}\b(?:itar|export[-\s]control(?:led)?|international traffic in arms)\b`, 'i'),
];
// A softer mention: worth a look, not a removal.
const CITIZENSHIP_SOFT = new RegExp(String.raw`\b${US}\s+persons?\b|\bexport (?:license|licence|authorization)\b|\b(?:itar|export[-\s]controlled)\b`, 'i');
// The bar has a door: F-1/CPT/OPT students, or anyone authorized to work.
const STUDENTS_WELCOME = /\b(?:f-?1|cpt|opt|stem opt)\b[^.]{0,80}\b(?:accepted|eligible|welcome|considered)\b|\bstudents?\s+with\s+(?:valid\s+)?work authorization\b|\bor\s+(?:be\s+)?(?:otherwise\s+)?(?:authorized|eligible)\s+to\s+work\b/i;

// ── Clearance ─────────────────────────────────────────────────────────────────
const LEVEL = String.raw`(?:an?\s+)?(?:active\s+|interim\s+|current\s+)?(?:u\.?s\.?\s+)?(?:dod\s+|dow\s+|government\s+|federal\s+|u\.?s\.?\s+government\s+)?(?:secret|top secret|ts\/sci|ts|security|public trust)(?:\s*\/?\s*sci)?(?:\s+level)?(?:\s+security)?\s+clearance`;
const CLEARANCE = new RegExp([
  String.raw`\b(?:active|current|interim|ability to obtain|able to obtain|eligib\w+ (?:to|for) (?:obtain\w*)?(?: and maintain)?|must (?:obtain|hold|have|possess|be able to obtain)|requires?|required|obtain and maintain|maintain)\s+${LEVEL}\b`,
  String.raw`\b(?:secret|top secret|ts\/sci|public trust)(?:\s+security)?\s+clearance\s+(?:is\s+)?(?:required|needed|mandatory)\b`,
  String.raw`\bclearance(?:\s+(?:level|required|requirements?))?\s*:\s*\**\s*(?:active\s+)?(?:u\.?s\.?\s+)?(?:dod\s+|dow\s+)?(?:secret|top secret|ts\/sci|ts|public trust|ability to obtain|required|must obtain)\b`,
  String.raw`\bpolygraph\s+(?:is\s+)?required\b|\b(?:with|and|pass(?:ing)?|submit to|undergo)\s+(?:an?\s+)?(?:full[-\s]scope\s+|ci\s+|counterintelligence\s+)?polygraph\b(?!\s+protection)`,
].join('|'), 'i');
const CLEARANCE_SOFT = /\b(?:secret|top secret|ts\/sci|security|public trust)\s+(?:level\s+)?clearance\b|\bpolygraph\b(?!\s+protection)/i;
const NOT_REQUIRED = /\b(?:preferred|desired|a plus|nice to have|bonus|not required|no\b[^.]{0,20}required|is not needed|helpful|advantage)\b/i;
const NO_CLEARANCE = /\bno\s+(?:security\s+)?clearance\b|\bclearance\s+(?:type|status|level)?:?\s*(?:none|not required|n\/a)\b/i;

// ── MBA ───────────────────────────────────────────────────────────────────────
const MBA_TITLE = /\bmba\b/i;
const MBA_REQUIRED = /\b(?:currently\s+)?(?:enrolled in|pursuing|working toward|completing)\s+(?:an?\s+|your\s+)?(?:full[-\s]time\s+)?mba\b[^.]{0,80}|\bmba\s+(?:candidates?|students?)\s+only\b|\bopen\s+(?:only\s+)?to\s+mba\s+(?:candidates?|students?)\b[^.]{0,40}|\bmba\s+(?:degree\s+)?(?:is\s+)?required\b|\brequires?\s+an?\s+mba\b|\bmust\s+(?:be\s+(?:pursuing|enrolled in)|have|hold)\s+an?\s+mba\b[^.]{0,40}/i;
// "an MBA or graduate degree", "Bachelor's, Master's or MBA": another degree will do.
const MBA_OR = /\b(?:or|and\/or|\/)\s*(?:an?\s+)?(?:other\s+)?(?:master'?s?|bachelor'?s?|ms|bs|undergrad\w*|graduate|advanced)\b|\b(?:master'?s?|bachelor'?s?|undergrad\w*|graduate)\b[^.]{0,40}\b(?:or|and\/or|\/)\s*(?:an?\s+)?mba\b/i;

// ── PhD ───────────────────────────────────────────────────────────────────────
const PHD = String.raw`(?:ph\.?\s?d\.?|doctoral|doctorate)`;
const PHD_TITLE = new RegExp(String.raw`\b${PHD}`, 'i');
const OTHER_DEGREE = /\b(?:master'?s?|masters|ms|m\.s\.|msc|bachelor'?s?|bs|b\.s\.|bsc|undergrad(?:uate)?|graduate students?)\b/i;
const PHD_REQUIRED = [
  new RegExp(String.raw`\b(?:must|should)\s+be\s+(?:an?\s+)?(?:current\s+|currently\s+)?(?:enrolled\s+(?:in\s+)?)?(?:an?\s+)?${PHD}\s*(?:students?|candidates?|program)?[^.]{0,60}`, 'i'),
  new RegExp(String.raw`\bcurrently\s+(?:enrolled\s+in|pursuing|working\s+toward)\s+(?:an?\s+)?${PHD}[^.]{0,80}`, 'i'),
  new RegExp(String.raw`\b(?:enrolled in|pursuing)\s+(?:an?\s+)?${PHD}\s+(?:degree\s+)?program[^.]{0,60}`, 'i'),
  new RegExp(String.raw`\b${PHD}\s+(?:degree\s+)?(?:in\s+[^.]{0,60}?\s+)?(?:is\s+)?required\b`, 'i'),
  new RegExp(String.raw`\brequires?\s+(?:an?\s+)?${PHD}\b[^.]{0,60}`, 'i'),
  new RegExp(String.raw`\b${PHD}\s+(?:students?|candidates?)\s+only\b`, 'i'),
  new RegExp(String.raw`\bopen\s+(?:only\s+)?to\s+${PHD}\s+(?:students?|candidates?)\b[^.]{0,60}`, 'i'),
  new RegExp(String.raw`\bthis\s+(?:internship|role|position)\s+is\s+(?:for|open to)\s+${PHD}\s+(?:students?|candidates?)\b`, 'i'),
];
const OR_ALTERNATIVE = /\b(?:or|and\/or)\b[^.]{0,40}\b(?:master'?s?|masters|ms|bachelor'?s?|bs|undergrad)|\b(?:master'?s?|masters|ms|m\.s\.|bachelor'?s?|bs)\b[^.]{0,40}\b(?:or|and\/or|\/)\s*(?:an?\s+)?(?:ph\.?\s?d|doctoral|doctorate)/i;

// A Master's is acceptable somewhere in the posting (or the title): then it's never removed for PhD or MBA.
// "MS" only in capitals and not as Microsoft's ("MS Office", "MS SQL").
const MASTERS_WORDS = /\b(?:master'?s|masters|master of (?:science|engineering|arts|computer|data|information|applied|business|financial|quantitative|statistics|mathematics)|m\.\s?s\.|m\.?\s?sc\.?|m\.?\s?eng\.?|graduate degree)(?=\W|$)/i;
const MASTERS_MS = /\bMS\b(?!\s*(?:Office|Excel|Word|SQL|Teams|Project|Access|PowerPoint|Outlook|Azure|Dynamics|Visio|Windows|365|Fabric|Power|Edge|Defender)\b)/;
/** The words that show a Master's will do, or null. Pure. */
export function mastersOption(title, text) {
  for (const src of [String(title || ''), String(text || '')]) {
    const m = MASTERS_WORDS.exec(src) || MASTERS_MS.exec(src);
    if (m) return clip(src.slice(Math.max(0, m.index - 60), m.index + m[0].length + 60));
  }
  return null;
}

// ── Return to school (internships) ───────────────────────────────────────────
const RETURN_RE = new RegExp(RETURN_TO_SCHOOL, 'i');
const REMAINING = /\b(?:at least|minimum of|a minimum of)?\s*(?:one|1|a|two|2)\s+(?:full\s+)?(?:academic\s+)?(?:semester|quarter|term|year)s?\s+(?:of\s+(?:school|study|studies|coursework|classes)\s+)?(?:remaining|left)\s+(?:after|following|upon)\b[^.]{0,60}/i;
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const SEASON = { spring: 5, summer: 8, fall: 12, autumn: 12, winter: 12 };
const DATE_TOKEN = /\b(?:(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?|spring|summer|fall|autumn|winter)\.?\s*(?:of\s+)?,?\s*)?(20[2-3]\d)\b/gi;
// Graduation wording only: not "graduate-level", "graduate students" or "graduate degree".
const GRAD_SENTENCE = /\b(?:graduating|graduation|graduates?\s+(?:in|by|between|from|after|before|no)|(?:will|you|expect(?:ed)?\s+to|plan(?:s|ning)?\s+to)\s+graduate\b(?!\s*(?:students?|level|degree|program|school))|class of|degree (?:completion|conferral)|complet\w* (?:your|their) (?:degree|program) (?:in|by|between))\b/i;
// "graduating by / before / no later than <date>" is a ceiling the user meets: those dates don't count.
const CEILING = /\b(?:before|by|no later th[ae]n|not later th[ae]n|prior to|until|through|up to|on or before)\s+((?:(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?|spring|summer|fall|autumn|winter)\s*(?:of\s+)?,?\s*)?20[2-3]\d\b/gi;
const USER_GRAD = 2027 * 12 + 6; // June 2027: graduating after this means returning to school

/** The earliest graduation date a sentence asks for, as year*12+month, ignoring ceilings; null without one. */
function earliestGraduation(sentence) {
  const s = sentence.replace(CEILING, ' ');
  let best = null;
  for (const m of s.matchAll(DATE_TOKEN)) {
    const [, when, year] = m;
    const y = Number(year);
    let month;
    if (!when) month = y >= 2028 ? 1 : null; // "2028" alone: some time in 2028; "2027" alone can't be told
    else if (SEASON[when.toLowerCase()]) month = SEASON[when.toLowerCase()];
    else month = MONTHS.indexOf(when.slice(0, 3).toLowerCase()) + 1;
    if (!month) continue;
    const v = y * 12 + month;
    if (best == null || v < best) best = v;
  }
  return best;
}

function returnToSchool(t) {
  let m = RETURN_RE.exec(t);
  if (m) return around(t, m, 30, 80);
  m = REMAINING.exec(t);
  if (m) return around(t, m, 30, 20);
  // A graduation window that starts after June 2027 ("graduating between December 2027 and June 2028", "Class of 2028").
  for (const sentence of t.split(/(?<=[a-z0-9)\]][.!?])\s*(?=[A-Z(*])|\n+|;\s*|•|<[^>]+>|\s\*\s/)) {
    const g = GRAD_SENTENCE.exec(sentence);
    if (!g) continue;
    // Only the dates near the graduation words, not the internship's own dates later on.
    const near = sentence.slice(Math.max(0, g.index - 40), g.index + 160);
    const earliest = earliestGraduation(near);
    if (earliest != null && earliest > USER_GRAD) return clip(near);
  }
  return null;
}

/** First match of any pattern, or null. */
function first(patterns, t) {
  for (const re of patterns) { const m = re.exec(t); if (m) return m; }
  return null;
}

/**
 * The eligibility verdict for one role. `text` is the job description (may be
 * empty: then only the title is read). `roleType` 'intern' | 'new_grad'.
 */
export function eligibilityFor({ title = '', text = '', quote = '', roleType = '' } = {}) {
  // The sponsorship check sometimes kept only the quote it read ("Must be a U.S. Citizen …").
  const t = [text, quote].filter(Boolean).join('\n');
  const ti = String(title || '');
  const flags = [];

  // Citizenship.
  const c = first(CITIZENSHIP, t);
  if (c) {
    const window = t.slice(c.index, c.index + c[0].length + 250);
    if (STUDENTS_WELCOME.test(window)) flags.push(`Takes students with work authorization: “${around(t, c, 0, 120)}”`);
    else return { reason: 'citizenship', phrase: around(t, c, 0, 60) };
  } else {
    const soft = CITIZENSHIP_SOFT.exec(t);
    if (soft) flags.push(`Mentions export control: “${around(t, soft, 80, 80)}”`);
  }

  // Clearance (unless the posting says none is needed).
  const k = CLEARANCE.exec(t);
  if (k && !NO_CLEARANCE.test(t)) {
    // "preferred" only counts in the same sentence, not in the "Preferred Qualifications" heading after it.
    const tail = t.slice(k.index, k.index + k[0].length + 60).split(/[.\n#]|\*\*/)[0];
    if (NOT_REQUIRED.test(tail)) flags.push(`Clearance preferred: “${around(t, k, 0, 50)}”`);
    else return { reason: 'clearance', phrase: around(t, k, 0, 40) };
  } else if (!NO_CLEARANCE.test(t)) {
    const soft = CLEARANCE_SOFT.exec(t);
    if (soft) flags.push(`Mentions a clearance: “${around(t, soft, 80, 60)}”`);
  }

  // MBA and PhD: only when no Master's option is mentioned anywhere.
  const masters = mastersOption(ti, t);

  // MBA: an MBA intern by title, or the posting requires one.
  if (!masters && MBA_TITLE.test(ti) && !/\b(?:or|preferred)\b|mba\s*\/|\/\s*mba/i.test(ti)) return { reason: 'mba', phrase: `Title: ${clip(ti)}` };
  const mba = masters ? null : MBA_REQUIRED.exec(t);
  if (mba) {
    const span = t.slice(Math.max(0, mba.index - 60), mba.index + mba[0].length);
    if (NOT_REQUIRED.test(mba[0]) || MBA_OR.test(span)) {
      flags.push(`Mentions an MBA: “${around(t, mba, 0, 0)}”`);
    } else return { reason: 'mba', phrase: around(t, mba, 0, 0) };
  }

  // PhD: a PhD title that names no other degree, or the posting requires one.
  if (!masters && PHD_TITLE.test(ti) && !OTHER_DEGREE.test(ti)) return { reason: 'phd', phrase: `Title: ${clip(ti)}` };
  const p = masters ? null : first(PHD_REQUIRED, t);
  if (p) {
    const span = t.slice(Math.max(0, p.index - 60), p.index + p[0].length);
    if (NOT_REQUIRED.test(p[0]) || OR_ALTERNATIVE.test(span)) flags.push(`Mentions a PhD: “${around(t, p, 0, 0)}”`);
    else return { reason: 'phd', phrase: around(t, p, 0, 0) };
  }

  // Return to school: internships only.
  if (roleType === 'intern') {
    const r = returnToSchool(t);
    if (r) return { reason: 'return_to_school', phrase: r };
  }

  return flags.length ? { flag: flags[0].slice(0, 300) } : null;
}
