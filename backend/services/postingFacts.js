// What a job description says that decides when (and whether) to apply:
// the application deadline it states, and whether an internship wants
// students who return to school afterwards. Pure functions, no I/O.
import { wantsReturningStudents } from './gradYear.js';

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONTH = String.raw`(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?`;
// "November 15, 2026" / "Nov. 15th" / "15 November 2026" / "11/15/2026" / "2026-11-15"
const DATE = String.raw`(?:${MONTH}\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?|(\d{1,2})(?:st|nd|rd|th)?\s+${MONTH}(?:,?\s+(\d{4}))?|(\d{1,2})/(\d{1,2})/(\d{2,4})|(\d{4})-(\d{2})-(\d{2}))`;
// The words that make a date a deadline, then the date within a few words.
const CUE = String.raw`(?:deadline(?:\s+to\s+apply)?|apply\s+(?:by|before|no\s+later\s+than)|applications?\s+(?:are\s+|will\s+be\s+)?(?:due|accepted\s+(?:until|through)|close[sd]?|closing|must\s+be\s+(?:received|submitted)\s+by)|closing\s+date|posting\s+(?:close[sd]?|closes|end\s+date|expires?|expiration\s+date)|(?:job\s+)?posting\s+will\s+(?:close|be\s+removed|expire)|accepting\s+applications\s+(?:until|through)|open\s+until|(?:will\s+)?close[sd]?\s+on)`;
const DEADLINE = new RegExp(`${CUE}[^.\\n]{0,40}?${DATE}`, 'gi');

const pad = (n) => String(n).padStart(2, '0');

function toDate(year, month, day, base) {
  if (!(month >= 1 && month <= 12 && day >= 1 && day <= 31)) return null;
  let y = year;
  if (!y) {
    // No year: the next time that day comes round after the posting went up.
    y = base.getUTCFullYear();
    if (Date.UTC(y, month - 1, day) < Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate()) - 31 * 86400_000) y += 1;
  } else if (y < 100) y += 2000;
  const d = new Date(Date.UTC(y, month - 1, day));
  if (d.getUTCMonth() !== month - 1) return null; // Feb 30
  return `${y}-${pad(month)}-${pad(day)}`;
}

/**
 * The application deadline a job description states, as 'YYYY-MM-DD', or
 * null. Only a date tied to deadline words counts ("Apply by November 15",
 * "Applications close 11/20/2026"), never a start date. A date without a year
 * is the next one after `posted`. The earliest stated deadline wins.
 */
export function deadlineFrom(text, { posted = new Date() } = {}) {
  const base = posted instanceof Date && !Number.isNaN(posted.getTime()) ? posted : new Date(posted || Date.now());
  const found = [];
  for (const m of String(text || '').matchAll(DEADLINE)) {
    const [, mon1, day1, year1, day2, mon2, year2, mm, dd, yy, iy, im, id] = m;
    let d = null;
    if (mon1) d = toDate(Number(year1) || null, MONTHS.indexOf(mon1.slice(0, 3).toLowerCase()) + 1, Number(day1), base);
    else if (mon2) d = toDate(Number(year2) || null, MONTHS.indexOf(mon2.slice(0, 3).toLowerCase()) + 1, Number(day2), base);
    else if (mm) d = toDate(Number(yy), Number(mm), Number(dd), base); // US order
    else if (iy) d = toDate(Number(iy), Number(im), Number(id), base);
    if (d) found.push(d);
  }
  return found.sort()[0] || null;
}

/** Both facts at once, for a role's posting text. */
export function postingFacts(text, { roleType, posted } = {}) {
  return {
    deadline: deadlineFrom(text, { posted }),
    returnToSchool: roleType === 'intern' && wantsReturningStudents(text),
  };
}

// A posting only a U.S. person can take: citizenship, a green card, U.S.
// persons under ITAR/EAR export control, or a security clearance. EEO lines
// ("without regard to … citizenship status") don't count.
const US = String.raw`(?:u\.?\s?s\.?|united states)`;
const US_ONLY = [
  new RegExp(String.raw`\b(?:must|required to|need to|needs to|have to)\s+(?:be|hold|possess|have)\s+(?:an?\s+)?(?:active\s+)?${US}\s+(?:citizen(?:ship)?|persons?|national)`, 'i'),
  new RegExp(String.raw`\b(?:must|required to|need to)\s+be\s+(?:an?\s+)?(?:${US}\s+)?(?:citizen|permanent resident|lawful permanent resident|green card holder)s?\b`, 'i'),
  new RegExp(String.raw`\b${US}\s+citizenship\s+(?:is\s+)?(?:required|needed|mandatory)`, 'i'),
  new RegExp(String.raw`\b(?:requires?|requiring|required:?)\s+(?:active\s+|current\s+)?${US}\s+(?:citizenship|citizens?|persons?)`, 'i'),
  new RegExp(String.raw`\b${US}\s+(?:citizens?|persons?)\s+only\b`, 'i'),
  new RegExp(String.raw`\bonly\s+${US}\s+(?:citizens?|persons?)\b`, 'i'),
  new RegExp(String.raw`\b(?:citizens?|persons?)\s+of\s+the\s+united states\s+(?:only|required)\b`, 'i'),
  // Export control with U.S. persons as the bar.
  new RegExp(String.raw`\b(?:itar|ear|export[-\s]control(?:led)?|export administration regulations|international traffic in arms)\b[^.]{0,250}\b${US}\s+persons?\b|\b${US}\s+persons?\b[^.]{0,250}\b(?:itar|export[-\s]control(?:led)?|international traffic in arms)\b`, 'i'),
  // A clearance the role needs (not "no clearance required").
  /\b(?:active|current|interim|ability to obtain|able to obtain|eligib\w+ (?:to|for) (?:obtain\w*)?(?: and maintain)?|must (?:obtain|hold|have|possess)|requires?|obtain and maintain)\s+(?:an?\s+)?(?:active\s+|interim\s+)?(?:dod\s+|government\s+|federal\s+|u\.?s\.?\s+government\s+)?(?:secret|top secret|ts\/sci|ts|security|public trust)\s+clearance\b/i,
];

// "…or be an MS student with work authorization (F1 Visa on CPT accepted)": the bar has a door for students.
const STUDENTS_WELCOME = /\b(?:f-?1|cpt|opt|stem opt)\b[^.]{0,80}\b(?:accepted|eligible|welcome|considered)\b|\bstudents?\s+with\s+(?:valid\s+)?work authorization\b|\bor\s+(?:be\s+)?(?:otherwise\s+)?(?:authorized|eligible)\s+to\s+work\b/i;

/** The phrase that makes a posting U.S.-persons-only, or null. Pure. */
export function usPersonOnly(text) {
  const t = String(text || '');
  for (const re of US_ONLY) {
    const m = re.exec(t);
    if (!m) continue;
    if (STUDENTS_WELCOME.test(t.slice(m.index, m.index + m[0].length + 250))) continue;
    return m[0].replace(/\s+/g, ' ').slice(0, 160);
  }
  return null;
}

/** A run's eligibility flag that says the same (citizenship, U.S. person, export control, clearance). */
export const US_PERSON_FLAG = /\b(?:u\.?s\.? citizen|citizenship|u\.?s\.? persons?|itar|export control|clearance|green card)\b/i;

/** Students on F-1/CPT/OPT (or anyone with work authorization) can take it after all. */
export const studentsWelcome = (text) => STUDENTS_WELCOME.test(String(text || ''));
