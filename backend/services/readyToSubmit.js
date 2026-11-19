/**
 * readyToSubmit.js — approved roles the app couldn't submit (a CAPTCHA, a job
 * site it can't fill), made quick to finish by hand.
 *
 * The Scout'n'Jobs filler (the Chrome extension in /extension) opens the
 * company's application in the user's own browser and fills it there, with
 * the profile, the saved answers and the role's tailored resume. It never
 * touches the CAPTCHA and never presses Submit: the user does both. The
 * extension talks to /api/fill/:token with a signed link made for one role
 * (24 hours), so it needs no sign-in of its own.
 *
 * LinkedIn is never automated: a LinkedIn role goes to the same role on the
 * company's own job board when one is found, else to "apply on LinkedIn by hand".
 */

import { all, one, run } from '../db.js';
import { signExtKey, signFillToken, verifyExtKey, verifyFillToken } from './secretBox.js';
import { normalizeQuestion, pickAnswer } from './answerBank.js';
import { resolveToBoard } from './boardResolver.js';
import { downloadVersionPdf } from './resumeStorage.js';
import { resumeFileName } from './resumeFiles.js';
import { preparedAnswers } from './formQuestions.js';

const str = (v) => String(v ?? '').trim();
const fail = (status, message) => Object.assign(new Error(message), { status });

/** A LinkedIn link (the extension never fills LinkedIn). Pure. */
export function isLinkedIn(url) {
  try { return /(^|\.)linkedin\.com$/i.test(new URL(url).hostname); } catch { return false; }
}

/** Where the form itself is: Lever's on /apply, Ashby's on /application. Pure. */
export function formUrl(url) {
  let u;
  try { u = new URL(url); } catch { return url; }
  const path = u.pathname.replace(/\/$/, '');
  if (u.hostname === 'jobs.lever.co' && path.split('/').length === 3) u.pathname = `${path}/apply`;
  else if (u.hostname === 'jobs.ashbyhq.com' && path.split('/').length === 3) u.pathname = `${path}/application`;
  return u.toString();
}

/** Closing soonest first, then no date, then already closed; ties by longest waiting. Pure. */
export function sortReady(rows, now = new Date()) {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const key = (d) => {
    if (!d) return [1, 0];
    const t = new Date(d).getTime();
    return t < today ? [2, -t] : [0, t];
  };
  return [...rows].sort((a, b) => {
    const [ra, ta] = key(a.deadline);
    const [rb, tb] = key(b.deadline);
    return ra - rb || ta - tb || new Date(a.waiting_since) - new Date(b.waiting_since);
  });
}

/** Kind and link for one role: 'fill' (the extension opens `open_url`) or 'linkedin' (by hand). Pure. */
export function readyKind(applyUrl, boardUrl) {
  if (!isLinkedIn(applyUrl)) return { kind: 'fill', open_url: formUrl(applyUrl) };
  if (boardUrl) return { kind: 'fill', open_url: formUrl(boardUrl) };
  return { kind: 'linkedin', open_url: applyUrl };
}

/** Approved roles waiting on the user to apply ("needs you"), with the company board looked up for LinkedIn ones (once each). */
export async function readyRoles(userId, { resolve = true } = {}) {
  const rows = await all(
    `SELECT pi.id, pi.company_name, pi.title, pi.location, pi.apply_url, pi.stage_note, pi.fill_report,
            COALESCE(pi.apply_deadline, sr.apply_deadline) AS deadline, j.updated_at AS waiting_since
       FROM tailor_jobs j JOIN plan_items pi ON pi.id = j.plan_item_id
       LEFT JOIN scraped_roles sr ON sr.id = pi.scraped_role_id
      WHERE j.user_id = $1 AND j.status = 'approved' AND pi.stage = 'needs_you' AND pi.apply_url IS NOT NULL`,
    [userId],
  );
  if (resolve) {
    const unchecked = rows.filter(r => isLinkedIn(r.apply_url) && !r.fill_report?.board_checked_at).slice(0, 8);
    await Promise.all(unchecked.map(async (r) => {
      const hit = await Promise.race([
        resolveToBoard(r.company_name, r.title).catch(() => null),
        new Promise(ok => setTimeout(() => ok(undefined), 8000)),
      ]);
      if (hit === undefined) return; // too slow this time: try again next load
      const patch = { board_url: hit?.url || null, board_checked_at: new Date().toISOString() };
      r.fill_report = { ...(r.fill_report || {}), ...patch };
      await run("UPDATE plan_items SET fill_report = COALESCE(fill_report, '{}'::jsonb) || $2::jsonb WHERE id = $1", [r.id, JSON.stringify(patch)]);
    }));
  }
  // Each role's prepared answers, counted by status.
  const counts = new Map((await all(
    `SELECT plan_item_id::text AS id, COUNT(*) FILTER (WHERE status = 'ready')::int AS ready, COUNT(*) FILTER (WHERE status = 'writing')::int AS writing,
            COUNT(*) FILTER (WHERE status = 'needs_you')::int AS needs_you, COUNT(*) FILTER (WHERE status = 'profile')::int AS profile
       FROM role_answers WHERE user_id = $1 AND plan_item_id = ANY($2::bigint[]) GROUP BY 1`,
    [userId, rows.map(r => r.id)],
  )).map(c => [c.id, c])) ;
  return sortReady(rows.map(r => {
    const f = r.fill_report || {};
    return {
      id: String(r.id), company: r.company_name, title: r.title, location: r.location, deadline: r.deadline, waiting_since: r.waiting_since,
      why: r.stage_note, apply_url: r.apply_url, ...readyKind(r.apply_url, f.board_url),
      filled_at: f.filled_at || null, filled: f.filled ?? null, unanswered: f.unanswered || [], resume_attached: f.resume_attached ?? null,
      prepared_at: f.prepared_at || null, posting_closed: Boolean(f.posting_closed), form_url: f.form_url || null,
      answers: counts.get(String(r.id)) || null,
    };
  }));
}

/** A signed link for the extension to fill one role, and where to open it. */
export async function fillLink(userId, planItemId) {
  const role = (await readyRoles(userId, { resolve: false })).find(r => r.id === String(planItemId));
  if (!role) throw fail(404, 'That role isn’t waiting to be submitted.');
  if (role.kind !== 'fill') throw fail(409, 'This one is LinkedIn only: apply on LinkedIn by hand.');
  return { token: signFillToken(userId, role.id), url: role.open_url, company: role.company, title: role.title };
}

function tokenOrFail(token) {
  const t = verifyFillToken(token);
  if (!t) throw fail(401, 'This fill link has expired. Press Open again in Scout’n’Jobs.');
  return t;
}

const yes = (v) => v === true || v === 1 || /^(1|true|yes)$/i.test(str(v));

/** What the extension fills in: the profile, the role, and its tailored resume (base64). */
export async function fillData(token) {
  const { userId, planItemId } = tokenOrFail(token);
  const item = await one('SELECT id, company_name, title, apply_url FROM plan_items WHERE id = $1 AND user_id = $2', [planItemId, userId]);
  if (!item) throw fail(404, 'Role not found.');
  const [p, v] = await Promise.all([
    one('SELECT * FROM user_profile WHERE user_id = $1', [userId]),
    one('SELECT pdf_path FROM resume_versions WHERE plan_item_id = $1 AND user_id = $2 AND pdf_path IS NOT NULL ORDER BY is_final DESC, version DESC LIMIT 1', [planItemId, userId]),
  ]);
  if (!v) throw fail(409, 'This role has no resume PDF yet.');
  const pdf = await downloadVersionPdf(v.pdf_path);
  const first = str(p?.first_name);
  const last = str(p?.last_name);
  const grad = str(p?.graduation_date);
  const demographics = yes(p?.demographic_consent);
  return {
    role: { id: String(item.id), company: item.company_name, title: item.title },
    profile: {
      first_name: first, last_name: last, full_name: [first, last].filter(Boolean).join(' '),
      email: str(p?.email), phone: str(p?.phone),
      linkedin: str(p?.linkedin_url), github: str(p?.github_url), portfolio: str(p?.portfolio_url),
      address: str(p?.address), city: str(p?.city), state: str(p?.state_province), postal: str(p?.postal_code), country: str(p?.country),
      location: str(p?.location),
      school: str(p?.education_school), degree: str(p?.education_degree), major: str(p?.education_major), gpa: str(p?.gpa),
      graduation: grad, graduation_year: (grad.match(/\b(20\d\d)\b/) || [])[1] || '', graduation_month: (grad.match(/^[A-Za-z]+/) || [])[0] || '',
      needs_sponsorship: p?.needs_sponsorship == null ? null : yes(p.needs_sponsorship),
      willing_to_relocate: p?.willing_to_relocate == null ? null : yes(p.willing_to_relocate),
      // Self-identification only when the user said the app may answer it.
      gender: demographics ? str(p?.gender) : '', race: demographics ? str(p?.race) : '',
      veteran: demographics ? str(p?.veteran_status) : '', disability: demographics ? str(p?.disability_status) : '',
    },
    resume: { filename: resumeFileName([first, last].filter(Boolean).join(' ')), base64: Buffer.from(pdf).toString('base64') },
    // Prepared last night (and by your Claude run): question → answer.
    answers: await preparedAnswers(planItemId),
  };
}

/**
 * Saved answers for the form's questions. A question with no saved answer
 * comes back null and is saved as pending (Profile → Answers), so it's asked once.
 */
export async function fillAnswers(token, questions) {
  const { userId, planItemId } = tokenOrFail(token);
  const qs = [...new Set((Array.isArray(questions) ? questions : []).map(q => str(q).slice(0, 1000)).filter(q => normalizeQuestion(q)))].slice(0, 80);
  const [saved, prepared] = await Promise.all([
    all('SELECT id, question, question_key, answer, status FROM application_answers WHERE user_id = $1', [userId]),
    all("SELECT id, question, question_key, answer, CASE WHEN status = 'ready' THEN 'answered' ELSE status END AS status FROM role_answers WHERE plan_item_id = $1 AND user_id = $2", [planItemId, userId]),
  ]);
  const answers = {};
  const used = [];
  const missing = [];
  for (const q of qs) {
    // This role's prepared answer first, then your saved ones.
    const mine = pickAnswer(q, prepared, 0.8);
    const hit = mine || pickAnswer(q, saved);
    answers[q] = hit ? hit.answer : null;
    if (hit && !mine) used.push(hit.id);
    if (!hit && !prepared.some(p => p.question_key === normalizeQuestion(q))) missing.push(q);
  }
  if (used.length) await run('UPDATE application_answers SET use_count = use_count + 1, last_used_at = NOW() WHERE id = ANY($1::bigint[])', [used]);
  // A question the form asked that wasn't read ahead (Workday, a step that appears later): your Claude run answers it next.
  if (missing.length) {
    await run(
      `INSERT INTO role_answers (user_id, plan_item_id, question, question_key, status)
       SELECT $1, $2, q, k, 'writing' FROM unnest($3::text[], $4::text[]) AS u(q, k)
       ON CONFLICT (plan_item_id, question_key) DO NOTHING`,
      [userId, planItemId, missing, missing.map(normalizeQuestion)],
    );
  }
  return { answers };
}

/** What the extension filled, and the questions left for the user, shown in the list. */
export async function fillReport(token, { filled, unanswered, resumeAttached } = {}) {
  const { userId, planItemId } = tokenOrFail(token);
  const patch = {
    filled_at: new Date().toISOString(),
    filled: Math.max(0, Math.min(500, Number(filled) || 0)),
    unanswered: (Array.isArray(unanswered) ? unanswered : []).map(q => str(q).slice(0, 200)).filter(Boolean).slice(0, 30),
    resume_attached: Boolean(resumeAttached),
  };
  await run("UPDATE plan_items SET fill_report = COALESCE(fill_report, '{}'::jsonb) || $3::jsonb WHERE id = $1 AND user_id = $2", [planItemId, userId, JSON.stringify(patch)]);
  return { ok: true };
}

/** The user submitted (they pressed I submitted it, or the extension saw the confirmation page): the role is Applied. */
export async function fillSubmitted(token) {
  const { userId, planItemId } = tokenOrFail(token);
  const job = await one('SELECT status FROM tailor_jobs WHERE user_id = $1 AND plan_item_id = $2', [userId, planItemId]);
  if (job?.status === 'applied') return { ok: true, already: true };
  const { markRoleApplied } = await import('./tailorPipeline.js');
  await markRoleApplied(userId, planItemId);
  return { ok: true };
}

/** The extension's key for this user (the app passes it to the extension; every visit renews it). */
export function extensionKey(userId) {
  return { key: signExtKey(userId) };
}

function keyOrFail(key) {
  const userId = verifyExtKey(key);
  if (!userId) throw fail(401, 'The filler isn’t paired. Open Scout’n’Jobs once in this browser.');
  return userId;
}

/** Each morning: every ready role the extension can fill, with a fresh link. Closed postings stay out. */
export async function dailyRoles(key) {
  const userId = keyOrFail(key);
  const roles = (await readyRoles(userId, { resolve: false })).filter(r => r.kind === 'fill' && !r.posting_closed);
  return { roles: roles.map(r => ({ id: r.id, company: r.company, title: r.title, url: r.open_url, token: signFillToken(userId, r.id) })) };
}

/** Same posting? Host and path, ignoring the trailing /apply or /application and the query. Pure. */
export function samePosting(a, b) {
  const key = (x) => {
    try {
      const u = new URL(x);
      if (/greenhouse\.io$/.test(u.hostname)) {
        const id = u.searchParams.get('token') || u.searchParams.get('gh_jid') || (u.pathname.match(/\/jobs\/(\d+)/) || [])[1];
        if (id) return `gh:${id}`;
      }
      if (u.searchParams.get('gh_jid')) return `gh:${u.searchParams.get('gh_jid')}`;
      return `${u.hostname.replace(/^www\./, '')}${u.pathname.replace(/\/(apply|application)\/?$/, '').replace(/\/$/, '')}`.toLowerCase();
    } catch { return null; }
  };
  const ka = key(a);
  return Boolean(ka) && ka === key(b);
}

/** A job page the user opened themselves: the ready role it is, with a link to fill it, or null. */
export async function matchRole(key, urls) {
  const userId = keyOrFail(key);
  const list = (Array.isArray(urls) ? urls : [urls]).map(str).filter(Boolean).slice(0, 3);
  const roles = (await readyRoles(userId, { resolve: false })).filter(r => r.kind === 'fill');
  const hit = roles.find(r => list.some(u => [r.open_url, r.apply_url, r.form_url].filter(Boolean).some(x => samePosting(u, x))));
  return hit ? { role: { id: hit.id, company: hit.company, title: hit.title, url: hit.open_url, token: signFillToken(userId, hit.id) } } : { role: null };
}
