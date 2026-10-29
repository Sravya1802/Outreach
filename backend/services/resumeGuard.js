/**
 * resumeGuard.js — the "never invent" rule, enforced in code after the AI
 * writes. The tailored draft is rebuilt from the master resume and GitHub
 * repos; the AI only gets to choose, order and reword:
 *
 *   • contact, education and extra sections are copied from the master
 *   • jobs keep their real company/title/dates/section (by id); the AI may
 *     leave a minor one out, but every section keeps at least one
 *   • a bullet whose numbers aren't in that job's original bullets is dropped
 *   • projects must be a master project, an included GitHub repo or a
 *     project the user built from a suggestion, with numbers and tech found
 *     in that project's own text
 *   • a skill must appear somewhere in the master resume or the repos
 *
 * Everything removed is listed with the reason, for the change report.
 */

import { hasTerm } from './ats.js';
import { CHARS_PER_LINE, MAX_SKILL_GROUPS, MAX_SKILL_ITEMS } from './resumeRules.js';

const MAX_EXPERIENCE_BULLETS = 5;
const MAX_PROJECTS = 3;
const MAX_PROJECT_BULLETS = 3;

const str = (v) => String(v ?? '').trim();
const list = (v) => (Array.isArray(v) ? v : []);

/** "2M+", "40%", "$12K", "1,200", "3.5x" → normalized tokens. */
export function numbersIn(s) {
  return [...String(s ?? '').matchAll(/\d+(?:[.,]\d+)*\s?(?:%|x\b|k\b|m\b|b\b)?\+?/gi)]
    .map(m => m[0].toLowerCase().replace(/[,\s]/g, ''))
    .map(n => n.replace(/\.0+(?=\D|$)/, ''));
}

/** Numbers in `text` that `source` never mentions. Bare digits match their decorated forms ("40" ⊂ "40%"). */
export function unsupportedNumbers(text, source) {
  const have = numbersIn(source);
  const bare = new Set(have.map(n => n.replace(/[^\d.]/g, '')));
  return numbersIn(text).filter(n => !have.includes(n) && !bare.has(n.replace(/[^\d.]/g, '')));
}

/** A project the user built from a suggestion, as source text. */
export function plannedText(p) {
  return [p.name, list(p.tech).join(', '), ...list(p.bullets), p.repo_url].filter(Boolean).join('\n');
}

export function repoText(r) {
  return [r.name, r.full_name, r.description, list(r.topics).join(' '), Object.keys(r.languages || {}).join(' '), r.language, r.readme]
    .filter(Boolean).join('\n');
}

/** Every string in the parsed master resume (names, dates, GPA, bullets…), one per line. */
export function masterText(m) {
  const out = [];
  const walk = (v) => {
    if (typeof v === 'string') { if (v.trim()) out.push(v.trim()); }
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(m);
  return out.join('\n');
}

const norm = (s) => str(s).toLowerCase().replace(/[^a-z0-9+#]/g, '');

/**
 * @param {object} draft   the AI's tailored output
 * @param {object} master  parsed master resume
 * @param {object[]} repos included GitHub repos
 * @param {string} [rawMasterText] the PDF's raw text, as extra evidence for skills
 * @param {object[]} [planned] projects the user built from a suggestion (status built)
 * @returns {{ doc: object, removed: {where: string, what: string, why: string}[] }}
 */
export function guardDraft(draft, master, repos = [], rawMasterText = '', planned = []) {
  const removed = [];
  const corpus = `${masterText(master)}\n${rawMasterText}\n${repos.map(repoText).join('\n')}\n${planned.map(plannedText).join('\n')}`;

  // Summary: optional, two lines at most, no numbers the resume doesn't have.
  let summary = str(draft.summary);
  if (summary) {
    const bad = unsupportedNumbers(summary, `${masterText(master)}\n${rawMasterText}`);
    if (bad.length) { removed.push({ where: 'Summary', what: summary, why: `used numbers not in your resume (${bad.join(', ')})` }); summary = str(master.summary); }
    else if (summary.length > 2 * CHARS_PER_LINE) { removed.push({ where: 'Summary', what: summary, why: 'longer than two lines' }); summary = str(master.summary).length <= 2 * CHARS_PER_LINE ? str(master.summary) : ''; }
  }

  // Experience: the jobs the AI kept, by id. Unknown ids are ignored; a
  // section the AI emptied keeps its master entries.
  const byId = new Map(list(master.experience).map(e => [str(e.id), e]));
  const ranked = [];
  for (const d of list(draft.experience)) {
    const m = byId.get(str(d.id));
    if (m && !ranked.some(r => r.m === m)) ranked.push({ m, d });
  }
  const sectionOf = (e) => str(e.section) || 'Experience';
  for (const m of list(master.experience)) {
    if (ranked.some(r => r.m === m)) continue;
    if (!ranked.some(r => sectionOf(r.m) === sectionOf(m))) ranked.push({ m, d: null });
    else removed.push({ where: sectionOf(m), what: `${m.title} at ${m.company}`, why: 'left out for this role to keep one page' });
  }
  // Keep jobs in date order as on the master; the AI chooses bullets, not job order.
  ranked.sort((a, b) => list(master.experience).indexOf(a.m) - list(master.experience).indexOf(b.m));

  const experience = ranked.map(({ m, d }) => {
    const source = list(m.bullets).join('\n');
    let kept = [];
    for (const b of list(d?.bullets).map(str).filter(Boolean)) {
      const bad = unsupportedNumbers(b, source);
      if (bad.length) removed.push({ where: `${m.title} at ${m.company}`, what: b, why: `number${bad.length > 1 ? 's' : ''} ${bad.join(', ')} ${bad.length > 1 ? 'aren’t' : 'isn’t'} in your original bullets` });
      else kept.push(b);
    }
    if (!kept.length) kept = list(m.bullets).slice(0, 3);
    return { id: m.id, section: sectionOf(m), company: m.company, title: m.title, location: m.location, start: m.start, end: m.end, bullets: kept.slice(0, MAX_EXPERIENCE_BULLETS) };
  });

  // Projects: from the master or an included repo, checked against that project's own text.
  const masterProjects = new Map(list(master.projects).map(p => [str(p.id), p]));
  const repoByName = new Map(repos.map(r => [norm(r.full_name), r]));
  for (const r of repos) if (!repoByName.has(norm(r.name))) repoByName.set(norm(r.name), r);
  const plannedById = new Map(planned.map(p => [str(p.id), p]));
  const projects = [];
  for (const p of list(draft.projects)) {
    if (projects.length >= MAX_PROJECTS) break;
    let base = null;
    let sourceText = '';
    if (p.source === 'resume' && masterProjects.has(str(p.ref))) {
      const m = masterProjects.get(str(p.ref));
      base = { name: m.name, link: m.link, start: m.start, end: m.end };
      sourceText = [m.name, list(m.tech).join(', '), ...list(m.bullets)].join('\n');
    } else if (p.source === 'planned' && plannedById.has(str(p.ref))) {
      const m = plannedById.get(str(p.ref));
      base = { name: m.name, link: m.repo_url, start: m.start_date, end: m.end_date };
      sourceText = plannedText(m);
    } else if (p.source === 'github' && repoByName.has(norm(p.ref))) {
      const r = repoByName.get(norm(p.ref));
      base = { name: str(p.name) && norm(p.name).includes(norm(r.name).slice(0, 6)) ? str(p.name) : r.name, link: r.homepage || r.html_url, start: '', end: '' };
      sourceText = repoText(r);
    } else {
      removed.push({ where: 'Projects', what: str(p.name) || str(p.ref), why: 'not a project on your resume, an included GitHub repo or a project you built' });
      continue;
    }
    if (projects.some(x => norm(x.name) === norm(base.name))) continue;
    const tech = [];
    for (const t of list(p.tech).map(str).filter(Boolean)) {
      if (hasTerm(sourceText, { term: t }) || hasTerm(corpus, { term: t })) tech.push(t);
      else removed.push({ where: base.name, what: t, why: 'this tech isn’t mentioned for the project or anywhere in your background' });
    }
    const bullets = [];
    for (const b of list(p.bullets).map(str).filter(Boolean)) {
      const bad = unsupportedNumbers(b, sourceText);
      if (bad.length) removed.push({ where: base.name, what: b, why: `number${bad.length > 1 ? 's' : ''} ${bad.join(', ')} ${bad.length > 1 ? 'aren’t' : 'isn’t'} in the project’s ${p.source === 'github' ? 'README' : 'original bullets'}` });
      else bullets.push(b);
    }
    if (!bullets.length) {
      removed.push({ where: 'Projects', what: base.name, why: 'no bullet survived the fact check' });
      continue;
    }
    projects.push({ ...base, tech: tech.slice(0, 6), bullets: bullets.slice(0, MAX_PROJECT_BULLETS), source: p.source, ref: str(p.ref) });
  }
  if (!projects.length) {
    for (const m of list(master.projects).slice(0, 2)) projects.push({ name: m.name, link: m.link, start: m.start, end: m.end, tech: list(m.tech), bullets: list(m.bullets).slice(0, MAX_PROJECT_BULLETS), source: 'resume', ref: m.id });
  }

  // Skills: only what the background shows.
  const skills = [];
  const seenSkill = new Set();
  for (const g of list(draft.skills)) {
    if (skills.length >= MAX_SKILL_GROUPS) break;
    const items = [];
    for (const it of list(g.items).map(str).filter(Boolean)) {
      if (seenSkill.has(norm(it)) || items.length >= MAX_SKILL_ITEMS) continue;
      if (hasTerm(corpus, { term: it })) { items.push(it); seenSkill.add(norm(it)); }
      else removed.push({ where: 'Skills', what: it, why: 'not in your resume or GitHub' });
    }
    if (items.length) skills.push({ category: str(g.category) || 'Skills', items });
  }
  if (!skills.length) skills.push(...list(master.skills));

  return {
    doc: {
      name: master.name,
      contact: master.contact,
      summary,
      education: list(master.education),
      experience,
      projects,
      skills,
      extras: list(master.extras),
    },
    removed,
  };
}

/**
 * Add the candidate's own skills that the job asks for but the draft left
 * out. Only terms found in their background (inSource) ever get here. Groups
 * stay at 8 items: when one is full, an item the job doesn't ask for makes
 * room. `keywords` (all of the job's) decides which items the job wants.
 */
export function addMissingSkills(doc, missing, keywords = missing) {
  const terms = missing.filter(k => k.kind !== 'soft').map(k => k.term);
  if (!terms.length) return { doc, added: [] };
  const skills = doc.skills.map(g => ({ ...g, items: [...g.items] }));
  if (!skills.length) return { doc: { ...doc, skills: [{ category: 'Skills', items: terms.slice(0, MAX_SKILL_ITEMS) }] }, added: terms.slice(0, MAX_SKILL_ITEMS) };
  const wanted = (it) => keywords.some(k => hasTerm(it, k)) || terms.some(t => norm(t) === norm(it));
  const preferred = skills.find(g => /tool|technolog|framework|other/i.test(g.category)) || skills[skills.length - 1];
  const added = [];
  for (const t of terms) {
    if (skills.some(g => g.items.some(i => norm(i) === norm(t)))) continue;
    const room = [preferred, ...skills].find(g => g.items.length < MAX_SKILL_ITEMS);
    if (room) { room.items.push(t); added.push(t); continue; }
    const swap = [preferred, ...skills].find(g => g.items.some(i => !wanted(i)));
    if (!swap) break;
    const at = swap.items.map(i => !wanted(i)).lastIndexOf(true);
    swap.items[at] = t;
    added.push(t);
  }
  return { doc: { ...doc, skills }, added };
}

/** The page's bullets by key: E1.2 = the 1st job's 2nd bullet, P2.1 = the 2nd project's 1st. */
export function bulletKeys(doc) {
  const out = new Map();
  list(doc.experience).forEach((e, i) => list(e.bullets).forEach((b, j) => out.set(`E${i + 1}.${j + 1}`, { section: 'experience', i, j, b, where: `${e.title} at ${e.company}` })));
  list(doc.projects).forEach((p, i) => list(p.bullets).forEach((b, j) => out.set(`P${i + 1}.${j + 1}`, { section: 'projects', i, j, b, where: p.name })));
  return out;
}

const words = (s) => ` ${str(s).toLowerCase().replace(/[‐-―−]/g, '-').replace(/[^a-z0-9+#]+/g, ' ').trim()} `;

/**
 * Checks the AI's keyword edits on a finished page and applies the ones that
 * hold up. A reworded bullet must add a missing keyword the old one didn't
 * have, keep to numbers the material states, stay within two lines, and
 * quote the candidate's material (three words or more) showing the skill; a
 * soft skill may instead quote the work the bullet already describes. A
 * skills-list addition is a hard skill with a quote from the material.
 */
export function applyWeave(doc, reply, missing, sourceText, keywords = missing) {
  const keys = bulletKeys(doc);
  const src = words(sourceText);
  const quoted = (q, min) => { const w = words(q); return w.trim().split(' ').length >= min && w.trim().length >= 4 ? w : null; };
  const byTerm = (t) => missing.find(k => k.term.toLowerCase() === str(t).toLowerCase());
  const out = { ...doc, experience: list(doc.experience).map(e => ({ ...e, bullets: [...list(e.bullets)] })), projects: list(doc.projects).map(p => ({ ...p, bullets: [...list(p.bullets)] })) };
  const edits = [];
  const used = new Set();
  for (const e of list(reply?.edits)) {
    const at = keys.get(str(e.key));
    const bullet = str(e.bullet);
    if (!at || used.has(at) || !bullet || bullet.length > 2 * CHARS_PER_LINE) continue;
    const q = quoted(e.evidence, 3);
    const backed = (k) => q && (src.includes(q) || (k.kind === 'soft' && words(at.b).includes(q)));
    const adds = list(e.keywords).map(byTerm).filter(k => k && hasTerm(bullet, k) && !hasTerm(at.b, k));
    if (!adds.length || !adds.every(backed) || unsupportedNumbers(bullet, `${at.b}\n${sourceText}`).length) continue;
    out[at.section][at.i].bullets[at.j] = bullet;
    used.add(at);
    edits.push({ section: at.where, before: at.b, after: bullet, keywords: adds.map(k => k.term), evidence: str(e.evidence) });
  }
  const skills = list(reply?.skills).map(s => ({ k: byTerm(s.keyword), q: quoted(s.evidence, 1) }))
    .filter(s => s.k && s.k.kind !== 'soft' && s.q && src.includes(s.q) && !edits.some(e => e.keywords.includes(s.k.term)));
  const { doc: withSkills, added } = addMissingSkills(out, skills.map(s => s.k), keywords);
  return { doc: withSkills, edits, added };
}

/**
 * Ways to make the page shorter, least costly first. Each returns a new doc
 * or null when it has nothing left to cut.
 */
export const SHRINK_STEPS = [
  // A summary only restates the page; it goes before Publications or a project does.
  (d) => (d.summary ? { ...d, summary: '' } : null),
  (d) => (d.extras.some(x => x.items.length > 3) ? { ...d, extras: d.extras.map(x => ({ ...x, items: x.items.slice(0, 3) })) } : null),
  (d) => (d.projects.length > 2 ? { ...d, projects: dropProject(d.projects) } : null),
  (d) => (d.experience.some(e => e.bullets.length > 4) ? { ...d, experience: d.experience.map(e => ({ ...e, bullets: e.bullets.slice(0, 4) })) } : null),
  (d) => (d.projects.some(p => p.bullets.length > 2) ? { ...d, projects: d.projects.map(p => ({ ...p, bullets: p.bullets.slice(0, 2) })) } : null),
  (d) => (d.experience.some(e => e.bullets.length > 3) ? { ...d, experience: d.experience.map(e => ({ ...e, bullets: e.bullets.slice(0, 3) })) } : null),
  (d) => (d.education.some(e => (e.details || []).length > 1) ? { ...d, education: d.education.map(e => ({ ...e, details: (e.details || []).slice(0, 1) })) } : null),
  (d) => (d.extras.length > 1 ? { ...d, extras: d.extras.slice(0, 1) } : null),
  (d) => (d.projects.length > 1 ? { ...d, projects: dropProject(d.projects) } : null),
  // Still over: lighter Skills, two bullets per entry, and so on.
  (d) => (d.skills.some(g => g.items.length > 6) ? { ...d, skills: d.skills.map(g => ({ ...g, items: g.items.slice(0, 6) })) } : null),
  (d) => (d.skills.length > 5 ? { ...d, skills: d.skills.slice(0, 5) } : null),
  (d) => (d.experience.some(e => e.bullets.length > 2) ? { ...d, experience: d.experience.map(e => ({ ...e, bullets: e.bullets.slice(0, 2) })) } : null),
  (d) => (d.skills.length > 4 ? { ...d, skills: d.skills.slice(0, 4) } : null),
  (d) => (d.education.some(e => (e.details || []).length) ? { ...d, education: d.education.map(e => ({ ...e, details: [] })) } : null),
  (d) => (d.extras.length ? { ...d, extras: [] } : null),
];

/** Drop the last project that isn't pinned (a project the user built for this role stays). */
function dropProject(projects) {
  const i = projects.map(p => !p.keep).lastIndexOf(true);
  return i < 0 ? projects.slice(0, -1) : projects.filter((_, j) => j !== i);
}
