/**
 * ats.js — the ATS score, computed in code (no AI), the way keyword-matching
 * applicant tracking systems read a resume:
 *
 *   score = 85% keyword coverage + 15% format checks
 *
 * Keywords come from the job description (extracted by a different model
 * than the one that writes the resume, so the writer can't grade itself).
 * Required hard skills weigh 3, preferred 1.5; soft skills count half.
 * Matching runs on the text pulled back out of the final PDF — what an ATS
 * actually sees — not on the document the AI produced.
 */

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function normalizeText(s) {
  return String(s ?? '')
    .toLowerCase()
    .replace(/[‐-―−]/g, '-')
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, ' ');
}

// Words an ATS (and a recruiter) reads as the same thing.
const EQUIVALENT = [
  [/\brestful\b/g, 'rest'], [/\bci\/cd\b/g, 'ci cd'], [/\bpostgres\b/g, 'postgresql'], [/\bk8s\b/g, 'kubernetes'],
  [/\bgcp\b/g, 'google cloud'], [/\bllms\b/g, 'llm'], [/\bapis\b/g, 'api'],
  [/\bcontinuous integration( (and|&|\/) continuous (delivery|deployment))?\b/g, 'ci cd'],
];

/** One spelling per skill, for counting the same skill once ("CI/CD" = "Continuous Integration"). */
export function canonicalTerm(term) {
  return EQUIVALENT.reduce((s, [re, to]) => s.replace(re, to), normalizeText(term).trim()).replace(/[^a-z0-9+#]+/g, ' ').trim();
}

/** Spellings of one term an ATS treats as the same: "Node.js" ≈ "nodejs" ≈ "node js", "RESTful API" ≈ "REST APIs". */
export function variants(term) {
  const t0 = normalizeText(term).trim();
  if (!t0) return [];
  const t = EQUIVALENT.reduce((s, [re, to]) => s.replace(re, to), t0);
  // A plural in the job matches the singular on the resume ("Modern Data Platforms" ≈ "modern data platform").
  const singular = /[a-z]{3}s$/.test(t) && !/(ss|us|is)$/.test(t) ? t.replace(/s$/, '') : null;
  const out = new Set([t0, t, ...(singular ? [singular] : []), t.replace(/-/g, ' '), t.replace(/[-\s]+/g, ''), t.replace(/\.(?=[a-z])/g, ''), t.replace(/\.(?=[a-z])/g, ' ')]);
  return [...out].map(v => v.replace(/\s+/g, ' ').trim()).filter(Boolean);
}

function termRegex(v) {
  // Letters/digits/+/# continue a token ("c" must not match "c++" or "cloud").
  const plural = /[a-z]$/.test(v) && v.length > 3 ? '(?:s|es)?' : '';
  return new RegExp(`(?<![a-z0-9+#])${escapeRe(v)}${plural}(?![a-z0-9+#])`);
}

/** Does the text contain this keyword (or one of its aliases)? */
export function hasTerm(text, keyword) {
  const hay = EQUIVALENT.reduce((s, [re, to]) => s.replace(re, to), normalizeText(text));
  const hayLoose = hay.replace(/-/g, ' ').replace(/\.(?=[a-z])/g, '');
  const terms = [keyword.term, ...(keyword.aliases || [])];
  return terms.some(t => variants(t).some(v => {
    const re = termRegex(v);
    return re.test(hay) || re.test(hayLoose);
  }));
}

export function weightOf(k) {
  return (k.importance === 'required' ? 3 : 1.5) * (k.kind === 'soft' ? 0.5 : 1);
}

/** Clean up the extractor's list: drop blanks and duplicates, cap at 30. */
export function normalizeKeywords(list) {
  const seen = new Set();
  const out = [];
  for (const k of Array.isArray(list) ? list : []) {
    const term = String(k?.term || '').trim();
    const key = normalizeText(term).replace(/[^a-z0-9+#]/g, '');
    if (!term || term.length > 60 || !key || seen.has(key)) continue;
    seen.add(key);
    out.push({
      term,
      aliases: (Array.isArray(k.aliases) ? k.aliases : []).map(a => String(a).trim()).filter(a => a && a.length <= 60).slice(0, 5),
      importance: k.importance === 'required' ? 'required' : 'preferred',
      kind: k.kind === 'soft' ? 'soft' : 'hard',
      // A named tool/language/framework/platform (bolded where a bullet uses it).
      tool: k.kind !== 'soft' && k.tool !== false,
    });
    if (out.length >= 30) break;
  }
  return out;
}

export function keywordCoverage(keywords, text) {
  const matched = [];
  const missing = [];
  let got = 0;
  let total = 0;
  for (const k of keywords) {
    const w = weightOf(k);
    total += w;
    if (hasTerm(text, k)) { matched.push(k); got += w; } else missing.push(k);
  }
  return { coverage: total ? got / total : 1, matched, missing };
}

/** Format checks an ATS (or a recruiter skimming the parsed text) cares about. */
export function formatChecks(doc, { pages, pdfText }) {
  const text = normalizeText(pdfText);
  const c = doc.contact || {};
  const allBullets = [...(doc.experience || []), ...(doc.projects || [])].flatMap(e => e.bullets || []);
  return [
    { id: 'email', label: 'Email address on the page', ok: Boolean(c.email) && text.includes(normalizeText(c.email)) },
    { id: 'phone', label: 'Phone number on the page', ok: Boolean(String(c.phone || '').replace(/\D/g, '').length >= 7) },
    { id: 'sections', label: 'Standard sections (Education, Experience or Projects, Skills)', ok: Boolean(doc.education?.length && (doc.experience?.length || doc.projects?.length) && doc.skills?.length) },
    { id: 'one_page', label: 'Fits on one page', ok: pages === 1 },
    { id: 'parseable', label: 'Text reads back cleanly from the PDF', ok: Boolean(doc.name) && text.includes(normalizeText(doc.name)) && text.length > 400 },
    { id: 'dates', label: 'Every role has dates', ok: (doc.experience || []).every(e => e.start || e.end) },
    // ~121 characters a line on the template; a 3rd line only when it's 80% full.
    { id: 'bullets', label: 'Bullets are one or two lines', ok: allBullets.length > 0 && allBullets.every(b => { const n = String(b).length; return n <= 242 || (n >= 339 && n <= 363); }) },
  ];
}

export function atsScore({ keywords, pdfText, doc, pages }) {
  const cov = keywordCoverage(keywords, pdfText);
  const checks = formatChecks(doc, { pages, pdfText });
  const passed = checks.filter(c => c.ok).length;
  const score = Math.round(100 * (0.85 * cov.coverage + 0.15 * (checks.length ? passed / checks.length : 1)));
  return { score, coverage: Math.round(cov.coverage * 100), matched: cov.matched, missing: cov.missing, checks };
}

/**
 * Missing keywords split by whether the candidate has them anywhere (master
 * resume, GitHub): "on you" ones the engine should have used; the rest the
 * candidate simply doesn't show, and are never added.
 */
export function splitMissing(missing, sourceText) {
  const inSource = [];
  const notInSource = [];
  for (const k of missing) (hasTerm(sourceText, k) ? inSource : notInSource).push(k);
  return { inSource, notInSource };
}

// The user's rule: a resume goes out only when its ATS match is above 90%.
export const ATS_TARGET = 90;
export const atsPasses = (score) => Number(score) > ATS_TARGET;
export const CALLBACK_TARGET = 20;

/**
 * Put a project to build on the page? Yes when Opus asked for it and the page
 * with it still passes the ATS rule, or scores at least as well as without it.
 * A project that pushes other keywords off the page and drops a passing resume
 * under the bar stays a suggestion beside it.
 */
export function keepProjectOnPage(withoutScore, withScore) {
  if (withScore == null) return false;
  return atsPasses(withScore) || withScore >= withoutScore;
}
