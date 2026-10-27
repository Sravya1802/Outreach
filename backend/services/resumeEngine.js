/**
 * resumeEngine.js — one tailored resume (and, when asked, a cover letter)
 * per job, following the user's resume rules:
 *
 *   1. read the master resume into sections once per upload (Opus, low effort)
 *   2. JD analysis on Groq (a different model, so the writer never grades its
 *      own work): exact title, the 5 things the role hires for, ATS keywords
 *   3. Opus maps every keyword truth-first, reframes experience and projects,
 *   4. resumeGuard rebuilds the draft from the real material and drops
 *      anything it can't back up; resumeRules applies the formatting rules
 *      (dashes, verbs, equal bullets, section order, skills, certifications)
 *   5. LaTeX in the user's own template → PDF, shortened to one page
 *   6. ATS score from the PDF's own text, and a recruiter check on Groq:
 *      callback % before/after, top changes, verdict (apply / referral / skip)
 *   7. ATS at or under 90, callback under 20 or rules broken → one revision
 *   8. when Opus judges the fit needs it, a new project goes on the resume
 *      with a build plan; that resume isn't sent until the user pushes the
 *      repo and marks it built (repo + dates), or takes the project off
 *   9. above 90 and not "skip" (and no unbuilt project) is ready; anything
 *      else waits for the user
 *
 * Runs in the background; the API returns a `running` row to poll.
 */

import { all, one, run } from '../db.js';
import { complete, submitBatch, collectBatch } from './llm.js';
import { currentMaster, saveForEvaluation, saveCoverLetter } from './resumeFiles.js';
import { atsScore, normalizeKeywords, splitMissing, hasTerm, atsPasses, keepProjectOnPage, ATS_TARGET, CALLBACK_TARGET } from './ats.js';
import { guardDraft, addMissingSkills, SHRINK_STEPS, masterText, repoText, plannedText, unsupportedNumbers } from './resumeGuard.js';
import { placeholders, fillPlaceholders, applyRules, diffChanges, skillsToAsk, fixDashes, lintDoc, roleKind, boldTools, keywordPlaces, metricSpans, sortNewestFirst, equalizeBullets, dateValue } from './resumeRules.js';
import { resumeTex, coverLetterTex, compileTex, checkPreamble, RESUME_PREAMBLE } from './latex.js';

const STALE_MINUTES = 20;
const PARSE_VERSION = 2;

// ── JSON schemas (structured outputs: every object closed, every key required) ──

const S = { type: 'string' };
const SA = { type: 'array', items: S };
const obj = (properties) => ({ type: 'object', additionalProperties: false, properties, required: Object.keys(properties) });

export const MASTER_SCHEMA = obj({
  name: S,
  contact: obj({ email: S, phone: S, location: S, links: { type: 'array', items: obj({ label: S, url: S }) } }),
  summary: S,
  education: { type: 'array', items: obj({ school: S, degree: S, field: S, location: S, start: S, end: S, gpa: S, details: SA }) },
  experience: { type: 'array', items: obj({ section: S, company: S, title: S, location: S, start: S, end: S, bullets: SA }) },
  projects: { type: 'array', items: obj({ name: S, tech: SA, link: S, start: S, end: S, bullets: SA }) },
  skills: { type: 'array', items: obj({ category: S, items: SA }) },
  extras: { type: 'array', items: obj({ heading: S, items: SA }) },
});

export const DRAFT_SCHEMA = obj({
  summary: S,
  experience: { type: 'array', items: obj({ id: S, bullets: SA }) },
  projects: { type: 'array', items: obj({ source: { type: 'string', enum: ['resume', 'github', 'planned'] }, ref: S, name: S, tech: SA, bullets: SA, why: S }) },
  skills: { type: 'array', items: obj({ category: S, items: SA }) },
  proposed_project: obj({ needed: { type: 'boolean' }, reuse_id: S, name: S, tech: SA, bullets: SA, covers: SA, why: S, plan: SA }),
  notes: S,
});

const LETTER_SCHEMA = obj({ greeting: S, paragraphs: SA, closing: S });

// ── Prompts ─────────────────────────────────────────────────────────────────

const PARSE_SYSTEM = `You read a resume's extracted PDF text into sections.
Copy the candidate's words exactly. Do not fix, shorten, merge, reword or add anything.
- One experience entry per job/internship/research role, in the order on the page, with its bullets in order. "section" is the heading it sits under, as written but in title case ("Research Experience", "Industry Experience", "Experience", "Leadership").
- Projects: each named project with its bullets; "name" is the full title line without dates (e.g. "Order Book Simulator | Low-Latency Matching Engine"); "tech" is the tools listed for that project.
- Skills: keep the resume's own groups and order.
- extras: any other section (Certifications, Publications, Awards, Leadership, Activities), heading as written, one item per entry.
- Dates as written ("Jun 2025", "2023 – 2027", "Present"). Use "" for anything that isn't there.
- links: LinkedIn, GitHub, portfolio etc. as full URLs when the text shows them.`;

const TAILOR_RULES = `You are a senior technical recruiter and ATS expert with 25 years of hiring SWE, ML, AI and quant engineers. Tailor the candidate's resume to one job so it gets shortlisted for an interview, not just past the ATS. A strict fact-checker runs after you and deletes anything it can't find in the candidate's material, so invented content is wasted space.

Truth
1. Use only facts in CANDIDATE MATERIAL. Never change dates, titles, companies, degrees or contact details. Never add a skill, tool, metric, employer or outcome that isn't there. Never add a relocation line.
2. Keyword mapping, for every ATS keyword: already there → say it in the job's words and move it higher; there but weak → strengthen it with the tools, scale and results the material shows; missing but the material shows equivalent work → write a truthful line from that work; missing with no basis → leave it out. Use the job's exact spelling of tools so the ATS matches.
3. Numbers only as the material states them, in experience and project bullets alike, for every kind of role. Use every real number the material gives a project (scale, speed, accuracy, users, data size).

Reframing
4. Reframe experience and projects toward the job. Mirror its responsibilities in your own words, never copied.
5. experience: the jobs to show, by id. Keep every substantial job; leave out a short or unrelated internship when space is tight. Bullets per entry: 2 for most entries; the job that best proves this role (usually the main industry job) may have 3–4. Every other entry in the same section gets the same number (never cut the main job down to match a minor one). The page holds about 14–16 two-line bullets in all, so pick the strongest. Choose and order bullets by relevance. Current roles in present tense, past roles in past tense.
6. projects: the 2–3 that best prove the job's requirements, from resume projects (source "resume", ref = project id), GitHub repos (source "github", ref = full_name) or projects the candidate built (source "planned", ref = id). The same number of bullets for each project. For a repo, write the bullets from its README/description only.
7. skills: up to 6 groups of up to 8 items, the most job-relevant group first, only skills in the material.
8. summary: "" unless a summary adds job keywords the sections can't hold. If you write one: at most 2 lines (240 characters), facts from the material only.

Bullets
9. Every bullet fills about 2 full lines: 175–230 characters (a line holds about 120). Never a one-line bullet, and never a second line with only a few words on it. A third line only when it's at least 80% full and every word carries a tool or a result. When the material is thin, fill the line with real detail from it (the data, the users, the scale, the tools, the domain), not filler.
10. Strong action verb + what was built + tools + scale, then a closing clause with the result or who it served: a number when the material states one, otherwise the result in words (", giving researchers analysis-ready data", ", supporting safer in-vehicle alerts"). A bullet that only lists what was built isn't finished.
11. No em dashes or triple dashes, no "responsible for", no "helped", no filler. No two bullets in a row start with the same verb.
12. Sound like a new grad with the candidate's real years of experience, not a senior engineer. It should read like a person wrote it.

Weak fit
13. proposed_project: when you judge the fit needs it (required job skills the candidate has no basis for, or no project that proves what the role hires for), add ONE new project the candidate will build and push to GitHub to close those gaps. It goes on this resume, and the resume isn't sent until they've built it. If a project under PLANNED PROJECTS already covers them, set reuse_id to its id instead. A new one: needed true, name ("Name | Subtitle"), tech (the tools it uses, in the job's spelling), bullets (as many as the other projects; each one a strong verb + what the finished project does + tools + a measurable target the candidate will hit and check while building, written in square brackets, like "screens [1,000] synthetic patient profiles against trial criteria in under [2 s]"; about 2 lines each), covers (the job keywords it adds), why (the gap it closes) and plan (5–8 concrete build steps, one of them saying how to measure each bracketed target, the last one about what the README shows). Never suggest one listed as dismissed. Otherwise needed false, reuse_id "" and empty fields.

Scores
14. The ATS match must end up above 90% (aim for 95%): every required skill the candidate truly has appears at least once, in the job's spelling. Never inflate or invent to get there.

Report
15. notes: one or two sentences on the overall angle. (Every change is listed for the candidate by comparing the documents, so don't list them.)`;

const JUDGE_SYSTEM = `You are a senior technical recruiter with 25 years of hiring SWE, ML, AI and quant engineers. You screen applications for one job. Be honest and calibrated; never inflate.
Callback % = the chance a recruiter screening this application shortlists it for an interview, from the resume alone (no referral).
How to estimate it: start from the base rate for a new-grad cold application at this kind of company (big tech or a famous startup 2–5%, mid-size 5–10%, small company 8–15%). Then adjust for fit: every required qualification clearly shown → up to ×3; most shown → ×1.5–2; any hard requirement missing (a required language, framework, degree or years of experience) → ×0.5 or lower. Cap it at 35% unless the resume matches nearly every requirement and the company is small. The before and after numbers use the same base rate, so the difference is only what tailoring changed.
Return JSON:
{"callback_before": 0-100, "callback_after": 0-100,
 "callback_why": "two short lines: why the tailored resume lands at that number",
 "ats_why": "two short lines on the ATS match",
 "top_changes": ["the 3 changes that raised the scores most"],
 "next_change": "the one further change that would raise them (something the candidate could do or show)",
 "blockers": ["hard blockers: needs 3+ years, a required skill the candidate lacks entirely, wrong level, clearance, etc."],
 "verdict": "apply" | "apply_with_referral" | "skip",
 "verdict_why": "one line"}
Verdict: skip when a hard blocker makes an interview unlikely; apply_with_referral when the fit is real but callback_after is under 20; apply when callback_after is 20 or more.`;

const LETTER_SYSTEM = `You write a short, specific cover letter for a student or new grad.
- 3 paragraphs, 220–300 words total: why this company and role (from the job description), the two strongest pieces of evidence from the resume for its top requirements, and a plain closing line.
- Use only facts from the resume provided. Every number must be copied exactly from it.
- No clichés ("I am writing to express", "passionate", "perfect fit"), no flattery, no restating the whole resume, no em dashes.
- greeting: "Dear Hiring Manager," unless the job description names the hiring manager or team. closing: "Sincerely,".`;

// ── Pieces ──────────────────────────────────────────────────────────────────

const str = (v) => String(v ?? '').trim();
const list = (v) => (Array.isArray(v) ? v : []);
const parseJson = (text) => JSON.parse(String(text).replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim());
const safeName = (s) => str(s).replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 40);

/** Give every job/project a stable id the tailoring step can point at. */
export function withIds(parsed) {
  return {
    ...parsed,
    v: PARSE_VERSION,
    experience: (parsed.experience || []).map((e, i) => ({ ...e, id: `e${i + 1}` })),
    projects: (parsed.projects || []).map((p, i) => ({ ...p, id: `p${i + 1}` })),
  };
}

async function resumeText(userId) {
  return (await one("SELECT value FROM meta WHERE user_id = $1 AND key = 'user_resume_text'", [userId]))?.value || '';
}

/** The current master resume, read into sections (cached on the file row; re-read when the reader changes). */
export async function parsedMaster(userId, { force = false } = {}) {
  const master = await one("SELECT * FROM resume_files WHERE user_id = $1 AND kind = 'master' AND is_current", [userId]);
  if (!master) throw Object.assign(new Error('Upload your master resume on Profile → Resume first.'), { status: 400 });
  if (master.parsed && master.parsed.v === PARSE_VERSION && !force) return { master, parsed: master.parsed, cost: 0 };
  const text = await resumeText(userId);
  if (text.length < 200) throw Object.assign(new Error('Your resume PDF has too little readable text. Export it again so the text can be selected.'), { status: 400 });
  const r = await complete({ task: 'resume_parse', system: PARSE_SYSTEM, user: text.slice(0, 20000), schema: MASTER_SCHEMA, maxTokens: 12000, timeoutMs: 180_000, userId });
  const parsed = withIds(parseJson(r.text));
  await run('UPDATE resume_files SET parsed = $1, parsed_at = NOW() WHERE id = $2', [JSON.stringify(parsed), master.id]);
  return { master, parsed, cost: r.costUsd };
}

/** JD analysis: exact title, what the role really hires for, and the ATS keywords. */
export async function extractKeywords({ title, company, description, userId }) {
  const r = await complete({
    task: 'keywords',
    json: true,
    maxTokens: 3500,
    userId,
    system: `You analyze one job description the way a senior technical recruiter and an applicant tracking system would.
Return JSON: {"title":"the exact job title","focus":["the 5 things this role is really hiring for, most important first"],"keywords":[{"term":"Python","aliases":["py"],"importance":"required","kind":"hard","tool":true}]}
- keywords: 12 to 25 terms an ATS would match a resume against. hard = languages, frameworks, tools, platforms, methods, domain areas, degree fields. soft = interpersonal and generic traits (collaboration, communication, problem solving, ownership, teamwork, attention to detail, fast learner), only a few and only if the posting stresses them.
- importance "required" for must-haves / minimum qualifications, else "preferred".
- tool: true for a named language, framework, library, platform, database or product (Python, PyTorch, AWS, Kafka); false for methods, domains and concepts (machine learning, distributed systems).
- aliases: other ways a resume may say the same thing, which an ATS also matches (e.g. "REST APIs" for "RESTful API", "JS" for JavaScript, "k8s" for Kubernetes, "continuous integration" for CI/CD).
- Leave out the company name, benefits, location, pay, EEO text and filler words (team, work, ability).`,
    user: `Job: ${title} at ${company}\n\n${description.slice(0, 7000)}`,
  });
  const j = parseJson(r.text);
  return { keywords: normalizeKeywords(j.keywords), focus: list(j.focus).map(str).filter(Boolean).slice(0, 5), title: str(j.title) || title, cost: r.costUsd };
}

export async function includedRepos(userId) {
  return all(
    `SELECT name, full_name, description, html_url, homepage, language, languages, topics, left(readme, 1500) AS readme
       FROM github_repos WHERE user_id = $1 AND include AND NOT fork AND NOT archived
      ORDER BY pushed_at DESC NULLS LAST LIMIT 12`,
    [userId],
  );
}

export async function plannedProjects(userId) {
  return all("SELECT * FROM planned_projects WHERE user_id = $1 ORDER BY created_at DESC LIMIT 30", [userId]);
}

async function pdfText(pdf) {
  const { PDFParse } = await import('pdf-parse');
  const parser = new PDFParse({ verbosity: -1, data: pdf });
  await parser.load();
  const r = await parser.getText();
  return Array.isArray(r?.pages) ? r.pages.map(p => p.text || '').join('\n') : String(r || '');
}

// ── Template ────────────────────────────────────────────────────────────────

const TEMPLATE_KEY = 'resume_tex_preamble';

/** The user's own LaTeX preamble, or the default template's. */
export async function templatePreamble(userId) {
  const v = (await one('SELECT value FROM meta WHERE user_id = $1 AND key = $2', [userId, TEMPLATE_KEY]))?.value;
  return v || RESUME_PREAMBLE;
}

export async function templateInfo(userId) {
  const rows = await all('SELECT key, value FROM meta WHERE user_id = $1 AND key = ANY($2)', [userId, [TEMPLATE_KEY, `${TEMPLATE_KEY}_at`]]);
  const get = (k) => rows.find(r => r.key === k)?.value || null;
  return { custom: Boolean(get(TEMPLATE_KEY)), preamble: get(TEMPLATE_KEY) || RESUME_PREAMBLE, updatedAt: get(`${TEMPLATE_KEY}_at`) };
}

/** Save a user's .tex as their template, after a test build with their own resume. */
export async function saveTemplate(userId, tex) {
  const c = checkPreamble(tex);
  if (!c.ok) throw Object.assign(new Error(c.error), { status: 400 });
  let sample;
  try { sample = (await parsedMaster(userId)).parsed; } catch { sample = null; }
  const doc = sample ? withIds(sample) : { name: 'Test Name', contact: { email: 'test@example.com', location: 'City, ST' }, education: [], experience: [{ section: 'Experience', company: 'Company', title: 'Engineer', start: '2024', end: 'Present', bullets: ['Built a test bullet with Python.'] }], projects: [], skills: [{ category: 'Languages', items: ['Python'] }], extras: [] };
  try {
    await compileTex(resumeTex(doc, { preamble: c.preamble, metricSpans }));
  } catch (err) {
    throw Object.assign(new Error(`Your template didn’t build on the server: ${err.message.replace(/^LaTeX failed:\s*/, '')}`), { status: 400 });
  }
  const upsert = "INSERT INTO meta (user_id, key, value) VALUES ($1, $2, $3) ON CONFLICT (user_id, key) DO UPDATE SET value = EXCLUDED.value";
  await run(upsert, [userId, TEMPLATE_KEY, c.preamble]);
  await run(upsert, [userId, `${TEMPLATE_KEY}_at`, new Date().toISOString()]);
  return templateInfo(userId);
}

export async function resetTemplate(userId) {
  await run('DELETE FROM meta WHERE user_id = $1 AND key = ANY($2)', [userId, [TEMPLATE_KEY, `${TEMPLATE_KEY}_at`]]);
  return templateInfo(userId);
}

/** Compile, shortening step by step until the resume fits on one page. */
export async function renderOnePage(doc, opts = {}) {
  const tex = (d) => resumeTex(d, opts);
  let current = doc;
  let out = await compileTex(tex(current));
  let shrunk = 0;
  for (const step of SHRINK_STEPS) {
    if (out.pages === 1) break;
    const next = step(current);
    if (!next) continue;
    current = next;
    shrunk += 1;
    out = await compileTex(tex(current));
  }
  return { doc: current, pdf: out.pdf, pages: out.pages, shrunk, tex: tex(current) };
}

// ── Skills the user confirmed they know ────────────────────────────────────
// After a tailoring, JD skills nothing they've shared shows are asked about
// (on the resume page and on WhatsApp). The ones they approve are kept here
// and count as their own skills in every tailoring after.

const SKILLS_KEY = 'confirmed_skills';

export async function confirmedSkills(userId) {
  const v = (await one('SELECT value FROM meta WHERE user_id = $1 AND key = $2', [userId, SKILLS_KEY]))?.value;
  try { return list(JSON.parse(v || '[]')).map(str).filter(Boolean); } catch { return []; }
}

export async function addConfirmedSkills(userId, terms) {
  const cur = await confirmedSkills(userId);
  const next = [...cur];
  for (const t of terms.map(str).filter(Boolean)) if (!next.some(x => x.toLowerCase() === t.toLowerCase())) next.push(t.slice(0, 60));
  await run('INSERT INTO meta (user_id, key, value) VALUES ($1, $2, $3) ON CONFLICT (user_id, key) DO UPDATE SET value = EXCLUDED.value', [userId, SKILLS_KEY, JSON.stringify(next.slice(0, 200))]);
  return next;
}

export async function removeConfirmedSkill(userId, term) {
  const next = (await confirmedSkills(userId)).filter(x => x.toLowerCase() !== str(term).toLowerCase());
  await run('INSERT INTO meta (user_id, key, value) VALUES ($1, $2, $3) ON CONFLICT (user_id, key) DO UPDATE SET value = EXCLUDED.value', [userId, SKILLS_KEY, JSON.stringify(next)]);
  return next;
}

const confirmedLine = (confirmed) => (confirmed?.length ? `Skills the candidate confirmed they have: ${confirmed.join(', ')}` : '');

/**
 * After a resume finishes: if JD skills are missing, remember what was asked
 * (for a WhatsApp "ADD 1 3" reply) and send the question.
 */
export async function askAboutSkills(userId, tailoringId) {
  const t = await one(
    `SELECT t.id, t.ats, e.company_name, e.job_title FROM resume_tailorings t JOIN evaluations e ON e.id = t.evaluation_id
      WHERE t.id = $1 AND t.user_id = $2 AND t.kind = 'resume' AND t.status IN ('ready', 'needs_review')`,
    [tailoringId, userId],
  );
  if (!t) return null;
  // A draft written with the evening list waits: the question comes when the role is approved.
  if (await isPendingDraft(userId, tailoringId)) return null;
  const terms = skillsToAsk(t);
  if (!terms.length) return null;
  const ask = { tailoringId: Number(t.id), terms, company: t.company_name, title: t.job_title, at: new Date().toISOString() };
  await run("INSERT INTO meta (user_id, key, value) VALUES ($1, 'skills_ask', $2) ON CONFLICT (user_id, key) DO UPDATE SET value = EXCLUDED.value", [userId, JSON.stringify(ask)]);
  const { notify, skillsMessage } = await import('./whatsapp.js');
  return notify(userId, 'skills', skillsMessage(ask)).catch(() => null);
}

/** A resume drafted for a role on the evening list that hasn't been approved yet. */
async function isPendingDraft(userId, tailoringId) {
  return Boolean(await one(
    `SELECT 1 FROM plan_items pi JOIN resume_tailorings t ON t.evaluation_id = pi.evaluation_id
      WHERE t.id = $1 AND pi.user_id = $2 AND pi.decision = 'pending'`,
    [tailoringId, userId],
  ));
}

/** The last skills question sent on WhatsApp, for an ADD reply. */
export async function lastSkillsAsk(userId) {
  const v = (await one("SELECT value FROM meta WHERE user_id = $1 AND key = 'skills_ask'", [userId]))?.value;
  try { return v ? JSON.parse(v) : null; } catch { return null; }
}

/** Re-render and re-score a finished resume as it is (after a scoring fix, or new confirmed skills). */
export async function rescoreTailoring(userId, tailoringId) {
  return rerenderWithProject(userId, tailoringId, { id: 0 }, 'rescore');
}

/** The user knows these JD skills: remember them and put them on this resume. */
export async function approveSkills(userId, tailoringId, terms) {
  const clean = list(terms).map(str).filter(Boolean).slice(0, 20);
  if (!clean.length) throw Object.assign(new Error('Pick at least one skill'), { status: 400 });
  await addConfirmedSkills(userId, clean);
  return rerenderWithProject(userId, tailoringId, { terms: clean }, 'skills');
}

function candidateMaterial(parsed, repos, planned, confirmed = []) {
  const repoBlock = repos.map(r => `- ${r.full_name}${r.description ? `: ${r.description}` : ''}\n  languages: ${Object.keys(r.languages || {}).join(', ') || r.language || 'n/a'}; topics: ${(r.topics || []).join(', ') || 'none'}\n  README: ${str(r.readme).replace(/\s+/g, ' ').slice(0, 1200) || '(none)'}`).join('\n');
  const built = planned.filter(p => p.status === 'built');
  const suggested = planned.filter(p => p.status === 'suggested');
  const dismissed = planned.filter(p => p.status === 'dismissed');
  const fmt = (p) => `- id ${p.id}: ${p.name} | tech: ${list(p.tech).join(', ')} | covers: ${list(p.covers).join(', ')}${p.status === 'built' ? `\n  bullets: ${list(p.bullets).join(' / ')}\n  dates: ${p.start_date || ''} – ${p.end_date || ''}; repo: ${p.repo_url || ''}` : ''}`;
  return `CANDIDATE MATERIAL
${confirmed.length ? `Skills the candidate confirmed they have (use them like any skill on the resume): ${confirmed.join(', ')}

` : ''}Master resume (JSON):
${JSON.stringify(parsed)}

GitHub repos the candidate chose to include:
${repoBlock || '(none connected)'}

Projects the candidate built from earlier suggestions (use with source "planned"):
${built.map(fmt).join('\n') || '(none)'}

PLANNED PROJECTS (suggested, not built yet; reuse instead of suggesting a new one):
${suggested.map(fmt).join('\n') || '(none)'}
Dismissed suggestions (never suggest again): ${dismissed.map(p => p.name).join('; ') || '(none)'}`;
}

// ── Runs ────────────────────────────────────────────────────────────────────

async function finish(id, fields) {
  const keys = Object.keys(fields);
  await run(
    `UPDATE resume_tailorings SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')}, finished_at = NOW() WHERE id = $1`,
    [id, ...keys.map(k => (fields[k] !== null && typeof fields[k] === 'object' ? JSON.stringify(fields[k]) : fields[k]))],
  );
}

async function loadEvaluation(userId, evalId) {
  const ev = await one('SELECT id, job_title, company_name, job_description, job_url FROM evaluations WHERE id = $1 AND user_id = $2', [evalId, userId]);
  if (!ev) throw Object.assign(new Error('Evaluation not found'), { status: 404 });
  // Roles tracked from Jobs have no description yet: use the listing's, or read the posting.
  const { fetchJobFromUrl, looksLikeJobDescription } = await import('./jobEvaluator.js');
  if (!looksLikeJobDescription(ev.job_description) && ev.job_url) {
    let jd = (await one('SELECT description FROM scraped_roles WHERE apply_url = $1', [ev.job_url]))?.description || '';
    if (!looksLikeJobDescription(jd)) jd = (await fetchJobFromUrl(ev.job_url, { company: ev.company_name }).catch(() => null))?.text || '';
    if (looksLikeJobDescription(jd)) {
      ev.job_description = str(jd).slice(0, 20000);
      await run('UPDATE evaluations SET job_description = $1 WHERE id = $2 AND user_id = $3', [ev.job_description, ev.id, userId]);
    }
  }
  if (!looksLikeJobDescription(ev.job_description)) {
    throw Object.assign(new Error('This role has no job description saved. Evaluate it from the posting URL or paste the description first.'), { status: 400 });
  }
  return ev;
}

/**
 * Guarded draft → rules → one-page PDF → ATS score, adding skills the
 * candidate has but the draft left out. Shared by the first pass, the
 * revision and "add the project I built".
 */
async function build(draft, ctx) {
  const { parsed, repos, planned, raw, keywords, kind, preamble, sourceText } = ctx;
  const guarded = guardDraft(draft, parsed, repos, `${raw}\n${confirmedLine(ctx.confirmed)}`, planned.filter(p => p.status === 'built'));
  const ruled = applyRules(guarded.doc, { keywords, kind });
  return renderScored(ruled.doc, ctx, { removed: [...guarded.removed, ...ruled.removed], fixed: ruled.fixed });
}

async function renderScored(doc, ctx, { removed = [], fixed = [] } = {}) {
  const { keywords, kind, preamble, sourceText } = ctx;
  const opts = { preamble, boldTerms: boldTools(keywords), metricSpans, projectMetrics: true };
  let rendered = await renderOnePage(doc, opts);
  let text = await pdfText(rendered.pdf);
  let score = atsScore({ keywords, pdfText: text, doc: rendered.doc, pages: rendered.pages });
  let addedSkills = [];
  const { inSource } = splitMissing(score.missing, sourceText);
  if (inSource.length) {
    // Add the candidate's own missing skills, but only as many as keep it on one page.
    for (let n = inSource.length; n > 0; n -= 1) {
      const r = addMissingSkills(rendered.doc, inSource.slice(0, n), keywords);
      if (!r.added.length) break;
      const tried = await renderOnePage(r.doc, opts);
      if (tried.pages !== 1 && rendered.pages === 1) continue;
      rendered = tried;
      addedSkills = r.added;
      text = await pdfText(rendered.pdf);
      score = atsScore({ keywords, pdfText: text, doc: rendered.doc, pages: rendered.pages });
      break;
    }
  }
  return { doc: rendered.doc, pdf: rendered.pdf, tex: rendered.tex, pages: rendered.pages, shrunk: rendered.shrunk, text, score, addedSkills, removed, fixed, lint: lintDoc(rendered.doc, { kind }) };
}

/** Recruiter check on Groq: callback before/after, what moved the scores, verdict. */
async function judge(ctx, { beforeText, afterText, atsBefore, atsAfter, userId }) {
  const { ev, keywords } = ctx;
  const r = await complete({
    task: 'evaluate',
    json: true,
    maxTokens: 2500,
    userId,
    system: JUDGE_SYSTEM,
    user: `JOB: ${ev.job_title} at ${ev.company_name}
ATS keyword match: before ${atsBefore}%, after ${atsAfter}% (keywords: ${keywords.map(k => `${k.term}${k.importance === 'required' ? '*' : ''}`).join(', ')}; * = required)

JOB DESCRIPTION:
${ev.job_description.slice(0, 6000)}

RESUME BEFORE (the master, untailored):
${str(beforeText).slice(0, 6000)}

RESUME AFTER (tailored, as the ATS reads it):
${str(afterText).slice(0, 6000)}`,
  });
  const j = parseJson(r.text);
  const pct = (v) => Math.max(0, Math.min(100, Math.round(Number(v) || 0)));
  return {
    callbackBefore: pct(j.callback_before),
    callbackAfter: pct(j.callback_after),
    callbackWhy: str(j.callback_why),
    atsWhy: str(j.ats_why),
    topChanges: list(j.top_changes).map(str).filter(Boolean).slice(0, 3),
    nextChange: str(j.next_change),
    blockers: list(j.blockers).map(str).filter(Boolean).slice(0, 5),
    verdict: ['apply', 'apply_with_referral', 'skip'].includes(j.verdict) ? j.verdict : 'apply_with_referral',
    verdictWhy: str(j.verdict_why),
    model: r.model,
    cost: r.costUsd,
  };
}

/** What the revision pass is asked to fix. Empty when the draft meets every target. */
function revisionNotes(pass, judged, sourceText) {
  const notes = [];
  for (const x of pass.lint.filter(x => x.code !== 'short').slice(0, 15)) notes.push(`${x.where}: ${x.bullet ? `“${x.bullet}” ` : ''}${x.why}.`);
  const short = pass.lint.filter(x => x.code === 'short');
  if (short.length) notes.push(`These bullets are too short and leave a thin second line. Rewrite each to fill about 2 lines (175–230 characters) with real tools, scale and the result, keeping the facts: ${short.map(x => `“${x.bullet}” (${x.bullet.length})`).join('; ')}.`);
  const { inSource, notInSource } = splitMissing(pass.score.missing, sourceText);
  if (inSource.length) notes.push(`These job keywords are in the candidate's material but not on the page; work them into bullets truthfully: ${inSource.map(k => k.term).join(', ')}.`);
  const hard = notInSource.filter(k => k.kind !== 'soft');
  const soft = pass.score.missing.filter(k => k.kind === 'soft');
  if (soft.length && !atsPasses(pass.score.score)) notes.push(`These soft skills from the job aren't on the page: ${soft.map(k => `${k.term}${k.importance === 'required' ? ' (required)' : ''}`).join(', ')}. Show each through real work in a bullet, using the job's word where it's true (e.g. "collaborated with clinicians", "communicated findings to stakeholders", "solved…"). Don't list them under skills.`);
  if (hard.length && !atsPasses(pass.score.score)) notes.push(`These job keywords aren't written anywhere in the material: ${hard.map(k => `${k.term}${k.importance === 'required' ? ' (required)' : ''}`).join(', ')}. For each, decide whether the candidate's real work shows it in substance (e.g. "system design" for designing a microservices architecture, "NoSQL" for MongoDB, "REST APIs" for a FastAPI service). If it does, write a truthful line using the job's exact phrase. If it doesn't, leave it out; if several required ones are missing, that's when a project to build fits (rule 13).`);
  if (!atsPasses(pass.score.score)) notes.push(`ATS match is ${pass.score.score}%; the rule is above ${ATS_TARGET}% (aim for 95%). Improve keyword placement, reframing and project choice, or add a project to build (rule 13); never claim what the material doesn't show.`);
  if (judged && judged.callbackAfter < CALLBACK_TARGET && notes.length) notes.push(`A recruiter check puts the callback chance at ${judged.callbackAfter}% (target ${CALLBACK_TARGET}%): ${judged.callbackWhy} Suggested: ${judged.nextChange}`);
  if (pass.removed.length) notes.push(`The fact check removed: ${pass.removed.slice(0, 8).map(r => `“${r.what}” (${r.why})`).join('; ')}. Don't repeat those.`);
  return notes;
}

const better = (a, b) => (b.score.score > a.score.score || (b.score.score === a.score.score && b.lint.length < a.lint.length) ? b : a);

/** Which proposed project (if any) to show, saved as a suggestion. */
async function handleProposal(userId, draft, ctx, final, tailoringId) {
  const p = draft.proposed_project || {};
  const { planned, sourceText, keywords } = ctx;
  if (str(p.reuse_id)) {
    const hit = planned.find(x => String(x.id) === str(p.reuse_id) && x.status === 'suggested');
    if (hit) return hit;
  }
  if (!p.needed || !str(p.name) || !list(p.bullets).length) return null;
  // Opus decides when a project is needed. Name the job keywords it adds (what
  // the candidate can't claim today), falling back to what Opus listed.
  const { notInSource } = splitMissing(final.score.missing, sourceText);
  const covers = list(p.covers).map(str).filter(Boolean);
  const hits = notInSource.filter(k => covers.some(c => hasTerm(c, k)) || list(p.tech).some(t => hasTerm(t, k)) || list(p.bullets).some(b => hasTerm(b, k)));
  const adds = hits.length ? hits.map(k => k.term) : covers;
  const bullets = list(p.bullets).map(str).filter(Boolean).filter(b => !/\d/.test(b.replace(/\b[A-Za-z]+[-.]?\d[\w.]*\b/g, ''))).slice(0, 3);
  if (!bullets.length) return null;
  const row = (await run(
    `INSERT INTO planned_projects (user_id, evaluation_id, tailoring_id, name, tech, bullets, covers, why, plan)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
    [userId, ctx.ev.id, tailoringId, str(p.name).slice(0, 120), JSON.stringify(list(p.tech).map(str).filter(Boolean).slice(0, 8)), JSON.stringify(bullets),
      JSON.stringify(adds.slice(0, 10)), str(p.why).slice(0, 500), JSON.stringify(list(p.plan).map(str).filter(Boolean).slice(0, 10))],
  )).rows[0];
  if (!tailoringId || !(await isPendingDraft(userId, tailoringId))) {
    const { notify, projectsMessage } = await import('./whatsapp.js');
    await notify(userId, 'projects', projectsMessage([{ name: row.name, covers: row.covers, demand: null, roles: [`${ctx.ev.company_name} · ${ctx.ev.job_title}`] }])).catch(() => {});
  }
  return row;
}

/** The project as a resume entry (pinned so the one-page shrink keeps it). */
// Only a built project is pinned against the one-page shrink; an unbuilt
// suggestion must never push the candidate's real projects off the page.
const projectEntry = (p) => ({ name: p.name, link: p.repo_url || '', start: p.start_date || '', end: p.end_date || '', tech: list(p.tech), bullets: list(p.bullets), source: 'planned', ref: String(p.id), keep: p.status === 'built' });
const realProjects = (doc) => list(doc?.projects).filter(x => x.source !== 'planned').length;

/** The doc with one more project, newest first, with equal bullet counts. */
function withProject(doc, p) {
  const projects = sortNewestFirst([...doc.projects.filter(x => !(x.source === 'planned' && x.ref === String(p.id))), projectEntry(p)]);
  return { ...doc, projects: equalizeBullets(projects, 'Projects').entries };
}

/** Everything a tailoring works from. `jd` reuses an analysis already made (a batch picking up where it left off). */
async function context(userId, ev, jd = null) {
  const { master, parsed, cost: parseCost } = await parsedMaster(userId);
  if (!jd) jd = await extractKeywords({ title: ev.job_title, company: ev.company_name, description: ev.job_description, userId });
  else jd = { ...jd, cost: 0 };
  const [repos, planned, raw, preamble, confirmed] = await Promise.all([includedRepos(userId), plannedProjects(userId), resumeText(userId), templatePreamble(userId), confirmedSkills(userId)]);
  const kind = roleKind({ title: ev.job_title, company: ev.company_name, description: ev.job_description });
  const built = planned.filter(p => p.status === 'built');
  const sourceText = `${masterText(parsed)}\n${raw}\n${repos.map(repoText).join('\n')}\n${built.map(plannedText).join('\n')}\n${confirmedLine(confirmed)}`;
  return { ev, master, parsed, repos, planned, raw, preamble, confirmed, kind, keywords: jd.keywords, focus: jd.focus, title: jd.title, sourceText, cost: parseCost + jd.cost };
}

/** The ATS score of the untailored master, from the text an ATS reads in its PDF. */
function beforeScore(ctx) {
  return atsScore({ keywords: ctx.keywords, pdfText: ctx.raw || masterText(ctx.parsed), doc: ctx.parsed, pages: 1 });
}

/** Everything stored on the tailoring row for a finished pass. */
function rowFields(ctx, final, judged, extra) {
  const { keywords, sourceText, kind } = ctx;
  const split = splitMissing(final.score.missing, sourceText);
  const before = beforeScore(ctx);
  // Waiting on a project only if it's on the page; one kept beside the resume doesn't hold it.
  const unbuilt = extra.proposedProject?.status === 'suggested' && extra.proposedProject.onPage !== false;
  // Your rule: strictly one page. A longer one never goes out on its own.
  const ready = atsPasses(final.score.score) && judged?.verdict !== 'skip' && !unbuilt && final.pages === 1;
  return {
    status: ready ? 'ready' : 'needs_review',
    ats_score: final.score.score,
    ats: {
      score: final.score.score,
      target: ATS_TARGET,
      before: before.score,
      coverage: final.score.coverage,
      keywords,
      matched: final.score.matched.map(k => k.term),
      missingYouHave: split.inSource.map(k => k.term),
      missingYouDont: split.notInSource.map(k => ({ term: k.term, importance: k.importance })),
      places: keywordPlaces(final.doc, keywords),
      checks: final.score.checks,
      pages: final.pages,
    },
    report: {
      ...extra,
      title: ctx.title,
      focus: ctx.focus,
      roleKind: kind,
      callback: judged ? { before: judged.callbackBefore, after: judged.callbackAfter, target: CALLBACK_TARGET, why: judged.callbackWhy } : null,
      atsWhy: judged?.atsWhy || '',
      topChanges: judged?.topChanges || [],
      nextChange: judged?.nextChange || '',
      blockers: judged?.blockers || [],
      verdict: judged?.verdict || null,
      verdictWhy: judged?.verdictWhy || '',
      ruleIssues: final.lint,
      removed: final.removed,
      fixed: final.fixed,
      addedSkills: final.addedSkills,
      shortenedSteps: final.shrunk,
      doc: final.doc,
      tex: final.tex,
    },
  };
}

// ── The tailoring, as steps (run straight through, or paused between Opus calls in a batch) ──

const DRAFT_MAX_TOKENS = 16000;

function draftPrompt(ctx) {
  const { ev } = ctx;
  return {
    system: `${TAILOR_RULES}\n\n${candidateMaterial(ctx.parsed, ctx.repos, ctx.planned, ctx.confirmed)}`,
    user: `JOB: ${ctx.title} at ${ev.company_name}
ROLE TYPE: ${ctx.kind.quant ? 'quant/HFT/C++ (Industry Experience may go above Research)' : 'not quant'}${ctx.kind.finance ? '; finance' : ''}
WHAT THIS ROLE IS REALLY HIRING FOR: ${ctx.focus.join('; ') || 'n/a'}
ATS KEYWORDS (from the posting): ${ctx.keywords.map(k => `${k.term}${k.importance === 'required' ? ' (required)' : ''}`).join(', ')}

JOB DESCRIPTION:
${ev.job_description.slice(0, 7000)}`,
  };
}

const revisionSuffix = (draft, notes) => `\n\nYOUR PREVIOUS DRAFT (JSON):\n${JSON.stringify(draft)}\n\nTHE CHECKERS FOUND:\n${notes.map(n => `- ${n}`).join('\n')}\n\nRevise the draft to fix these, keeping what already works, and return the full draft. Never invent facts to hit a target; if a target can't be reached honestly, leave it.`;

async function recruiterCheck(ctx, pass, userId) {
  return judge(ctx, { beforeText: ctx.raw || masterText(ctx.parsed), afterText: pass.text, atsBefore: beforeScore(ctx).score, atsAfter: pass.score.score, userId })
    .catch(err => { console.warn('[resumeEngine] judge failed:', err.message); return null; });
}

/** A first draft → page, scores, recruiter check, and what a revision should fix ([] = none needed). */
async function checkDraft(userId, ctx, draft) {
  const pass = await build(draft, ctx);
  const judged = await recruiterCheck(ctx, pass, userId);
  return { pass, judged, notes: revisionNotes(pass, judged, ctx.sourceText), cost: judged?.cost || 0 };
}

/** Keep the revision only if it's better; re-check it if so. */
async function takeRevision(userId, ctx, first, secondDraft) {
  const pass2 = await build(secondDraft, ctx);
  if (better(first.pass, pass2) !== pass2) return { revised: false, cost: 0 };
  const judged = await recruiterCheck(ctx, pass2, userId);
  return { draft: secondDraft, pass: pass2, judged: judged || first.judged, revised: true, cost: judged?.cost || 0 };
}

/** The project to build (if any), the PDF, and the row's fields. */
async function finishTailoring(userId, ctx, { draft, pass, judged, model, revised, cost, tailoringId }) {
  const { ev } = ctx;
  // A project Opus says the fit needs goes on this resume, waiting to be built.
  const proposal = await handleProposal(userId, draft, ctx, pass, tailoringId).catch(err => { console.warn('[resumeEngine] proposal failed:', err.message); return null; });
  let proposedProject = null;
  if (proposal) {
    const withIt = await renderScored(applyRules(withProject(pass.doc, proposal), { keywords: ctx.keywords, kind: ctx.kind }).doc, ctx, { removed: pass.removed, fixed: pass.fixed }).catch(err => { console.warn('[resumeEngine] project render failed:', err.message); return null; });
    proposedProject = { id: Number(proposal.id), name: proposal.name, tech: proposal.tech, bullets: proposal.bullets, covers: proposal.covers, why: proposal.why, plan: proposal.plan, status: proposal.status, withoutAts: pass.score.score, projectedAts: withIt?.score.score ?? null,
      onPage: Boolean(withIt?.doc.projects.some(x => x.source === 'planned' && x.ref === String(proposal.id)))
        && keepProjectOnPage(pass.score.score, withIt?.score.score)
        && realProjects(withIt?.doc) >= Math.min(2, realProjects(pass.doc)) };
    if (withIt && proposedProject.onPage) {
      pass = withIt;
      const j3 = await recruiterCheck(ctx, pass, userId);
      if (j3) { judged = j3; cost += j3.cost; }
    }
  }

  const file = await saveForEvaluation(userId, ev.id, pass.pdf, `${safeName(ctx.parsed.name || 'resume')}-${safeName(ev.company_name)}.pdf`, 'tailored');
  const fields = rowFields(ctx, pass, judged, {
    notes: str(draft.notes),
    changes: diffChanges(ctx.parsed, pass.doc, ctx.keywords, Object.fromEntries(list(draft.projects).flatMap(d => [[str(d.ref), str(d.why)], [str(d.name), str(d.why)]]))),
    projects: pass.doc.projects.map(p => ({ name: p.name, source: p.source, why: str(list(draft.projects).find(d => str(d.ref) === p.ref)?.why) })),
    proposedProject,
    revised,
    model,
    judgeModel: judged?.model || null,
  });
  return { ...fields, master_file_id: ctx.master.id, file_id: file.id, cost_usd: Number(cost.toFixed(5)) };
}

/** The tailoring, straight through (the "Tailor my resume" button). Returns the fields stored on the row. */
export async function tailor(userId, ev, tailoringId = null) {
  const ctx = await context(userId, ev);
  let cost = ctx.cost;
  const prompt = draftPrompt(ctx);
  const draftCall = async (extra = '') => {
    const r = await complete({ task: 'resume', system: prompt.system, user: prompt.user + extra, schema: DRAFT_SCHEMA, maxTokens: DRAFT_MAX_TOKENS, timeoutMs: 300_000, userId });
    cost += r.costUsd;
    return { draft: parseJson(r.text), model: r.model };
  };

  // Pass 1, the recruiter check, and one revision if a target or rule is missed.
  const first = await draftCall();
  const checked = await checkDraft(userId, ctx, first.draft);
  cost += checked.cost;
  let state = { draft: first.draft, pass: checked.pass, judged: checked.judged, model: first.model, revised: false };
  if (checked.notes.length) {
    const second = await draftCall(revisionSuffix(first.draft, checked.notes)).catch(err => { console.warn('[resumeEngine] revision failed:', err.message); return null; });
    if (second) {
      const r = await takeRevision(userId, ctx, state, second.draft);
      cost += r.cost;
      if (r.revised) state = { ...state, ...r, model: second.model };
    }
  }
  return finishTailoring(userId, ctx, { ...state, cost, tailoringId });
}

// ── Batches: the nightly resumes at half price ──────────────────────────────
//
// A row started with { batch: true } waits in resume_tailorings.batch:
//   queued → drafting (Opus batch) → revise_queued → revising (Opus batch) → done
// pumpBatches() (every 5 minutes) submits what's queued and picks up what's
// back. Most batches end within an hour. A request that errors or expires is
// sent once more; then the row fails (or, for a revision, keeps the first draft).

const BATCH_STALE_HOURS = 26;

async function setBatch(id, batch) {
  await run('UPDATE resume_tailorings SET batch = $2 WHERE id = $1', [id, JSON.stringify(batch)]);
}

async function failRow(id, message) {
  await finish(id, { status: 'failed', error: String(message).slice(0, 500), batch: null });
}

/** Submit every queued draft and revision, one batch per user and step. */
async function submitQueued() {
  const rows = await all("SELECT * FROM resume_tailorings WHERE status = 'running' AND batch->>'phase' IN ('queued', 'revise_queued') ORDER BY id LIMIT 200");
  const groups = new Map();
  for (const r of rows) {
    const key = `${r.user_id}:${r.batch.phase}`;
    groups.set(key, [...(groups.get(key) || []), r]);
  }
  let submitted = 0;
  for (const rowsOf of groups.values()) {
    const userId = rowsOf[0].user_id;
    const items = [];
    const ready = [];
    for (const r of rowsOf) {
      try {
        const ev = await loadEvaluation(userId, r.evaluation_id);
        const ctx = await context(userId, ev, r.batch.jd || null);
        const prompt = draftPrompt(ctx);
        const revising = r.batch.phase === 'revise_queued';
        const id = `t${r.id}-${revising ? 'r' : 'd'}${r.batch.tries || 0}`;
        items.push({ id, system: prompt.system, user: prompt.user + (revising ? revisionSuffix(r.batch.draft, r.batch.notes) : ''), schema: DRAFT_SCHEMA, maxTokens: DRAFT_MAX_TOKENS });
        ready.push({ r, id, jd: { keywords: ctx.keywords, focus: ctx.focus, title: ctx.title }, cost: ctx.cost });
      } catch (err) {
        // Rate-limited (Groq's free tier): leave it queued for the next pass.
        if (/429|rate limit/i.test(String(err.message)) && !/no credits/i.test(String(err.message).split('|')[0])) continue;
        await failRow(r.id, err.message);
      }
    }
    if (!items.length) continue;
    try {
      const { batchId } = await submitBatch({ task: 'resume', items, userId });
      for (const x of ready) {
        await setBatch(x.r.id, { ...x.r.batch, phase: x.r.batch.phase === 'queued' ? 'drafting' : 'revising', batchId, customId: x.id, jd: x.jd, cost: Number(x.r.batch.cost || 0) + x.cost, submittedAt: new Date().toISOString() });
      }
      submitted += items.length;
    } catch (err) {
      for (const x of ready) await failRow(x.r.id, err.message);
    }
  }
  return submitted;
}

/** Pick up finished batches and move each row on. */
async function collectFinished() {
  const rows = await all("SELECT * FROM resume_tailorings WHERE status = 'running' AND batch->>'phase' IN ('drafting', 'revising') ORDER BY id LIMIT 200");
  let done = 0;
  for (const batchId of [...new Set(rows.map(r => r.batch.batchId))]) {
    const mine = rows.filter(r => r.batch.batchId === batchId);
    let results;
    try {
      results = await collectBatch({
        task: 'resume',
        batchId,
        owners: Object.fromEntries(mine.map(r => [r.batch.customId, r.user_id])),
        maxTokens: Object.fromEntries(mine.map(r => [r.batch.customId, DRAFT_MAX_TOKENS])),
      });
    } catch (err) {
      console.warn(`[resumeEngine] batch ${batchId}:`, err.message);
      continue;
    }
    if (!results) {
      for (const r of mine) {
        if (Date.now() - new Date(r.batch.submittedAt).getTime() > BATCH_STALE_HOURS * 3600_000) await failRow(r.id, 'The resume batch never finished. Try again.');
      }
      continue;
    }
    for (const r of mine) {
      await moveOn(r, results.get(r.batch.customId)).catch(async (err) => {
        console.error(`[resumeEngine] batch row #${r.id}:`, err.message);
        await failRow(r.id, err.message);
      });
      done += 1;
    }
  }
  return done;
}

/** One row's batch result → the next step (a revision) or the finished resume. */
async function moveOn(r, res) {
  const b = r.batch;
  const cost = Number(b.cost || 0) + Number(res?.costUsd || 0);
  const revising = b.phase === 'revising';
  if (!res?.ok) {
    if (res?.retry && (b.tries || 0) < 1) { await setBatch(r.id, { ...b, phase: revising ? 'revise_queued' : 'queued', tries: (b.tries || 0) + 1, cost }); return; }
    if (!revising) { await failRow(r.id, res?.error || 'The resume batch returned nothing for this role.'); return; }
  }
  const ev = await loadEvaluation(r.user_id, r.evaluation_id);
  const ctx = await context(r.user_id, ev, b.jd);
  if (!revising) {
    const draft = parseJson(res.text);
    const checked = await checkDraft(r.user_id, ctx, draft);
    if (checked.notes.length) {
      await setBatch(r.id, { ...b, phase: 'revise_queued', tries: 0, draft, notes: checked.notes, model: res.model, cost: cost + checked.cost });
      return;
    }
    await finish(r.id, { ...(await finishTailoring(r.user_id, ctx, { draft, pass: checked.pass, judged: checked.judged, model: res.model, revised: false, cost: cost + checked.cost, tailoringId: r.id })), batch: null });
    await askAboutSkills(r.user_id, r.id).catch(() => null);
    return;
  }
  // The revision is back (or failed for good, in which case the first draft stands).
  const first = await checkDraft(r.user_id, ctx, b.draft);
  let state = { draft: b.draft, pass: first.pass, judged: first.judged, model: b.model, revised: false };
  let extra = first.cost;
  if (res?.ok) {
    const t = await takeRevision(r.user_id, ctx, state, parseJson(res.text));
    extra += t.cost;
    if (t.revised) state = { ...state, ...t, model: res.model };
  }
  await finish(r.id, { ...(await finishTailoring(r.user_id, ctx, { ...state, cost: cost + extra, tailoringId: r.id })), batch: null });
  await askAboutSkills(r.user_id, r.id).catch(() => null);
}

/**
 * Finished resumes whose recruiter check failed (Groq rate limit with no
 * fallback): re-score a few each pass until every one has its interview chance.
 */
async function fillMissingChecks(limit = 3) {
  const rows = await all(
    `SELECT id, user_id FROM resume_tailorings
      WHERE kind = 'resume' AND status IN ('ready', 'needs_review') AND finished_at > NOW() - INTERVAL '3 days'
        AND (report->'callback' IS NULL OR report->'callback' = 'null'::jsonb)
      ORDER BY finished_at DESC LIMIT $1`,
    [limit],
  );
  let fixed = 0;
  for (const r of rows) {
    const t = await rerenderWithProject(r.user_id, r.id, { id: 0 }, 'rescore').catch(err => { console.warn(`[resumeEngine] recheck #${r.id}:`, err.message); return null; });
    if (t?.report?.callback) fixed += 1;
  }
  return fixed;
}

/** Every 5 minutes: pick up finished resume batches, send what's queued, fill in failed checks. */
export async function pumpBatches() {
  const collected = await collectFinished();
  const submitted = await submitQueued();
  const rechecked = await fillMissingChecks().catch(() => 0);
  return { collected, submitted, rechecked };
}

export async function writeCoverLetter(userId, ev) {
  const { parsed, cost: c1 } = await parsedMaster(userId);
  const latest = await one(
    "SELECT report FROM resume_tailorings WHERE user_id = $1 AND evaluation_id = $2 AND kind = 'resume' AND status IN ('ready','needs_review') ORDER BY id DESC LIMIT 1",
    [userId, ev.id],
  );
  const resumeDoc = latest?.report?.doc || parsed;
  const r = await complete({
    task: 'cover_letter',
    system: LETTER_SYSTEM,
    user: `RESUME (JSON):\n${JSON.stringify(resumeDoc)}\n\nJOB: ${ev.job_title} at ${ev.company_name}\n\nJOB DESCRIPTION:\n${ev.job_description.slice(0, 7000)}`,
    schema: LETTER_SCHEMA,
    maxTokens: 8000,
    timeoutMs: 240_000,
    userId,
  });
  const letter = parseJson(r.text);
  const source = `${masterText(parsed)}\n${await resumeText(userId)}`;
  const removed = [];
  const paragraphs = (letter.paragraphs || []).map(p => fixDashes(p).split(/(?<=[.!?])\s+/).filter(sentence => {
    const bad = unsupportedNumbers(sentence, `${source}\n${ev.job_title}\n${ev.company_name}\n${ev.job_description}`);
    if (bad.length) removed.push({ where: 'Cover letter', what: sentence, why: `numbers ${bad.join(', ')} aren’t in your resume` });
    return !bad.length;
  }).join(' ')).filter(Boolean);
  const date = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/Chicago' });
  const { pdf, pages } = await compileTex(coverLetterTex({ name: parsed.name, contact: parsed.contact, date, company: ev.company_name, greeting: letter.greeting, paragraphs, closing: letter.closing || 'Sincerely,' }));
  const safe = (s) => str(s).replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 40);
  const file = await saveCoverLetter(userId, ev.id, pdf, `${safe(parsed.name || 'cover')}-${safe(ev.company_name)}-cover-letter.pdf`);
  return {
    status: 'ready',
    file_id: file.id,
    report: { paragraphs, greeting: letter.greeting, removed, pages, model: r.model },
    cost_usd: Number((c1 + r.costUsd).toFixed(5)),
  };
}

export function coverLetterRequested(jd) {
  return /cover\s*letter/i.test(String(jd || ''));
}

const running = new Set();

/**
 * Start a tailoring or cover letter in the background. Returns the new row,
 * or the one already running for this role.
 */
export async function start(userId, evalId, kind = 'resume', { batch = false } = {}) {
  const ev = await loadEvaluation(userId, evalId);
  const busy = await one(
    `SELECT * FROM resume_tailorings WHERE user_id = $1 AND evaluation_id = $2 AND kind = $3 AND status = 'running'
       AND (created_at > NOW() - INTERVAL '${STALE_MINUTES} minutes' OR (batch IS NOT NULL AND created_at > NOW() - INTERVAL '${BATCH_STALE_HOURS} hours'))
      ORDER BY id DESC LIMIT 1`,
    [userId, ev.id, kind],
  );
  if (busy) return busy;
  if (kind === 'resume') await currentMaster(userId).then(m => { if (!m) throw Object.assign(new Error('Upload your master resume on Profile → Resume first.'), { status: 400 }); });
  if (batch && kind === 'resume') {
    // Half price: waits for pumpBatches() to send it with the rest of tonight's resumes.
    return (await run(
      "INSERT INTO resume_tailorings (user_id, evaluation_id, kind, batch) VALUES ($1, $2, 'resume', $3) RETURNING *",
      [userId, ev.id, JSON.stringify({ phase: 'queued', queuedAt: new Date().toISOString() })],
    )).rows[0];
  }
  const row = (await run(
    'INSERT INTO resume_tailorings (user_id, evaluation_id, kind) VALUES ($1, $2, $3) RETURNING *',
    [userId, ev.id, kind],
  )).rows[0];
  running.add(row.id);
  const job = kind === 'resume' ? tailor(userId, ev, row.id) : writeCoverLetter(userId, ev);
  job.then(fields => finish(row.id, fields))
    .then(() => (kind === 'resume' ? askAboutSkills(userId, row.id).catch(() => null) : null))
    .catch(async (err) => {
      console.error(`[resumeEngine] ${kind} #${row.id} failed:`, err.message);
      await finish(row.id, { status: 'failed', error: String(err.message).slice(0, 500) }).catch(() => {});
    })
    .finally(() => running.delete(row.id));
  return row;
}

/** Latest run of each kind for a role, with stale `running` rows reported as failed. */
export async function latest(userId, evalId) {
  const rows = await all(
    `SELECT DISTINCT ON (t.kind) t.*, f.filename, f.size_bytes
       FROM resume_tailorings t LEFT JOIN resume_files f ON f.id = t.file_id
      WHERE t.user_id = $1 AND t.evaluation_id = $2
      ORDER BY t.kind, t.id DESC`,
    [userId, evalId],
  );
  const out = { resume: null, cover_letter: null };
  for (const r of rows) {
    const staleAfter = r.batch ? BATCH_STALE_HOURS * 3600_000 : STALE_MINUTES * 60_000;
    if (r.status === 'running' && !running.has(Number(r.id)) && Date.now() - new Date(r.created_at).getTime() > staleAfter) {
      r.status = 'failed';
      r.error = 'The server restarted while this was running. Try again.';
    }
    out[r.kind] = r;
  }
  return out;
}

/** "Send it anyway" for a resume under the bar. Never while a project on it isn't built yet. */
export async function approve(userId, tailoringId) {
  const t = await one("SELECT report->'proposedProject' AS p FROM resume_tailorings WHERE id = $1 AND user_id = $2", [tailoringId, userId]);
  if (t?.p?.status === 'suggested' && t.p.onPage) {
    throw Object.assign(new Error(`This resume lists “${t.p.name}”, which you haven’t built yet. Build it and mark it built, or take it off the resume first.`), { status: 409 });
  }
  const r = await run(
    "UPDATE resume_tailorings SET approved_at = NOW() WHERE id = $1 AND user_id = $2 AND kind = 'resume' AND status = 'needs_review' RETURNING id, evaluation_id",
    [tailoringId, userId],
  );
  return r.rows[0] || null;
}

/** Why a finished resume is waiting for the user, in one sentence. */
export function reviewReason(t) {
  const verdict = t.report?.verdict ?? t.verdict;
  const why = t.report?.verdictWhy ?? t.verdict_why;
  const project = t.report?.proposedProject ?? (t.project_name ? { name: t.project_name, status: t.project_status, onPage: true } : null);
  if (project?.status === 'suggested' && project.onPage !== false) return `The resume for this role includes a project to build: “${project.name}”. Build it, push it to GitHub and mark it built (or take it off), then it can go out.`;
  if (verdict === 'skip') return `The recruiter check says skip this role${why ? `: ${why}` : '.'} Review it and choose “Send anyway” or skip it.`;
  return `The tailored resume scored ${t.ats_score}% on the ATS check (target ${ATS_TARGET}%). Review it and choose “Send anyway” or skip the role.`;
}

/**
 * Resumes → By job: every role with a resume (drafted, tailored or yours),
 * newest first, with which version goes out and its scores.
 */
export async function resumesByJob(userId) {
  const rows = await all(
    `SELECT e.id, e.company_name, e.job_title, e.job_url, e.score AS eval_score, e.apply_status, e.source,
            e.created_at, f.kind AS sending_kind, f.filename AS sending_filename, f.id AS sending_file_id,
            t.id AS tailoring_id, t.status, t.ats_score, t.ats->'before' AS ats_before, t.report->'callback'->>'after' AS callback,
            t.report->>'verdict' AS verdict, t.batch->>'phase' AS batch_phase, t.file_id AS tailored_file_id, t.finished_at, t.approved_at,
            t.report->'proposedProject'->>'name' AS project, t.report->'proposedProject'->>'status' AS project_status,
            pi.decision, pi.stage, pi.id AS plan_item_id, to_jsonb(pi)->>'apply_mode' AS apply_mode, pi.stage_note, pi.needs_reason, pi.apply_after, pi.wait_until,
            e.applied_at, dp.plan_date::text AS list_date
       FROM evaluations e
       LEFT JOIN resume_files f ON f.id = e.resume_file_id
       LEFT JOIN LATERAL (SELECT * FROM resume_tailorings rt WHERE rt.evaluation_id = e.id AND rt.user_id = e.user_id AND rt.kind = 'resume' ORDER BY rt.id DESC LIMIT 1) t ON true
       LEFT JOIN LATERAL (SELECT * FROM plan_items p WHERE p.evaluation_id = e.id AND p.user_id = e.user_id ORDER BY p.id DESC LIMIT 1) pi ON true
       LEFT JOIN daily_plans dp ON dp.id = pi.plan_id
      WHERE e.user_id = $1 AND (t.id IS NOT NULL OR f.kind = 'uploaded')
      ORDER BY COALESCE(t.finished_at, t.created_at, e.created_at) DESC
      LIMIT 300`,
    [userId],
  );
  return rows.map(r => ({
    id: Number(r.id), company_name: r.company_name, job_title: r.job_title, job_url: r.job_url,
    eval_score: r.eval_score == null ? null : Number(r.eval_score) / 10,
    list_date: r.list_date, decision: r.decision || null, stage: r.stage || null, apply_status: r.apply_status,
    plan_item_id: r.plan_item_id == null ? null : Number(r.plan_item_id), apply_mode: r.apply_mode || null, stage_note: r.stage_note || null,
    needs_reason: r.needs_reason || null, apply_after: r.apply_after || null, wait_until: r.wait_until || null, applied_at: r.applied_at || null,
    resume: r.tailoring_id ? {
      tailoring_id: Number(r.tailoring_id), status: r.status, batch_phase: r.batch_phase, ats: r.ats_score == null ? null : Number(r.ats_score),
      ats_before: r.ats_before == null ? null : Number(r.ats_before), callback: r.callback == null ? null : Number(r.callback),
      verdict: r.verdict, file_id: r.tailored_file_id == null ? null : Number(r.tailored_file_id), finished_at: r.finished_at,
      project: r.project, project_status: r.project_status,
    } : null,
    sending: r.sending_kind === 'uploaded' ? { kind: 'yours', file_id: Number(r.sending_file_id), filename: r.sending_filename } : r.sending_kind === 'tailored' ? { kind: 'tailored', file_id: Number(r.sending_file_id), filename: r.sending_filename } : null,
  }));
}

/** Go back to the app's tailored resume for a role after uploading your own. */
export async function useTailored(userId, evalId) {
  const t = await one("SELECT file_id FROM resume_tailorings WHERE user_id = $1 AND evaluation_id = $2 AND kind = 'resume' AND file_id IS NOT NULL ORDER BY id DESC LIMIT 1", [userId, evalId]);
  if (!t) throw Object.assign(new Error('There’s no tailored resume for this role yet'), { status: 404 });
  await run('UPDATE evaluations SET resume_file_id = $3, pdf_path = NULL WHERE id = $1 AND user_id = $2', [evalId, userId, t.file_id]);
  return { ok: true };
}

/** For auto-apply: may this role's resume go out? */
export async function resumeGate(userId, evalId) {
  // The user's own upload for this role goes as-is.
  const mine = await one("SELECT 1 FROM evaluations e JOIN resume_files f ON f.id = e.resume_file_id WHERE e.id = $1 AND e.user_id = $2 AND f.kind = 'uploaded'", [evalId, userId]);
  if (mine) return { ok: true, uploaded: true };
  const t = await one(
    `SELECT status, ats_score, approved_at, report->>'verdict' AS verdict, report->>'verdictWhy' AS verdict_why,
            report->'proposedProject'->>'name' AS project_name, report->'proposedProject'->>'status' AS project_status
       FROM resume_tailorings WHERE user_id = $1 AND evaluation_id = $2 AND kind = 'resume' AND status <> 'failed' ORDER BY id DESC LIMIT 1`,
    [userId, evalId],
  );
  if (!t || t.status === 'ready' || t.approved_at) return { ok: true };
  if (t.status === 'running') return { ok: false, reason: 'The tailored resume for this role is still being written.' };
  return { ok: false, reason: reviewReason(t) };
}

// ── Suggested projects ──────────────────────────────────────────────────────

const REPO_URL = /^https:\/\/github\.com\/([A-Za-z0-9-]{1,39})\/([A-Za-z0-9._-]{1,100})\/?$/;

/** Is this a public GitHub repo? (The user says they pushed it; check.) */
async function repoExists(url) {
  const m = REPO_URL.exec(url);
  if (!m) return false;
  const headers = { 'User-Agent': 'ScoutnJobs', Accept: 'application/vnd.github+json' };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const r = await fetch(`https://api.github.com/repos/${m[1]}/${m[2].replace(/\.git$/, '')}`, { headers, signal: AbortSignal.timeout(10_000) }).catch(() => null);
  return Boolean(r?.ok);
}

function checkDates(start, end) {
  const a = dateValue(start);
  const b = dateValue(end);
  if (a === null || b === null) return 'Use dates like “Jun 2026”, or “Present” for the end.';
  if (a === Infinity) return 'The start can’t be “Present”.';
  if (a > b) return 'The start date is after the end date.';
  const now = new Date();
  if (a > now.getFullYear() + (now.getMonth() + 1) / 100) return 'The start date is in the future.';
  return null;
}

export async function listProjects(userId) {
  return plannedProjects(userId);
}

/** Finished resumes that carry this project (it can be reused across roles). */
async function tailoringsWith(userId, projectId) {
  return all(
    `SELECT id FROM resume_tailorings WHERE user_id = $1 AND kind = 'resume' AND status IN ('ready', 'needs_review')
        AND report->'proposedProject'->>'id' = $2 ORDER BY id DESC LIMIT 20`,
    [userId, String(projectId)],
  );
}

/**
 * The user built the project and pushed it: save the repo and dates, then
 * re-render every resume that lists it, now with the link and dates (no AI
 * rewrite; the bullets are what they built to). Returns the project and the
 * latest updated tailoring.
 */
export async function markProjectBuilt(userId, projectId, { repoUrl, start, end, values = [] }) {
  const p = await one('SELECT * FROM planned_projects WHERE id = $1 AND user_id = $2', [projectId, userId]);
  if (!p) throw Object.assign(new Error('Project not found'), { status: 404 });
  // The dates are required; the link is optional, but if given it has to be right.
  const url = str(repoUrl).replace(/\.git$/, '').replace(/\/$/, '');
  if (url && !REPO_URL.test(url)) throw Object.assign(new Error('Paste the repo’s GitHub link, like https://github.com/you/project, or leave it empty.'), { status: 400 });
  if (!str(start) || !str(end)) throw Object.assign(new Error('Add the start and end dates, like “Jun 2026” and “Aug 2026” or “Present”.'), { status: 400 });
  const bad = checkDates(start, end);
  if (bad) throw Object.assign(new Error(bad), { status: 400 });
  // The bracketed targets in its bullets get the user's real numbers.
  const targets = placeholders(p.bullets);
  const given = list(values).map(str);
  if (targets.length && (given.length !== targets.length || given.some(v => !v))) {
    throw Object.assign(new Error(`Fill in your real number for each target (${targets.join(', ')}).`), { status: 400 });
  }
  const bullets = targets.length ? fillPlaceholders(p.bullets, given) : list(p.bullets);
  if (url && !(await repoExists(url))) throw Object.assign(new Error('That repo isn’t public on GitHub yet. Push it (and make it public), or leave the link empty.'), { status: 400 });
  const built = (await run(
    `UPDATE planned_projects SET status = 'built', repo_url = $3, start_date = $4, end_date = $5, bullets = $6, built_at = NOW(), updated_at = NOW()
      WHERE id = $1 AND user_id = $2 RETURNING *`,
    [projectId, userId, url || null, str(start), str(end), JSON.stringify(bullets)],
  )).rows[0];
  let tailoring = null;
  for (const t of await tailoringsWith(userId, projectId)) {
    const r = await rerenderWithProject(userId, t.id, built, 'built').catch(err => { console.warn('[resumeEngine] add project failed:', err.message); return null; });
    tailoring = tailoring || r;
  }
  return { project: built, tailoring };
}

/** Not building it: take it off every resume that lists it and never suggest it again. */
export async function dismissProject(userId, projectId) {
  const r = await run("UPDATE planned_projects SET status = 'dismissed', updated_at = NOW() WHERE id = $1 AND user_id = $2 AND status = 'suggested' RETURNING *", [projectId, userId]);
  const p = r.rows[0];
  if (!p) return null;
  for (const t of await tailoringsWith(userId, projectId)) {
    await rerenderWithProject(userId, t.id, p, 'remove').catch(err => console.warn('[resumeEngine] remove project failed:', err.message));
  }
  return p;
}

/**
 * Re-render a finished tailoring with a project now built (its link and
 * dates filled in) or taken off, then re-score and re-check it.
 */
async function rerenderWithProject(userId, tailoringId, project, mode) {
  const t = await one("SELECT * FROM resume_tailorings WHERE id = $1 AND user_id = $2 AND kind = 'resume' AND status IN ('ready', 'needs_review')", [tailoringId, userId]);
  if (!t?.report?.doc) return null;
  const ev = await loadEvaluation(userId, t.evaluation_id);
  const { master, parsed } = await parsedMaster(userId);
  const [repos, planned, raw, preamble, confirmed] = await Promise.all([includedRepos(userId), plannedProjects(userId), resumeText(userId), templatePreamble(userId), confirmedSkills(userId)]);
  // Recomputed, not read from the report, so a fixed rule reaches resumes already drafted.
  const kind = roleKind({ title: ev.job_title, company: ev.company_name, description: ev.job_description });
  const built = planned.filter(p => p.status === 'built');
  const sourceText = `${masterText(parsed)}\n${raw}\n${repos.map(repoText).join('\n')}\n${built.map(plannedText).join('\n')}\n${confirmedLine(confirmed)}`;
  const ctx = { ev, master, parsed, repos, planned, raw, preamble, confirmed, kind, keywords: t.ats?.keywords || [], focus: t.report.focus || [], title: t.report.title || ev.job_title, sourceText };
  const ref = String(project.id);
  const skillKeywords = mode === 'skills' ? project.terms.map(term => ctx.keywords.find(k => k.term.toLowerCase() === term.toLowerCase()) || { term, aliases: [], importance: 'preferred', kind: 'hard' }) : [];
  const doc = mode === 'built' ? withProject(t.report.doc, project)
    : mode === 'rescore' ? t.report.doc
    : mode === 'skills' ? addMissingSkills(t.report.doc, skillKeywords, ctx.keywords).doc
    : { ...t.report.doc, projects: t.report.doc.projects.filter(x => !(x.source === 'planned' && x.ref === ref)) };
  const ruled = applyRules(doc, { keywords: ctx.keywords, kind });
  const pass = await renderScored(ruled.doc, ctx, { removed: [...list(t.report.removed), ...ruled.removed], fixed: list(t.report.fixed) });
  const atsBefore = beforeScore(ctx).score;
  const judged = await judge(ctx, { beforeText: raw || masterText(parsed), afterText: pass.text, atsBefore, atsAfter: pass.score.score, userId }).catch(() => null);
  const file = await saveForEvaluation(userId, ev.id, pass.pdf, `${safeName(parsed.name || 'resume')}-${safeName(ev.company_name)}.pdf`, 'tailored');
  const keep = t.report;
  const change = mode === 'built'
    ? { section: 'Projects', before: '', after: project.name, why: `You built it${project.repo_url ? ` (${project.repo_url})` : ''}; it adds ${list(project.covers).join(', ') || 'the missing skills'}.` }
    : mode === 'skills'
      ? { section: 'Technical Skills', before: '', after: project.terms.join(', '), why: 'You confirmed you know them.' }
      : { section: 'Projects', before: project.name, after: '', why: 'You chose not to build it, so it came off.' };
  const fields = rowFields(ctx, pass, judged || {
    callbackBefore: keep.callback?.before, callbackAfter: keep.callback?.after, callbackWhy: keep.callback?.why, atsWhy: keep.atsWhy,
    topChanges: keep.topChanges, nextChange: keep.nextChange, blockers: keep.blockers, verdict: keep.verdict, verdictWhy: keep.verdictWhy,
  }, {
    notes: keep.notes,
    changes: mode === 'rescore' ? list(keep.changes) : [...list(keep.changes), change],
    projects: pass.doc.projects.map(p => ({ name: p.name, source: p.source, why: p.source === 'planned' ? 'The project you built for this role' : str(list(keep.projects).find(d => d.name === p.name)?.why) })),
    proposedProject: !keep.proposedProject || mode === 'skills' || mode === 'rescore' ? keep.proposedProject || null
      : { ...keep.proposedProject, status: mode === 'built' ? 'built' : 'dismissed', onPage: mode === 'built', addedAt: mode === 'built' ? new Date().toISOString() : undefined },
    revised: keep.revised,
    model: keep.model,
    judgeModel: judged?.model || keep.judgeModel || null,
  });
  await run(
    'UPDATE resume_tailorings SET status = $3, ats_score = $4, ats = $5, report = $6, file_id = $7, approved_at = NULL, cost_usd = cost_usd + $8, finished_at = NOW() WHERE id = $1 AND user_id = $2',
    [tailoringId, userId, fields.status, fields.ats_score, JSON.stringify(fields.ats), JSON.stringify(fields.report), file.id, Number((judged?.cost || 0).toFixed(5))],
  );
  return one('SELECT * FROM resume_tailorings WHERE id = $1', [tailoringId]);
}
