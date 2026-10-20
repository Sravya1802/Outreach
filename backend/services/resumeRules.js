/**
 * resumeRules.js — the user's resume rules that code can check or apply
 * without an AI, run on every tailored draft after the fact check:
 *
 *   • no em dashes, triple dashes, "responsible for" or "helped"
 *   • bullets are 1–2 lines; a 3rd line only when it's at least 80% full
 *   • no two bullets in a row start with the same verb
 *   • every entry in a section has the same number of bullets
 *   • latency/throughput numbers only for quant, HFT or C++ roles; for any
 *     other role, project bullets carry no metrics at all
 *   • sections: Education, Research, Industry, Projects, Skills, the rest;
 *     Industry goes above Research for quant/C++ roles
 *   • projects newest first; at most 6 skill groups of 8, most relevant first
 *   • Bloomberg Market Concepts (and other finance certifications) first for
 *     finance roles, last otherwise
 *   • bold only metrics and the job's own tools
 *
 * Line lengths come from the template: a bullet line holds about 121
 * characters (measured on the 10pt template with 0.4in margins).
 */

import { hasTerm, weightOf, canonicalTerm } from './ats.js';

export const CHARS_PER_LINE = 121;
export const MAX_SKILL_GROUPS = 6;
export const MAX_SKILL_ITEMS = 8;

const str = (v) => String(v ?? '').trim();
const list = (v) => (Array.isArray(v) ? v : []);

// ── What kind of role is this? ─────────────────────────────────────────────

const QUANT_TITLE = /\b(quant\w*|hft|high[- ]frequency|low[- ]latency|market[- ]mak\w*|trading|trader|c\+\+)(?![\w+])/i;
const QUANT_JD = /\b(high[- ]frequency|hft|low[- ]latency|market[- ]mak\w*|order book|matching engine|nanosecond|microsecond)\b/i;
const FINANCE = /\b(bank\w*|financ\w*|fintech|trading|investment\w*|asset management|capital markets|hedge fund|securities|brokerage|wealth|quant\w*)\b/i;

/** { quant, finance } from the job's title, company and description. */
export function roleKind({ title = '', company = '', description = '' } = {}) {
  const jd = String(description);
  const cpp = (jd.match(/c\+\+/gi) || []).length;
  const quant = QUANT_TITLE.test(title) || QUANT_JD.test(jd) || cpp >= 3;
  const finance = quant || FINANCE.test(`${title} ${company}`) || (jd.match(new RegExp(FINANCE.source, 'gi')) || []).length >= 3;
  return { quant, finance };
}

// ── Metrics ────────────────────────────────────────────────────────────────

const METRIC = /(?<![\w.+\-/])(\$?\d+(?:[.,]\d+)*)(\s?(?:%|x\b|ns\b|µs\b|us\b|ms\b|[KMGT]B\b|[Kk]\b|M\b|B\b))?(\+)?(?![\w.]*[A-Za-z])/g;

/**
 * Spans of real metrics in a sentence: "82.5%", "500GB+", "20+", "36K+",
 * "83ns", "$12K", "32 test cases". Versions and names are not metrics:
 * "C++17", "GPT-4", "Next.js 15", "Llama 3.3 70B", "Hacks 2026".
 */
export function metricSpans(s) {
  const text = String(s ?? '');
  const out = [];
  for (const m of text.matchAll(METRIC)) {
    const [whole, num, unit = '', plus = ''] = m;
    const start = m.index;
    const before = text.slice(0, start);
    const prevWord = (before.match(/(\S+)\s*$/) || [])[1] || '';
    const after = text.slice(start + whole.length);
    const isYear = /^(19|20)\d\d$/.test(num) && !unit && !plus;
    if (isYear) continue;
    const u = unit.trim();
    // %, +, x, ns/ms, GB… or a $ amount is always a metric. A bare number (or K/M/B)
    // right after a capitalized name mid-sentence, or after another number, is a
    // version or a model size: "Llama 3.3 70B", "Next.js 15", "Python 3".
    const strong = Boolean(plus) || num.startsWith('$') || /^(%|x|ns|µs|us|ms|[KMGT]B)$/.test(u);
    if (!strong) {
      const midSentence = before.trim().length > prevWord.length;
      if (/^[A-Z]/.test(prevWord) && midSentence) continue;
      if (/^[\d.]+$/.test(prevWord.replace(/[,;]$/, ''))) continue;
    }
    if (/^[KkMB]$/.test(u) && !plus && !/^\s+[a-z]/.test(after)) continue; // "70B," (model size) vs "2M records"
    if (!u && !plus && !num.startsWith('$') && !/^\s+[A-Za-z]/.test(after)) continue; // a bare number needs a noun after it
    out.push({ start, end: start + whole.length, text: whole });
  }
  return out;
}

export const hasMetric = (s) => metricSpans(s).length > 0;

// ── Bullet checks ──────────────────────────────────────────────────────────

const DASH = /\s*(?:—|―|---|\s--\s|\s–\s)\s*/g;
const FILLER = /\b(responsible for|helped|helping|assisted in)\b/i;

/** Em dashes, triple dashes and spaced en dashes → commas. */
export function fixDashes(s) {
  return str(s).replace(DASH, ', ').replace(/,\s*,/g, ',').replace(/\s+,/g, ',').replace(/,\s*\.$/, '.');
}

export function bulletLines(s) {
  return Math.max(1, Math.ceil(str(s).length / CHARS_PER_LINE));
}

/** Problems with one bullet, as short codes with a reason. */
export function bulletIssues(s) {
  const b = str(s);
  const issues = [];
  if (/—|―|---/.test(b)) issues.push({ code: 'dash', why: 'uses an em dash or triple dash' });
  if (FILLER.test(b)) issues.push({ code: 'filler', why: `says “${b.match(FILLER)[1]}”` });
  const lines = bulletLines(b);
  const fill = (b.length - (lines - 1) * CHARS_PER_LINE) / CHARS_PER_LINE;
  if (lines > 3) issues.push({ code: 'length', why: `runs to ${lines} lines (keep it to 2)` });
  else if (lines === 3 && fill < 0.8) issues.push({ code: 'length', why: 'spills a short third line (cut it to 2 lines, or fill the third)' });
  return issues;
}

export const firstVerb = (s) => (str(s).match(/^[A-Za-z]+/) || [''])[0].toLowerCase();

// ── Sections ───────────────────────────────────────────────────────────────

const RESEARCH = /research|lab\b|laborator/i;
const INDUSTRY = /industry|professional|work|employment/i;

/** The heading an experience entry sits under on the master ("Experience" when unknown). */
export const sectionOf = (e) => str(e.section) || 'Experience';

/**
 * Experience grouped by section, in the order the rules want: Research before
 * Industry, except quant/C++ roles where Industry leads. Other headings keep
 * the master's order after those two.
 */
export function experienceSections(experience, { quant = false } = {}) {
  const groups = [];
  for (const e of list(experience)) {
    const heading = sectionOf(e);
    let g = groups.find(x => x.heading.toLowerCase() === heading.toLowerCase());
    if (!g) groups.push(g = { heading, entries: [] });
    g.entries.push(e);
  }
  const rank = (g) => {
    if (RESEARCH.test(g.heading)) return quant ? 1 : 0;
    if (INDUSTRY.test(g.heading) || /^experience$/i.test(g.heading)) return quant ? 0 : 1;
    return 2;
  };
  return groups.map((g, i) => ({ g, i })).sort((a, b) => rank(a.g) - rank(b.g) || a.i - b.i).map(x => x.g);
}

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };

/** "Jun 2026" → 2026.06; "2025" → 2025.00; "Present" → Infinity; unknown → null. */
export function dateValue(s) {
  const t = str(s).toLowerCase();
  if (!t) return null;
  if (/present|current|now|ongoing/.test(t)) return Infinity;
  const y = t.match(/(19|20)\d\d/);
  if (!y) return null;
  const m = t.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*/);
  return Number(y[0]) + (m ? MONTHS[m[1]] / 100 : 0);
}

/** Newest first by end date, then start date. Undated entries stay on top. */
export function sortNewestFirst(entries) {
  const key = (e) => dateValue(e.end) ?? dateValue(e.start) ?? Infinity;
  const startKey = (e) => dateValue(e.start) ?? key(e);
  return list(entries).map((e, i) => ({ e, i }))
    .sort((a, b) => key(b.e) - key(a.e) || startKey(b.e) - startKey(a.e) || a.i - b.i)
    .map(x => x.e);
}

/** How strongly one skill group matches the job (weighted keyword hits). */
function groupWeight(g, keywords) {
  return keywords.reduce((s, k) => s + (list(g.items).some(it => hasTerm(it, k)) || hasTerm(g.category, k) ? weightOf(k) : 0), 0);
}

/** Most relevant groups first, at most 6 groups of 8; the job's items lead inside a group. */
export function orderSkills(skills, keywords = []) {
  const groups = list(skills).map((g, i) => ({ g, i, w: groupWeight(g, keywords) }))
    .sort((a, b) => b.w - a.w || a.i - b.i)
    .map(({ g }) => {
      const items = list(g.items).map((it, i) => ({ it, i, hit: keywords.some(k => hasTerm(it, k)) }))
        .sort((a, b) => Number(b.hit) - Number(a.hit) || a.i - b.i).map(x => x.it);
      return { ...g, items: items.slice(0, MAX_SKILL_ITEMS) };
    })
    .filter(g => g.items.length);
  return groups.slice(0, MAX_SKILL_GROUPS);
}

const FINANCE_CERT = /bloomberg|cfa\b|frm\b|series \d|financ|market concepts|quant/i;
export const isCertifications = (x) => /certif/i.test(str(x.heading));

/** Finance certifications first for finance roles, last for everything else. */
export function orderCertifications(extras, { finance = false } = {}) {
  return list(extras).map(x => {
    if (!isCertifications(x)) return x;
    const fin = list(x.items).filter(it => FINANCE_CERT.test(it));
    const rest = list(x.items).filter(it => !FINANCE_CERT.test(it));
    return { ...x, items: finance ? [...fin, ...rest] : [...rest, ...fin] };
  });
}

// ── Whole-document passes ──────────────────────────────────────────────────

/**
 * Make every entry in a section carry the same number of bullets. Entries
 * that can't reach 2 while the others can are dropped (a one-line internship
 * shouldn't cut the main job to one bullet); the rest are trimmed to the
 * shortest. Returns the entries and what was dropped or trimmed.
 */
export function equalizeBullets(entries, where) {
  const removed = [];
  let xs = list(entries).filter(e => list(e.bullets).length);
  if (xs.length > 1 && xs.some(e => e.bullets.length >= 2)) {
    for (const e of xs.filter(e => e.bullets.length < 2 && !e.keep)) removed.push({ where, what: e.title ? `${e.title} at ${e.company}` : e.name, why: 'had one bullet while the others in the section have more; every entry in a section gets the same number' });
    xs = xs.filter(e => e.bullets.length >= 2 || e.keep);
  }
  const n = Math.min(...xs.map(e => e.bullets.length));
  xs = xs.map(e => {
    if (e.bullets.length <= n) return e;
    for (const b of e.bullets.slice(n)) removed.push({ where: e.title ? `${e.title} at ${e.company}` : e.name, what: b, why: `trimmed so every entry in the section has ${n} bullet${n === 1 ? '' : 's'}` });
    return { ...e, bullets: e.bullets.slice(0, n) };
  });
  return { entries: xs, removed };
}

/** Swap the start of a bullet whose verb repeats the one before it, when a synonym fits. */
const SYNONYMS = {
  built: ['Developed', 'Engineered', 'Implemented'], developed: ['Built', 'Engineered', 'Created'], designed: ['Architected', 'Planned'],
  created: ['Built', 'Produced'], implemented: ['Built', 'Engineered'], analyzed: ['Evaluated', 'Examined'], led: ['Drove', 'Directed'],
  conducted: ['Ran', 'Carried out'], build: ['Develop', 'Engineer'], develop: ['Build', 'Engineer'], design: ['Architect', 'Plan'],
  conduct: ['Run', 'Carry out'], evaluated: ['Assessed', 'Benchmarked'], optimized: ['Tuned', 'Streamlined'], automated: ['Scripted', 'Streamlined'],
};

export function varyVerbs(bullets) {
  const out = [];
  for (const b of list(bullets)) {
    const v = firstVerb(b);
    const prev = out.length ? firstVerb(out[out.length - 1]) : '';
    if (v && v === prev && SYNONYMS[v]) {
      const used = new Set(out.map(firstVerb));
      const alt = SYNONYMS[v].find(s => !used.has(s.toLowerCase())) || SYNONYMS[v][0];
      out.push(alt + str(b).slice(v.length));
    } else out.push(str(b));
  }
  return out;
}

/** Bullets a rule says must go: metrics in project bullets for non-quant roles. */
export function projectMetricsAllowed({ quant }) {
  return Boolean(quant);
}

/**
 * Apply every fixable rule to a guarded doc. Returns the doc and a list of
 * what was changed or removed, for the change report.
 */
export function applyRules(doc, { keywords = [], kind = { quant: false, finance: false } } = {}) {
  const removed = [];
  const fixed = [];
  const clean = (b) => {
    const f = fixDashes(b);
    if (f !== str(b)) fixed.push({ what: str(b), now: f, why: 'em dash replaced with a comma' });
    return f;
  };

  // Experience: clean, vary verbs, then equal bullets per section.
  const sections = experienceSections(doc.experience, kind);
  const experience = [];
  for (const s of sections) {
    const cleaned = s.entries.map(e => ({ ...e, bullets: varyVerbs(list(e.bullets).map(clean)) }));
    const eq = equalizeBullets(cleaned, s.heading);
    removed.push(...eq.removed);
    experience.push(...eq.entries.map(e => ({ ...e, section: s.heading })));
  }

  // Projects: no metrics unless the role is quant/HFT/C++, newest first, equal bullets.
  let projects = list(doc.projects).map(p => {
    let bullets = varyVerbs(list(p.bullets).map(clean));
    if (!projectMetricsAllowed(kind)) {
      const kept = bullets.filter(b => !hasMetric(b));
      for (const b of bullets.filter(hasMetric)) removed.push({ where: p.name, what: b, why: 'numbers in project bullets are only for quant, HFT or C++ roles' });
      bullets = kept;
    }
    return { ...p, bullets };
  }).filter(p => {
    if (p.bullets.length) return true;
    removed.push({ where: 'Projects', what: p.name, why: 'every bullet had numbers, which project bullets leave out for this kind of role' });
    return false;
  });
  projects = sortNewestFirst(projects);
  const eqp = equalizeBullets(projects, 'Projects');
  removed.push(...eqp.removed);
  projects = eqp.entries;

  return {
    doc: {
      ...doc,
      summary: doc.summary ? fixDashes(doc.summary) : '',
      experience,
      projects,
      skills: orderSkills(doc.skills, keywords),
      extras: orderCertifications(doc.extras, kind),
    },
    removed,
    fixed,
  };
}

/** Rule problems left in a finished doc (what the revision pass is asked to fix). */
export function lintDoc(doc, { kind = { quant: false } } = {}) {
  const issues = [];
  const entries = [
    ...list(doc.experience).map(e => ({ where: `${e.title} at ${e.company}`, section: sectionOf(e), bullets: list(e.bullets) })),
    ...list(doc.projects).map(p => ({ where: p.name, section: 'Projects', bullets: list(p.bullets) })),
  ];
  for (const e of entries) {
    e.bullets.forEach((b, i) => {
      for (const x of bulletIssues(b)) issues.push({ where: e.where, bullet: b, code: x.code, why: x.why });
      if (i > 0 && firstVerb(b) && firstVerb(b) === firstVerb(e.bullets[i - 1])) issues.push({ where: e.where, bullet: b, code: 'verb', why: `starts with “${firstVerb(b)}” like the bullet before it` });
    });
  }
  const bySection = new Map();
  for (const e of entries) bySection.set(e.section, [...(bySection.get(e.section) || []), e.bullets.length]);
  for (const [section, counts] of bySection) {
    if (new Set(counts).size > 1) issues.push({ where: section, bullet: '', code: 'count', why: `entries have ${counts.join('/')} bullets; they should match` });
  }
  if (!kind.quant) {
    for (const p of list(doc.projects)) for (const b of list(p.bullets)) if (hasMetric(b)) issues.push({ where: p.name, bullet: b, code: 'metric', why: 'project bullets carry no numbers for this kind of role' });
  }
  return issues;
}

/**
 * Terms to bold in bullets: the job's own tools that the bullet uses. Metrics
 * are bolded separately (experience always, projects only for quant roles).
 */
export function boldTools(keywords) {
  return list(keywords).filter(k => k.kind !== 'soft' && k.tool !== false).flatMap(k => [k.term, ...list(k.aliases)]).filter(t => str(t).length >= 2);
}

/** Which sections of the finished doc carry each keyword (the keywords table). */
export function keywordPlaces(doc, keywords) {
  const places = [];
  if (str(doc.summary)) places.push({ name: 'Summary', text: doc.summary });
  for (const s of experienceSections(doc.experience)) places.push({ name: s.heading, text: s.entries.flatMap(e => [e.title, ...list(e.bullets)]).join('\n') });
  if (list(doc.projects).length) places.push({ name: 'Projects', text: doc.projects.flatMap(p => [p.name, list(p.tech).join(', '), ...list(p.bullets)]).join('\n') });
  if (list(doc.skills).length) places.push({ name: 'Technical Skills', text: doc.skills.flatMap(g => [g.category, ...list(g.items)]).join('\n') });
  if (list(doc.education).length) places.push({ name: 'Education', text: doc.education.flatMap(e => [e.degree, e.field, ...list(e.details)]).join('\n') });
  for (const x of list(doc.extras)) places.push({ name: str(x.heading), text: list(x.items).join('\n') });
  return list(keywords).map(k => ({ term: k.term, importance: k.importance, where: places.filter(p => hasTerm(p.text, k)).map(p => p.name) }));
}

// ── The change report, computed (no AI) ────────────────────────────────────

const words = (s) => new Set(str(s).toLowerCase().match(/[a-z0-9+#.]+/g) || []);
function similarity(a, b) {
  const A = words(a);
  const B = words(b);
  if (!A.size || !B.size) return 0;
  let both = 0;
  for (const w of A) if (B.has(w)) both += 1;
  return both / (A.size + B.size - both);
}

/** The job keywords a new line carries that the old one didn't. */
function why(before, after, keywords) {
  const added = list(keywords).filter(k => hasTerm(after, k) && !hasTerm(before, k)).map(k => k.term);
  return added.length ? `Adds ${added.slice(0, 5).join(', ')}` : before ? 'Reworded toward the job' : 'New line for the job';
}

/** Bullet-level changes inside one entry: each new bullet against its closest original. */
function bulletChanges(section, original, final, keywords) {
  const out = [];
  for (const b of list(final)) {
    if (list(original).some(o => str(o) === str(b))) continue;
    let best = '';
    let score = 0;
    for (const o of list(original)) {
      const s = similarity(o, b);
      if (s > score) { score = s; best = o; }
    }
    const before = score >= 0.2 ? str(best) : '';
    out.push({ section, before, after: str(b), why: why(before, b, keywords) });
  }
  return out;
}

/**
 * Every change between the master resume and the tailored one, the way the
 * user's rules ask ("flag every change, no silent edits"), worked out by
 * comparing the two documents. `why` names the job keywords a change adds.
 */
export function diffChanges(master, doc, keywords = [], projectWhy = {}) {
  const changes = [];
  if (str(doc.summary) && str(doc.summary) !== str(master.summary)) {
    changes.push({ section: 'Summary', before: str(master.summary), after: str(doc.summary), why: why(master.summary, doc.summary, keywords) });
  }
  const byId = new Map(list(master.experience).map(e => [str(e.id), e]));
  for (const e of list(doc.experience)) {
    const m = byId.get(str(e.id));
    if (m) changes.push(...bulletChanges(`${e.title} at ${e.company}`, m.bullets, e.bullets, keywords));
  }
  const norm = (s) => str(s).toLowerCase().replace(/[^a-z0-9]/g, '');
  const masterProjects = list(master.projects);
  for (const p of list(doc.projects)) {
    const m = masterProjects.find(x => (p.source === 'resume' && str(x.id) === str(p.ref)) || norm(x.name) === norm(p.name));
    if (m) changes.push(...bulletChanges(p.name, m.bullets, p.bullets, keywords));
    else changes.push({ section: 'Projects', before: '', after: p.name, why: projectWhy[str(p.ref)] || projectWhy[p.name] || (p.source === 'github' ? 'From your GitHub' : p.source === 'planned' ? 'A project to build for this role' : 'Added for the job') });
  }
  const left = masterProjects.filter(x => !list(doc.projects).some(p => (p.source === 'resume' && str(p.ref) === str(x.id)) || norm(p.name) === norm(x.name)));
  if (left.length) changes.push({ section: 'Projects', before: left.map(x => x.name).join('; '), after: '', why: 'Left out: less relevant to this job, to keep one page' });
  const order = (skills) => list(skills).map(g => str(g.category)).join(', ');
  if (order(doc.skills) !== order(master.skills)) {
    changes.push({ section: 'Technical Skills', before: order(master.skills), after: order(doc.skills), why: 'Most relevant groups first, at most 6 groups of 8' });
  }
  return changes;
}

// ── Gaps across many roles (for project suggestions) ───────────────────────

/**
 * Hard skills the roles ask for that the candidate doesn't show, most asked first:
 * [{ term, roles, required }]. `keywordsPerRole` is one keyword list per role.
 */
// Words every engineering posting uses; a resume shows them through its work, not as a phrase.
const GENERIC = /^(software (development|engineering|design)( lifecycle| life cycle)?|sdlc|object[- ]oriented (programming|design)|oop|debugging|testing|agile|scrum|problem[- ]solving|programming|coding|computer science|data structures( (and|&) algorithms)?|algorithms|engineering|development|software|communication|collaboration|teamwork|documentation|code review|best practices)$/i;

export function gapsAcross(keywordsPerRole, sourceText) {
  const byTerm = new Map();
  keywordsPerRole.forEach((keywords, i) => {
    for (const k of list(keywords)) {
      if (k.kind === 'soft' || GENERIC.test(str(k.term).replace(/[\u2010-\u2015]/g, '-')) || hasTerm(sourceText, k)) continue;
      const key = canonicalTerm(k.term);
      const g = byTerm.get(key) || { term: k.term, aliases: k.aliases || [], roles: new Set(), required: 0 };
      if (!g.roles.has(i)) { g.roles.add(i); if (k.importance === 'required') g.required += 1; }
      byTerm.set(key, g);
    }
  });
  return [...byTerm.values()]
    .map(g => ({ term: g.term, roles: g.roles.size, required: g.required, aliases: g.aliases }))
    .sort((a, b) => b.roles - a.roles || b.required - a.required || a.term.localeCompare(b.term));
}


// ── Skills to ask the user about ───────────────────────────────────────────

/** JD skills a finished resume still doesn't show and nothing the user shared does (hard skills only). */
export function skillsToAsk(t) {
  const kinds = new Map(list(t.ats?.keywords).map(k => [String(k.term ?? '').trim().toLowerCase(), k.kind]));
  return list(t.ats?.missingYouDont).map(m => m.term).filter(term => kinds.get(String(term ?? '').trim().toLowerCase()) !== 'soft').slice(0, 12);
}

