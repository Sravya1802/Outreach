/**
 * tailorPipeline.js — the app's side of the Claude chat runs. A run writes each
 * role's LaTeX, report and outreach drafts straight to the database; this checks
 * what it wrote and serves the review screens.
 *
 *   checkNewVersions (cron): compiles each new resume_versions row, saves the PDF
 *     at resumes/{plan_item_id}/v{n}.pdf and checks it. A version that breaks a
 *     rule is flagged and can't be approved; one that won't compile has no PDF.
 *   reviewQueue / lastRun / reviewRole: what the Review queue and Role pages show.
 *   requestRevision, setReferralMode, editDraft, approveRole: the user's actions.
 *     Approving only records the decision for now: Gmail drafts and applying
 *     aren't connected to this queue yet, so nothing leaves the app from here.
 */
import { all, one, run, tx } from '../db.js';
import { compileTex } from './latex.js';
import { pdfText } from './resumeEngine.js';
import { roleKind } from './resumeRules.js';
import { downloadVersionPdf, uploadVersionPdf } from './resumeStorage.js';

export const REFERRAL_MODES = ['recruiters', 'recruiters_engineers', 'my_contact', 'none'];
const NOTE_LIMIT = 300;

const LATENCY = /\b\d+(?:\.\d+)?\s?(?:ns|µs|μs)\b|\b\d+K\+?\s+orders\b/i;
const DAILY_500GB = /500\s?GB[^.]{0,120}\bdaily\b|\bdaily\b[^.]{0,120}500\s?GB/i;
const MS_GPA = /\b(master|m\.?s\.?c?)\b[^\n]*\bgpa\b/i;

const fail = (status, message) => Object.assign(new Error(message), { status });

/** roleKind misses a trading firm's plain "Software Engineer" posting, which only says quantitative. */
export function isQuantRole({ title = '', company = '', description = '' } = {}) {
  const jd = String(description);
  return roleKind({ title, company, description: jd }).quant
    || (/\b(financial markets|trading)\b/i.test(jd) && /\bquantitative\b/i.test(jd));
}

/** What's wrong with a compiled resume, in words the user reads; empty when it passes. */
export function checkResume({ text, pages, quant = false }) {
  const body = String(text || '');
  const flat = body.replace(/\s+/g, ' ');
  const errors = [];
  if (pages !== 1) errors.push(`It runs to ${pages ?? 'an unknown number of'} pages. A resume is one page.`);
  if (body.includes('—')) errors.push('It has an em dash.');
  if (MS_GPA.test(body)) errors.push('It shows the MS GPA.');
  if (/relocat/i.test(body)) errors.push('It has a relocation line.');
  if (DAILY_500GB.test(flat)) errors.push('It calls the 500GB dataset daily. It was one dataset.');
  const latency = quant ? null : flat.match(LATENCY);
  if (latency) errors.push(`It cites ${latency[0]} on a role that isn't quant.`);
  return errors;
}

const squash = (s) => String(s).toLowerCase().replace(/[^a-z0-9+#]/g, '');

/** How many of the report's keywords are in the text; "A / B" counts if either is. */
export function keywordCheck(text, table) {
  const flat = squash(text);
  const list = (Array.isArray(table) ? table : []).map(k => String(k?.keyword || '')).filter(Boolean);
  const missing = list.filter(k => !k.split(/\s*\/\s*/).some(part => flat.includes(squash(part))));
  return { found: list.length - missing.length, total: list.length, missing };
}

async function checkVersion(v) {
  let built;
  try {
    built = await compileTex(v.latex);
  } catch (err) {
    await run("UPDATE resume_versions SET check_status = 'flagged', check_errors = $2, checked_at = NOW() WHERE id = $1", [v.id, JSON.stringify([err.message])]);
    return;
  }
  const text = await pdfText(built.pdf);
  const errors = checkResume({ text, pages: built.pages, quant: isQuantRole({ title: v.title, company: v.company_name, description: v.description }) });
  // A storage failure throws before anything is saved, so the next pass tries again.
  const path = await uploadVersionPdf(v.plan_item_id, v.version, built.pdf);
  await run(
    'UPDATE resume_versions SET pdf_path = $2, pages = $3, check_status = $4, check_errors = $5, keywords = $6, checked_at = NOW() WHERE id = $1',
    [v.id, path, built.pages, errors.length ? 'flagged' : 'passed', JSON.stringify(errors), JSON.stringify(keywordCheck(text, v.report?.keyword_table))],
  );
}

let checking = false;

/** Compile and check the versions runs have written since the last pass. */
export async function checkNewVersions(limit = 10) {
  if (checking) return 0;
  checking = true;
  try {
    const rows = await all(
      `SELECT v.id, v.plan_item_id, v.version, v.latex, v.report, pi.title, pi.company_name, COALESCE(pi.job_description, sr.description) AS description
         FROM resume_versions v JOIN plan_items pi ON pi.id = v.plan_item_id LEFT JOIN scraped_roles sr ON sr.id = pi.scraped_role_id
        WHERE v.checked_at IS NULL ORDER BY v.created_at LIMIT $1`,
      [limit],
    );
    for (const v of rows) await checkVersion(v).catch(err => console.warn('[review] check failed', v.id, err.message));
    return rows.length;
  } finally {
    checking = false;
  }
}

/** Every role in the queue, with its latest version. place is its turn among the waiting roles, in claim_tailor_jobs' order. */
export async function reviewQueue(userId) {
  return all(
    `SELECT j.plan_item_id AS id, j.status, j.referral_mode, j.updated_at, j.locked_at, j.locked_by_run AS run,
            COALESCE(sr.posted_at, pi.created_at) AS posted_at, pi.company_name, pi.title, pi.location, pi.score,
            CASE WHEN j.status = 'queued'
                 THEN (ROW_NUMBER() OVER (PARTITION BY j.status ORDER BY j.priority DESC, COALESCE(sr.posted_at, pi.created_at) DESC))::int END AS place,
            v.version, v.ats_after, v.callback_after, v.check_status, v.report->>'eligibility_flag' AS eligibility,
            (SELECT COUNT(*)::int FROM resume_comments c WHERE c.plan_item_id = j.plan_item_id AND c.status = 'open') AS open_comments,
            (SELECT COUNT(*)::int FROM outreach_drafts d WHERE d.plan_item_id = j.plan_item_id) AS outreach
       FROM tailor_jobs j JOIN plan_items pi ON pi.id = j.plan_item_id
       LEFT JOIN scraped_roles sr ON sr.id = j.scraped_role_id
       LEFT JOIN LATERAL (SELECT * FROM resume_versions x WHERE x.plan_item_id = j.plan_item_id ORDER BY x.version DESC LIMIT 1) v ON TRUE
      WHERE j.user_id = $1
      ORDER BY place NULLS LAST, j.updated_at DESC, j.id DESC`,
    [userId],
  );
}

/** The latest run, finished or not. */
export async function lastRun(userId) {
  return one('SELECT id, started_at, finished_at, roles_done, roles_failed FROM pipeline_runs WHERE user_id = $1 ORDER BY id DESC LIMIT 1', [userId]);
}

/** One role: the versions (newest first), the comments and the outreach. */
export async function reviewRole(userId, planItemId) {
  const role = await one(
    `SELECT j.plan_item_id AS id, j.status, j.referral_mode, pi.company_name, pi.title, pi.location, pi.score, pi.apply_url
       FROM tailor_jobs j JOIN plan_items pi ON pi.id = j.plan_item_id WHERE j.user_id = $1 AND j.plan_item_id = $2`,
    [userId, planItemId],
  );
  if (!role) return null;
  const [versions, comments, outreach] = await Promise.all([
    all(
      `SELECT id, version, ats_before, ats_after, callback_before, callback_after, report, change_log, is_final, pages, check_status, check_errors,
              keywords, pdf_path IS NOT NULL AS has_pdf, created_at
         FROM resume_versions WHERE user_id = $1 AND plan_item_id = $2 ORDER BY version DESC`,
      [userId, planItemId],
    ),
    all('SELECT id, version_id, body, status, addressed_in_version, created_at FROM resume_comments WHERE user_id = $1 AND plan_item_id = $2 ORDER BY created_at', [userId, planItemId]),
    all(
      `SELECT d.id, d.audience, d.email_subject, d.email_body, d.linkedin_note, d.status, c.name, c.title, c.email, c.linkedin_url
         FROM outreach_drafts d LEFT JOIN job_contacts c ON c.id = d.contact_id WHERE d.user_id = $1 AND d.plan_item_id = $2 ORDER BY d.audience DESC, d.id`,
      [userId, planItemId],
    ),
  ]);
  return { role, versions, comments, outreach };
}

/** A version's PDF, if it's the user's and it compiled. */
export async function versionPdf(userId, versionId) {
  const v = await one('SELECT pdf_path FROM resume_versions WHERE user_id = $1 AND id = $2', [userId, versionId]);
  return v?.pdf_path ? downloadVersionPdf(v.pdf_path) : null;
}

/** The comment goes to the next run, which writes the next version. */
export async function requestRevision(userId, planItemId, body) {
  const text = String(body ?? '').trim();
  if (!text) throw fail(400, 'Write what should change.');
  const job = await one('SELECT status FROM tailor_jobs WHERE user_id = $1 AND plan_item_id = $2', [userId, planItemId]);
  if (!job) throw fail(404, 'That role isn’t in the queue.');
  if (job.status === 'in_progress') throw fail(409, 'A run is working on this role. Try again when it finishes.');
  if (!['ready', 'revision_requested', 'approved'].includes(job.status)) throw fail(409, 'This role can’t be revised now.');
  const latest = await one('SELECT id FROM resume_versions WHERE user_id = $1 AND plan_item_id = $2 ORDER BY version DESC LIMIT 1', [userId, planItemId]);
  if (!latest) throw fail(409, 'There’s no resume to revise yet.');
  await tx(async (t) => {
    await t.query('INSERT INTO resume_comments (user_id, plan_item_id, version_id, body) VALUES ($1, $2, $3, $4)', [userId, planItemId, latest.id, text]);
    await t.query('UPDATE resume_versions SET is_final = FALSE WHERE user_id = $1 AND plan_item_id = $2', [userId, planItemId]);
    await t.query("UPDATE tailor_jobs SET status = 'revision_requested', updated_at = NOW() WHERE user_id = $1 AND plan_item_id = $2", [userId, planItemId]);
  });
}

export async function setReferralMode(userId, planItemId, mode) {
  if (!REFERRAL_MODES.includes(mode)) throw fail(400, 'Pick a referral mode.');
  const row = await one('UPDATE tailor_jobs SET referral_mode = $3, updated_at = NOW() WHERE user_id = $1 AND plan_item_id = $2 RETURNING plan_item_id', [userId, planItemId, mode]);
  if (!row) throw fail(404, 'That role isn’t in the queue.');
}

/** Emails and notes change by hand only; a run never revises them. */
export async function editDraft(userId, draftId, { email_subject, email_body, linkedin_note }) {
  const note = String(linkedin_note ?? '').trim();
  if (note.length > NOTE_LIMIT) throw fail(400, `A LinkedIn note can be ${NOTE_LIMIT} characters at most.`);
  const draft = await one('SELECT status FROM outreach_drafts WHERE user_id = $1 AND id = $2', [userId, draftId]);
  if (!draft) throw fail(404, 'That draft is gone.');
  if (draft.status === 'sent') throw fail(409, 'That one has already gone out.');
  await run(
    "UPDATE outreach_drafts SET email_subject = $3, email_body = $4, linkedin_note = $5, status = 'edited', updated_at = NOW() WHERE user_id = $1 AND id = $2",
    [userId, draftId, String(email_subject ?? '').trim() || null, String(email_body ?? '').trim() || null, note || null],
  );
}

/** Marks the latest version final. A flagged or uncompiled version can't be approved. */
export async function approveRole(userId, planItemId) {
  const job = await one('SELECT status FROM tailor_jobs WHERE user_id = $1 AND plan_item_id = $2', [userId, planItemId]);
  if (!job) throw fail(404, 'That role isn’t in the queue.');
  if (job.status !== 'ready') throw fail(409, 'Only a role ready for review can be approved.');
  const latest = await one('SELECT id, pdf_path, check_status FROM resume_versions WHERE user_id = $1 AND plan_item_id = $2 ORDER BY version DESC LIMIT 1', [userId, planItemId]);
  if (!latest?.pdf_path || latest.check_status !== 'passed') throw fail(409, 'This resume hasn’t passed its checks.');
  await tx(async (t) => {
    await t.query('UPDATE resume_versions SET is_final = FALSE WHERE user_id = $1 AND plan_item_id = $2', [userId, planItemId]);
    await t.query('UPDATE resume_versions SET is_final = TRUE WHERE id = $1', [latest.id]);
    await t.query("UPDATE tailor_jobs SET status = 'approved', updated_at = NOW() WHERE user_id = $1 AND plan_item_id = $2", [userId, planItemId]);
  });
}
