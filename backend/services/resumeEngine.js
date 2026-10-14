/**
 * resumeEngine.js — one tailored resume (and, when asked, a cover letter)
 * per job, following the apply rules:
 *
 *   1. read the master resume into sections once per upload (Opus, low effort)
 *   2. pull the ATS keywords out of the job description (Groq — a different
 *      model, so the writer never grades its own work)
 *   3. Opus picks projects from the resume + included GitHub repos and
 *      rewords/reorders bullets toward the job
 *   4. resumeGuard rebuilds the draft from the real material and drops
 *      anything it can't back up
 *   5. skills the candidate has but the draft left out are added
 *   6. LaTeX → PDF, shortened until it fits one page
 *   7. ATS score from the PDF's own text: 90+ is ready, under 90 waits for
 *      the user ("Waiting on you"), never padded with skills they don't have
 *   8. the PDF goes to cloud storage with a change report
 *
 * Runs in the background; the API returns a `running` row to poll.
 */

import { all, one, run } from '../db.js';
import { complete } from './llm.js';
import { currentMaster, saveForEvaluation, saveCoverLetter } from './resumeFiles.js';
import { atsScore, normalizeKeywords, splitMissing, ATS_TARGET } from './ats.js';
import { guardDraft, addMissingSkills, SHRINK_STEPS, masterText, repoText, unsupportedNumbers } from './resumeGuard.js';
import { resumeTex, coverLetterTex, compileTex } from './latex.js';

const STALE_MINUTES = 15;

// ── JSON schemas (structured outputs: every object closed, every key required) ──

const S = { type: 'string' };
const SA = { type: 'array', items: S };
const obj = (properties) => ({ type: 'object', additionalProperties: false, properties, required: Object.keys(properties) });

export const MASTER_SCHEMA = obj({
  name: S,
  contact: obj({ email: S, phone: S, location: S, links: { type: 'array', items: obj({ label: S, url: S }) } }),
  summary: S,
  education: { type: 'array', items: obj({ school: S, degree: S, field: S, location: S, start: S, end: S, gpa: S, details: SA }) },
  experience: { type: 'array', items: obj({ company: S, title: S, location: S, start: S, end: S, bullets: SA }) },
  projects: { type: 'array', items: obj({ name: S, tech: SA, link: S, start: S, end: S, bullets: SA }) },
  skills: { type: 'array', items: obj({ category: S, items: SA }) },
  extras: { type: 'array', items: obj({ heading: S, items: SA }) },
});

export const DRAFT_SCHEMA = obj({
  summary: S,
  experience: { type: 'array', items: obj({ id: S, bullets: SA }) },
  projects: { type: 'array', items: obj({ source: { type: 'string', enum: ['resume', 'github'] }, ref: S, name: S, tech: SA, bullets: SA, why: S }) },
  skills: { type: 'array', items: obj({ category: S, items: SA }) },
  changes: { type: 'array', items: obj({ section: S, before: S, after: S, why: S }) },
  notes: S,
});

const LETTER_SCHEMA = obj({ greeting: S, paragraphs: SA, closing: S });

// ── Prompts ─────────────────────────────────────────────────────────────────

const PARSE_SYSTEM = `You read a resume's extracted PDF text into sections.
Copy the candidate's words exactly. Do not fix, shorten, merge, reword or add anything.
- One experience entry per job/internship/research role, newest first, with its bullets in order.
- Projects: each named project with its bullets; "tech" is the tools listed for that project.
- Skills: keep the resume's own groups and order.
- extras: any other section (Awards, Certifications, Publications, Leadership, Activities), heading as written.
- Dates as written ("Jun 2025", "2023 – 2027", "Present"). Use "" for anything that isn't there.
- links: LinkedIn, GitHub, portfolio etc. as full URLs when the text shows them.`;

const TAILOR_RULES = `You tailor a student's or new grad's resume for one job. A strict fact-checker runs after you and deletes anything it can't find in the candidate's material, so invented content is wasted space.

Hard rules
1. Use only facts in CANDIDATE MATERIAL below. Never add a skill, tool, metric, employer, title, date, course or outcome that isn't there. Rewording is fine; new claims are not.
2. Keep every number exactly as the material states it. Don't add numbers.
3. Experience: return every job by its id. For each, choose and order up to 4 bullets by relevance to this job, rewritten with the job's vocabulary only where that's still true (material says "retrieval over company docs with embeddings", job says "RAG" → "Built a RAG pipeline…" is fine; claiming "Kubernetes" because the job wants it is not).
4. Projects: pick the 2–3 that best prove the job's requirements, from resume projects (source "resume", ref = project id) or GitHub repos (source "github", ref = full_name). For a repo, write 2 bullets from its README/description only. "why" names the requirement the project proves.
5. Skills: up to 4 groups, most relevant first, only skills that appear in the material.
6. Bullets: start with a strong past-tense verb, one line where possible (under 160 characters), concrete over generic.
7. summary: "" unless the master resume has a summary; if it does, 2 lines at most.
8. changes: every meaningful edit with before (the original text, or "" if new emphasis), after, and why (which job requirement). notes: one or two sentences on the overall angle.
9. The ATS keywords are what the employer's system will look for. Use each one the material supports, in natural sentences. Skip the ones it doesn't support.`;

const LETTER_SYSTEM = `You write a short, specific cover letter for a student or new grad.
- 3 paragraphs, 220–300 words total: why this company and role (from the job description), the two strongest pieces of evidence from the resume for its top requirements, and a plain closing line.
- Use only facts from the resume provided. Every number must be copied exactly from it.
- No clichés ("I am writing to express", "passionate", "perfect fit"), no flattery, no restating the whole resume.
- greeting: "Dear Hiring Manager," unless the job description names the hiring manager or team. closing: "Sincerely,".`;

// ── Pieces ──────────────────────────────────────────────────────────────────

const str = (v) => String(v ?? '').trim();
const parseJson = (text) => JSON.parse(String(text).replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim());

/** Give every job/project a stable id the tailoring step can point at. */
export function withIds(parsed) {
  return {
    ...parsed,
    experience: (parsed.experience || []).map((e, i) => ({ ...e, id: `e${i + 1}` })),
    projects: (parsed.projects || []).map((p, i) => ({ ...p, id: `p${i + 1}` })),
  };
}

async function resumeText(userId) {
  return (await one("SELECT value FROM meta WHERE user_id = $1 AND key = 'user_resume_text'", [userId]))?.value || '';
}

/** The current master resume, read into sections (cached on the file row). */
export async function parsedMaster(userId, { force = false } = {}) {
  const master = await one("SELECT * FROM resume_files WHERE user_id = $1 AND kind = 'master' AND is_current", [userId]);
  if (!master) throw Object.assign(new Error('Upload your master resume on Profile → Resume first.'), { status: 400 });
  if (master.parsed && !force) return { master, parsed: master.parsed, cost: 0 };
  const text = await resumeText(userId);
  if (text.length < 200) throw Object.assign(new Error('Your resume PDF has too little readable text. Export it again so the text can be selected.'), { status: 400 });
  const r = await complete({ task: 'resume_parse', system: PARSE_SYSTEM, user: text.slice(0, 20000), schema: MASTER_SCHEMA, maxTokens: 12000, timeoutMs: 180_000, userId });
  const parsed = withIds(parseJson(r.text));
  await run('UPDATE resume_files SET parsed = $1, parsed_at = NOW() WHERE id = $2', [JSON.stringify(parsed), master.id]);
  return { master, parsed, cost: r.costUsd };
}

export async function extractKeywords({ title, company, description, userId }) {
  const r = await complete({
    task: 'keywords',
    json: true,
    maxTokens: 3000,
    userId,
    system: `You list the terms an applicant tracking system would match a resume against for one job.
Return JSON: {"keywords":[{"term":"Python","aliases":["py"],"importance":"required","kind":"hard"}]}
- 12 to 25 terms. hard = languages, frameworks, tools, platforms, methods, domain areas, degree fields. soft = a few soft skills only if the posting stresses them.
- importance "required" for must-haves / minimum qualifications, else "preferred".
- aliases: other spellings an ATS treats as the same (e.g. "JS" for JavaScript, "k8s" for Kubernetes). Usually none.
- Leave out the company name, benefits, location, pay, EEO text and filler words (team, work, ability).`,
    user: `Job: ${title} at ${company}\n\n${description.slice(0, 7000)}`,
  });
  return { keywords: normalizeKeywords(parseJson(r.text).keywords), cost: r.costUsd };
}

export async function includedRepos(userId) {
  return all(
    `SELECT name, full_name, description, html_url, homepage, language, languages, topics, left(readme, 1500) AS readme
       FROM github_repos WHERE user_id = $1 AND include AND NOT fork AND NOT archived
      ORDER BY pushed_at DESC NULLS LAST LIMIT 12`,
    [userId],
  );
}

async function pdfText(pdf) {
  const { PDFParse } = await import('pdf-parse');
  const parser = new PDFParse({ verbosity: -1, data: pdf });
  await parser.load();
  const r = await parser.getText();
  return Array.isArray(r?.pages) ? r.pages.map(p => p.text || '').join('\n') : String(r || '');
}

/** Compile, shortening step by step until the resume fits on one page. */
export async function renderOnePage(doc) {
  let current = doc;
  let out = await compileTex(resumeTex(current));
  let shrunk = 0;
  for (const step of SHRINK_STEPS) {
    if (out.pages === 1) break;
    const next = step(current);
    if (!next) continue;
    current = next;
    shrunk += 1;
    out = await compileTex(resumeTex(current));
  }
  return { doc: current, pdf: out.pdf, pages: out.pages, shrunk };
}

function candidateMaterial(parsed, repos) {
  const repoBlock = repos.map(r => `- ${r.full_name}${r.description ? `: ${r.description}` : ''}\n  languages: ${Object.keys(r.languages || {}).join(', ') || r.language || 'n/a'}; topics: ${(r.topics || []).join(', ') || 'none'}\n  README: ${str(r.readme).replace(/\s+/g, ' ').slice(0, 1200) || '(none)'}`).join('\n');
  return `CANDIDATE MATERIAL
Master resume (JSON):
${JSON.stringify(parsed)}

GitHub repos the candidate chose to include:
${repoBlock || '(none connected)'}`;
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
  if (str(ev.job_description).length < 200 && ev.job_url) {
    let jd = (await one('SELECT description FROM scraped_roles WHERE apply_url = $1', [ev.job_url]))?.description || '';
    if (str(jd).length < 200) {
      const { fetchJobFromUrl } = await import('./jobEvaluator.js');
      jd = (await fetchJobFromUrl(ev.job_url).catch(() => null))?.text || '';
    }
    if (str(jd).length >= 200) {
      ev.job_description = str(jd).slice(0, 20000);
      await run('UPDATE evaluations SET job_description = $1 WHERE id = $2 AND user_id = $3', [ev.job_description, ev.id, userId]);
    }
  }
  if (str(ev.job_description).length < 200) {
    throw Object.assign(new Error('This role has no job description saved. Evaluate it from the posting URL or paste the description first.'), { status: 400 });
  }
  return ev;
}

/** The tailoring itself. Returns the fields stored on the row. */
export async function tailor(userId, ev) {
  let cost = 0;
  const { master, parsed, cost: c1 } = await parsedMaster(userId);
  cost += c1;
  const { keywords, cost: c2 } = await extractKeywords({ title: ev.job_title, company: ev.company_name, description: ev.job_description, userId });
  cost += c2;
  const repos = await includedRepos(userId);

  const draftRes = await complete({
    task: 'resume',
    system: `${TAILOR_RULES}\n\n${candidateMaterial(parsed, repos)}`,
    user: `JOB: ${ev.job_title} at ${ev.company_name}

ATS KEYWORDS (from the posting): ${keywords.map(k => `${k.term}${k.importance === 'required' ? ' (required)' : ''}`).join(', ')}

JOB DESCRIPTION:
${ev.job_description.slice(0, 7000)}`,
    schema: DRAFT_SCHEMA,
    maxTokens: 16000,
    timeoutMs: 300_000,
    userId,
  });
  cost += draftRes.costUsd;
  const draft = parseJson(draftRes.text);

  const raw = await resumeText(userId);
  const sourceText = `${masterText(parsed)}\n${raw}\n${repos.map(repoText).join('\n')}`;
  let { doc, removed } = guardDraft(draft, parsed, repos, raw);

  // First pass: what does the page say? Then add skills the candidate has but the draft left out.
  let rendered = await renderOnePage(doc);
  let text = await pdfText(rendered.pdf);
  let score = atsScore({ keywords, pdfText: text, doc: rendered.doc, pages: rendered.pages });
  const { inSource } = splitMissing(score.missing, sourceText);
  let addedSkills = [];
  if (inSource.length) {
    const r = addMissingSkills(rendered.doc, inSource);
    addedSkills = r.added;
    if (addedSkills.length) {
      rendered = await renderOnePage(r.doc);
      text = await pdfText(rendered.pdf);
      score = atsScore({ keywords, pdfText: text, doc: rendered.doc, pages: rendered.pages });
    }
  }
  const split = splitMissing(score.missing, sourceText);
  const status = score.score >= ATS_TARGET ? 'ready' : 'needs_review';

  const safe = (s) => str(s).replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 40);
  const file = await saveForEvaluation(userId, ev.id, rendered.pdf, `${safe(parsed.name || 'resume')}-${safe(ev.company_name)}.pdf`, 'tailored');

  const removedText = new Set(removed.map(r => r.what));
  return {
    status,
    master_file_id: master.id,
    file_id: file.id,
    ats_score: score.score,
    ats: {
      score: score.score,
      target: ATS_TARGET,
      coverage: score.coverage,
      keywords,
      matched: score.matched.map(k => k.term),
      missingYouHave: split.inSource.map(k => k.term),
      missingYouDont: split.notInSource.map(k => ({ term: k.term, importance: k.importance })),
      checks: score.checks,
      pages: rendered.pages,
    },
    report: {
      notes: str(draft.notes),
      changes: (draft.changes || []).filter(c => str(c.after) && !removedText.has(str(c.after))),
      projects: rendered.doc.projects.map(p => ({ name: p.name, source: p.source, why: str((draft.projects || []).find(d => str(d.ref) === p.ref)?.why) })),
      removed,
      addedSkills,
      shortenedSteps: rendered.shrunk,
      model: draftRes.model,
      doc: rendered.doc,
    },
    cost_usd: Number(cost.toFixed(5)),
  };
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
  const paragraphs = (letter.paragraphs || []).map(p => str(p).split(/(?<=[.!?])\s+/).filter(sentence => {
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
export async function start(userId, evalId, kind = 'resume') {
  const ev = await loadEvaluation(userId, evalId);
  const busy = await one(
    `SELECT * FROM resume_tailorings WHERE user_id = $1 AND evaluation_id = $2 AND kind = $3 AND status = 'running'
       AND created_at > NOW() - INTERVAL '${STALE_MINUTES} minutes' ORDER BY id DESC LIMIT 1`,
    [userId, ev.id, kind],
  );
  if (busy) return busy;
  if (kind === 'resume') await currentMaster(userId).then(m => { if (!m) throw Object.assign(new Error('Upload your master resume on Profile → Resume first.'), { status: 400 }); });
  const row = (await run(
    'INSERT INTO resume_tailorings (user_id, evaluation_id, kind) VALUES ($1, $2, $3) RETURNING *',
    [userId, ev.id, kind],
  )).rows[0];
  running.add(row.id);
  const job = kind === 'resume' ? tailor(userId, ev) : writeCoverLetter(userId, ev);
  job.then(fields => finish(row.id, fields))
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
    if (r.status === 'running' && !running.has(Number(r.id)) && Date.now() - new Date(r.created_at).getTime() > STALE_MINUTES * 60_000) {
      r.status = 'failed';
      r.error = 'The server restarted while this was running. Try again.';
    }
    out[r.kind] = r;
  }
  return out;
}

/** "Send it anyway" for an under-90 resume. */
export async function approve(userId, tailoringId) {
  const r = await run(
    "UPDATE resume_tailorings SET approved_at = NOW() WHERE id = $1 AND user_id = $2 AND kind = 'resume' AND status = 'needs_review' RETURNING id, evaluation_id",
    [tailoringId, userId],
  );
  return r.rows[0] || null;
}

/** For auto-apply: may this role's resume go out? */
export async function resumeGate(userId, evalId) {
  const t = await one(
    "SELECT status, ats_score, approved_at FROM resume_tailorings WHERE user_id = $1 AND evaluation_id = $2 AND kind = 'resume' AND status <> 'failed' ORDER BY id DESC LIMIT 1",
    [userId, evalId],
  );
  if (!t || t.status === 'ready' || t.approved_at) return { ok: true };
  if (t.status === 'running') return { ok: false, reason: 'The tailored resume for this role is still being written.' };
  return { ok: false, reason: `The tailored resume scored ${t.ats_score}% on the ATS check (target ${ATS_TARGET}%). Review it and choose “Send anyway” or skip the role.` };
}
