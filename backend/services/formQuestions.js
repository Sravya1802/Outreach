/**
 * formQuestions.js — each ready role's application questions, read every
 * night from the job board, with an answer prepared for each one before the
 * filler extension opens the form:
 *   • the profile's (name, email, school, sponsorship…): the filler fills those live
 *   • your saved Application answers, when one matches
 *   • otherwise an open question for your hourly Claude run to answer from
 *     master_latex (role_answers status 'writing'; tailoring_config says how)
 * Boards: Greenhouse (boards API), Ashby (its public GraphQL), Lever (the
 * apply page). Workday needs a sign-in, so its questions are read in the form.
 * Only these fixed hosts are fetched. A posting the board says is gone is
 * marked closed (fill_report.posting_closed) for the Ready list to say so.
 */

import { all, run } from '../db.js';
import { normalizeQuestion, pickAnswer } from './answerBank.js';

const str = (v) => String(v ?? '').trim();
const TIMEOUT = 12_000;
const UA = { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36' };

/** Which board a form link is on, and its ids. Pure. null for anything else. */
export function parseBoard(url) {
  let u;
  try { u = new URL(url); } catch { return null; }
  const host = u.hostname.toLowerCase();
  const parts = u.pathname.split('/').filter(Boolean);
  if (host === 'grnh.se') return { board: 'greenhouse-short', url: u.toString() };
  if (/(^|\.)greenhouse\.io$/.test(host)) {
    if (parts[0] === 'embed') {
      const id = u.searchParams.get('token');
      const org = u.searchParams.get('for');
      return id && org ? { board: 'greenhouse', org, id } : null;
    }
    const i = parts.indexOf('jobs');
    if (i >= 1 && /^\d+$/.test(parts[i + 1] || '')) return { board: 'greenhouse', org: parts[i - 1], id: parts[i + 1] };
    return null;
  }
  if (host === 'jobs.ashbyhq.com' && parts.length >= 2) return { board: 'ashby', org: parts[0], id: parts[1] };
  if (host === 'jobs.lever.co' && parts.length >= 2) return { board: 'lever', org: parts[0], id: parts[1] };
  if (/(^|\.)myworkdayjobs\.com$/.test(host)) return { board: 'workday' };
  return null;
}

async function get(url, init = {}) {
  return fetch(url, { ...init, headers: { ...UA, ...(init.headers || {}) }, signal: AbortSignal.timeout(TIMEOUT) });
}

/** grnh.se short links: where they go (the posting, or the board's "?error=true" when it's gone). */
async function followShort(url) {
  let at = url;
  for (let i = 0; i < 4; i += 1) {
    const r = await get(at, { redirect: 'manual' });
    const next = r.headers.get('location');
    if (!next || r.status < 300 || r.status >= 400) return at;
    at = new URL(next, at).toString();
    if (/[?&]error=true/.test(at)) return at;
  }
  return at;
}

const FIELD_TYPE = { input_text: 'text', textarea: 'long_text', input_file: 'file', multi_value_single_select: 'select', multi_value_multi_select: 'multi_select', input_hidden: 'hidden' };

async function greenhouse({ org, id }) {
  const r = await get(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(org)}/jobs/${encodeURIComponent(id)}?questions=true`);
  if (r.status === 404) return { closed: true, questions: [] };
  if (!r.ok) throw new Error(`Greenhouse answered ${r.status}`);
  const d = await r.json();
  const questions = [...(d.questions || []), ...(d.location_questions || [])].map((q) => {
    const f = (q.fields || []).find(x => x.type !== 'input_file') || q.fields?.[0] || {};
    return { question: str(q.label), type: FIELD_TYPE[f.type] || f.type || 'text', options: (f.values || []).map(v => str(v.label)).filter(Boolean), required: Boolean(q.required) };
  });
  return { closed: false, questions, form_url: `https://job-boards.greenhouse.io/${org}/jobs/${id}` };
}

const ASHBY_QUERY = 'query ApiJobPosting($organizationHostedJobsPageName: String!, $jobPostingId: String!) { jobPosting(organizationHostedJobsPageName: $organizationHostedJobsPageName, jobPostingId: $jobPostingId) { id title applicationForm { sections { fieldEntries { ... on FormFieldEntry { id field isRequired } } } } } }';
const ASHBY_TYPE = { String: 'text', Email: 'text', Phone: 'text', LongText: 'long_text', File: 'file', Boolean: 'yes_no', Date: 'date', Number: 'number', ValueSelect: 'select', MultiValueSelect: 'multi_select', Location: 'location', Score: 'select' };

async function ashby({ org, id }) {
  const r = await get('https://jobs.ashbyhq.com/api/non-user-graphql?op=ApiJobPosting', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ operationName: 'ApiJobPosting', variables: { organizationHostedJobsPageName: org, jobPostingId: id }, query: ASHBY_QUERY }),
  });
  if (!r.ok) throw new Error(`Ashby answered ${r.status}`);
  const d = await r.json();
  const p = d?.data?.jobPosting;
  if (!p) return { closed: true, questions: [] };
  const questions = (p.applicationForm?.sections || []).flatMap(s => s.fieldEntries || []).filter(e => e?.field).map(e => ({
    question: str(e.field.title), type: ASHBY_TYPE[e.field.type] || str(e.field.type).toLowerCase(),
    options: (e.field.selectableValues || []).map(v => str(v.label)).filter(Boolean), required: Boolean(e.isRequired),
  }));
  return { closed: false, questions, form_url: `https://jobs.ashbyhq.com/${org}/${id}/application` };
}

const decode = (s) => s.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

/** Lever's questions from the apply page's HTML (each in an application-question block). Pure. */
export function leverQuestions(html) {
  const out = [];
  const blocks = String(html).split(/<li class="application-question/).slice(1);
  for (const whole of blocks) {
    // A question's block ends where the next section starts (the EEO questions follow the last one).
    const b = whole.split(/<div class="section|class="eeo|application-additional/)[0];
    const label = b.match(/class="application-label[^"]*"[^>]*>([\s\S]*?)<\/div>/);
    if (!label) continue;
    const raw = decode(label[1]);
    const required = /✱/.test(raw) || /\brequired\b/.test(b.slice(0, 2000));
    const question = raw.replace(/\s*✱\s*$/, '').trim();
    if (!question) continue;
    const body = b.slice(0, 6000);
    const type = /type="file"/.test(body) ? 'file' : /<select/.test(body) ? 'select' : /type="radio"/.test(body) ? 'radio' : /type="checkbox"/.test(body) ? 'multi_select' : /<textarea/.test(body) ? 'long_text' : 'text';
    const options = [...body.matchAll(/<option[^>]*>([\s\S]*?)<\/option>|type="(?:radio|checkbox)"[^>]*value="([^"]*)"/g)].map(m => decode(m[1] ?? m[2] ?? '')).filter(o => o && !/^select/i.test(o));
    out.push({ question, type, options, required });
  }
  return out;
}

async function lever({ org, id }) {
  const r = await get(`https://jobs.lever.co/${encodeURIComponent(org)}/${encodeURIComponent(id)}/apply`);
  if (r.status === 404) return { closed: true, questions: [] };
  if (!r.ok) throw new Error(`Lever answered ${r.status}`);
  return { closed: false, questions: leverQuestions(await r.text()), form_url: `https://jobs.lever.co/${org}/${id}/apply` };
}

/** A form's questions: { closed, questions: [{ question, type, options, required }], form_url }, or null when the board isn't read ahead. */
export async function fetchQuestions(url) {
  let b = parseBoard(url);
  if (b?.board === 'greenhouse-short') {
    const to = await followShort(b.url);
    if (/[?&]error=true/.test(to)) return { closed: true, questions: [], form_url: to };
    b = parseBoard(to);
  }
  if (!b) return null;
  if (b.board === 'greenhouse') return greenhouse(b);
  if (b.board === 'ashby') return ashby(b);
  if (b.board === 'lever') return lever(b);
  return null; // Workday: read in the form
}

// The filler answers these from the profile, live.
const PROFILE = [
  /^(first|last|full|legal|preferred)?\s*(first |last )?name$/i, /^(first|last|given|family) name/i, /\be-?mail\b/i, /\bphone|mobile\b/i,
  /linkedin/i, /github/i, /\b(portfolio|website|personal site)\b/i, /^(current )?location\b|^address|^city\b|^state\b|^zip|postal|^country\b/i,
  /\b(school|university|college)\b/i, /\bdegree\b/i, /\b(major|discipline|field of study)\b/i, /\bgpa\b|grade point/i, /\bgraduat/i,
  /^resume|^cv\b|cover letter|transcript/i,
];
// These the filler answers from the profile however long the question is.
const PROFILE_ANY_LENGTH = /sponsor|relocat|authori[sz]ed to work|legally (authori[sz]ed|eligible)|work authori[sz]ation|\bgender\b|\brace\b|ethnic|hispanic|latin[oax]|veteran|disabilit/i;
/** Is this a question the profile answers (the filler does it live)? Pure. */
export function isProfileQuestion(q, type) {
  if (type === 'file' || type === 'hidden') return true;
  const s = str(q);
  return PROFILE_ANY_LENGTH.test(s) || (s.length <= 160 && PROFILE.some(re => re.test(s)));
}

/** What each question gets, and where from. Pure: rows are the saved answers; existing are this role's earlier ones by key. */
export function planAnswers(questions, saved, existing = new Map()) {
  return questions.filter(q => q.question && q.type !== 'hidden').map((q) => {
    const key = normalizeQuestion(q.question);
    const was = existing.get(key);
    if (isProfileQuestion(q.question, q.type)) return { ...q, key, status: 'profile', source: 'profile', answer: null };
    // Your answer, or one your run already wrote, stays.
    if (was && ['you', 'claude'].includes(was.source) && was.status === 'ready') return { ...q, key, status: 'ready', source: was.source, answer: was.answer };
    if (was?.status === 'needs_you') return { ...q, key, status: 'needs_you', source: null, answer: null, note: was.note };
    const hit = pickAnswer(q.question, saved);
    if (hit) return { ...q, key, status: 'ready', source: 'saved', answer: hit.answer };
    return { ...q, key, status: 'writing', source: null, answer: null };
  });
}

/** Read one role's form and save its prepared answers. */
export async function prepareRole(userId, role) {
  const url = role.open_url || role.apply_url;
  const got = await fetchQuestions(url);
  const patch = { prepared_at: new Date().toISOString() };
  if (!got) {
    patch.prepare_note = 'Workday or another site: questions are read when the form opens.';
  } else if (got.closed) {
    patch.posting_closed = true;
    patch.form_url = got.form_url || null;
  } else {
    patch.posting_closed = false;
    patch.form_url = got.form_url || null;
    const [saved, prev] = await Promise.all([
      all('SELECT id, question, question_key, answer, status FROM application_answers WHERE user_id = $1', [userId]),
      all('SELECT question_key, answer, source, status, note FROM role_answers WHERE plan_item_id = $1', [role.id]),
    ]);
    const plan = planAnswers(got.questions, saved, new Map(prev.map(p => [p.question_key, p])));
    if (plan.length) {
      await run(
        `INSERT INTO role_answers (user_id, plan_item_id, question, question_key, field_type, options, required, answer, source, status, note)
         SELECT $1, $2, u.q, u.k, u.t, u.o::jsonb, u.r, u.a, u.s, u.st, u.n
           FROM unnest($3::text[], $4::text[], $5::text[], $6::text[], $7::boolean[], $8::text[], $9::text[], $10::text[], $11::text[]) AS u(q, k, t, o, r, a, s, st, n)
         ON CONFLICT (plan_item_id, question_key) DO UPDATE SET question = EXCLUDED.question, field_type = EXCLUDED.field_type, options = EXCLUDED.options,
           required = EXCLUDED.required, answer = EXCLUDED.answer, source = EXCLUDED.source, status = EXCLUDED.status, note = EXCLUDED.note, updated_at = NOW()
         WHERE role_answers.status IS DISTINCT FROM EXCLUDED.status OR role_answers.answer IS DISTINCT FROM EXCLUDED.answer OR role_answers.options IS DISTINCT FROM EXCLUDED.options`,
        [userId, role.id, plan.map(p => p.question.slice(0, 1000)), plan.map(p => p.key), plan.map(p => p.type || null), plan.map(p => JSON.stringify(p.options || [])),
          plan.map(p => p.required), plan.map(p => p.answer ?? null), plan.map(p => p.source ?? null), plan.map(p => p.status), plan.map(p => p.note ?? null)],
      );
    }
    patch.questions = plan.length;
    patch.writing = plan.filter(p => p.status === 'writing').length;
  }
  await run("UPDATE plan_items SET fill_report = COALESCE(fill_report, '{}'::jsonb) || $2::jsonb WHERE id = $1", [role.id, JSON.stringify(patch)]);
  return { id: role.id, company: role.company, ...patch };
}

/** Every user's ready roles, every night. One failure doesn't stop the rest. */
export async function prepareAllForms() {
  const { readyRoles } = await import('./readyToSubmit.js');
  const users = await all("SELECT DISTINCT j.user_id FROM tailor_jobs j JOIN plan_items pi ON pi.id = j.plan_item_id WHERE j.status = 'approved' AND pi.stage = 'needs_you'");
  const out = [];
  for (const { user_id: userId } of users) {
    for (const role of (await readyRoles(userId, { resolve: false })).filter(r => r.kind === 'fill')) {
      out.push(await prepareRole(userId, role).catch(err => ({ id: role.id, company: role.company, error: err.message })));
    }
  }
  return out;
}

/** This role's prepared answers the filler can use now, by question. */
export async function preparedAnswers(planItemId) {
  const rows = await all("SELECT question, answer FROM role_answers WHERE plan_item_id = $1 AND status = 'ready' AND answer IS NOT NULL", [planItemId]);
  return Object.fromEntries(rows.map(r => [r.question, r.answer]));
}

