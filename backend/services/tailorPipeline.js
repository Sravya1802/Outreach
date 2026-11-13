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
 *     Approving makes the version final, puts the emails in Gmail Drafts with the
 *     PDF attached and starts the referral wait. Nothing sends from here: each
 *     email waits for the user's OK in Outbox, and applying waits for the referrals.
 *   findRoleContacts: recruiters for a Ready role; the next run writes its outreach.
 *   applyWithoutReferral: the only way a role with no outreach goes out.
 *   markRoleApplied: the user applied on their own; nothing applies for them.
 *   markApplied (cron): a role applied to from any path moves to Applied.
 *   runSummary, companyQueue: the Home, Usage and Company pages.
 *   runConfig, saveRunConfig: what a run reads. Every save is a new tailoring_config
 *     version; corrections live in standing_rules because every run reads those.
 *   notifyRuns (cron), sendReviewDigest: the message after a run and the 9 PM digest.
 */
import { all, one, run, tx } from '../db.js';
import { connectionFor, sendToSelf } from './gmail.js';
import { copyDraftsToGmail } from './outbox.js';
import { compileTex } from './latex.js';
import { NOTE_END, askedElsewhere, companyRow, findApolloRecruitersAt, findRecruitersFor, recruitersAt, isCompanyPage, me, outreachTargets, referralAction, signature, startApprovedAsks, templateAsk, withdrawApprovedAsks } from './referralFlow.js';
import { pdfText } from './resumeEngine.js';
import { markAppliedYourself, resumeFileName, saveForEvaluation } from './resumeFiles.js';
import { roleKind } from './resumeRules.js';
import { yearsSelect } from './gradYear.js';
import { downloadVersionPdf, uploadVersionPdf } from './resumeStorage.js';
import { notify, reviewMessage, runMessage } from './whatsapp.js';

export const REFERRAL_MODES = ['recruiters', 'recruiters_engineers', 'my_contact', 'none'];
const NOTE_LIMIT = 300;
const RUN_EVERY_HOURS = 5;
const NO_EMAILS = ['my_contact', 'none'];
const CORRECTIONS = 'Master resume corrections\nThese win over master_latex where the two disagree.\n';

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

/** What's wrong with one email and note, in words the user reads; empty when they pass. */
export function checkOutreach({ email_body, linkedin_note, name, company, quant = false }) {
  const errors = [];
  const email = String(email_body ?? '').replace(/\s+/g, ' ');
  const note = String(linkedin_note ?? '').trim();
  const latency = quant ? null : email.match(LATENCY);
  if (latency) errors.push(`The email cites ${latency[0]} on a role that isn't quant.`);
  if (isCompanyPage(name, company)) errors.push(`${name} is a company page, not a person.`);
  if (note.length > NOTE_LIMIT) errors.push(`The LinkedIn note is ${note.length} characters. The limit is ${NOTE_LIMIT}.`);
  if (note && !note.replace(/\.$/, '').endsWith(NOTE_END)) errors.push(`The LinkedIn note doesn't end with "${NOTE_END}".`);
  return errors;
}

/** A run writes the table as [{ keyword, where }] or as { keyword: where }. */
const keywordList = (table) => (Array.isArray(table) ? table.map(k => String(k?.keyword || '')) : Object.keys(table && typeof table === 'object' ? table : {})).filter(Boolean);

/** "A / B" is two things to find; "CI/CD" is one. */
const keywordTerms = (table) => [...new Set(keywordList(table).flatMap(k => k.split(/\s+\/\s+/)).map(t => t.trim()).filter(Boolean))];

/** The words run together, so "CI / CD" and a line-end "micro-services" still match, with where each word starts and ends. */
function wordMap(text) {
  let flat = '';
  const starts = new Set();
  const ends = new Set();
  for (const [word] of String(text).matchAll(/[A-Za-z0-9+#]+/g)) {
    starts.add(flat.length);
    flat += word;
    ends.add(flat.length);
  }
  return { flat, lower: flat.toLowerCase(), starts, ends };
}

/** Whole words only, so "Java" isn't found in "JavaScript". Two letters and acronyms must match case, so "Go" isn't "go". */
function hasTerm({ flat, lower, starts, ends }, term) {
  const key = term.replace(/[^A-Za-z0-9+#]/g, '');
  if (!key) return false;
  const exact = key.length <= 2 || /^[A-Z]{3,4}$/.test(key);
  const base = exact ? key : key.toLowerCase();
  // A plural matches its singular, and the other way round.
  const forms = key.length <= 2 ? [base] : [base, `${base}s`, ...(key.endsWith('s') ? [base.slice(0, -1)] : [])];
  const hay = exact ? flat : lower;
  return forms.some((form) => {
    for (let at = hay.indexOf(form); at !== -1; at = hay.indexOf(form, at + 1)) {
      if (starts.has(at) && ends.has(at + form.length)) return true;
    }
    return false;
  });
}

/** Which of the report's keywords are in the text, each side of "A / B" on its own. */
export function keywordCheck(text, table) {
  const words = wordMap(text);
  const terms = keywordTerms(table);
  const present = terms.filter(t => hasTerm(words, t));
  return { found: present.length, total: terms.length, present, missing: terms.filter(t => !present.includes(t)) };
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

/** A role can be applied to from To apply as well, so this catches every path. */
export async function markApplied() {
  await run(
    `UPDATE tailor_jobs j SET status = 'applied', updated_at = NOW() FROM plan_items pi
      WHERE pi.id = j.plan_item_id AND j.status = 'approved' AND pi.stage IN ('applied', 'referred')`,
  );
}

/**
 * Every role in the queue, with its latest version. place is its turn among the
 * waiting roles, in claim_tailor_jobs' order; a waiting role whose posting
 * couldn't be read (no_posting) has none, since a run can't take it.
 */
export async function reviewQueue(userId) {
  const hasPosting = "GREATEST(length(COALESCE(pi.job_description, '')), length(COALESCE(sr.description, ''))) > 200";
  return all(
    `SELECT j.plan_item_id AS id, j.status, j.referral_mode, j.outreach_due, j.updated_at, (j.status = 'ready' AND pi.stage_note LIKE 'Approve didn’t finish%') AS approve_failed, j.locked_at, j.locked_by_run AS run,
            COALESCE(sr.posted_at, sr.scraped_at, pi.created_at) AS posted_at, pi.company_name, pi.title, pi.location, pi.score, pi.sponsorship, pi.contacts_at,
            (j.status = 'queued' AND NOT ${hasPosting}) AS no_posting,
            CASE WHEN j.status = 'queued' AND ${hasPosting}
                 THEN (ROW_NUMBER() OVER (PARTITION BY j.status, ${hasPosting} ORDER BY j.priority DESC, COALESCE(sr.posted_at, pi.created_at) DESC))::int END AS place,
            v.version, v.ats_after, v.check_status, v.report->>'eligibility_flag' AS eligibility, r.contact_name AS referrer,
            CASE WHEN jsonb_typeof(v.report->'skills_to_learn') = 'array' THEN jsonb_array_length(v.report->'skills_to_learn') ELSE 0 END AS to_learn,
            COALESCE(pi.apply_deadline, sr.apply_deadline)::text AS deadline,
            ${yearsSelect("concat_ws(' ', pi.title, sr.title)", 'COALESCE(sr.description, pi.job_description)')},
            (SELECT COUNT(*)::int FROM resume_comments c WHERE c.plan_item_id = j.plan_item_id AND c.status = 'open') AS open_comments,
            (SELECT COUNT(*)::int FROM outreach_drafts d WHERE d.plan_item_id = j.plan_item_id) AS outreach
       FROM tailor_jobs j JOIN plan_items pi ON pi.id = j.plan_item_id
       LEFT JOIN scraped_roles sr ON sr.id = j.scraped_role_id
       LEFT JOIN LATERAL (SELECT * FROM resume_versions x WHERE x.plan_item_id = j.plan_item_id ORDER BY x.version DESC LIMIT 1) v ON TRUE
       LEFT JOIN referrers r ON r.user_id = j.user_id AND lower(r.company_name) = lower(trim(pi.company_name))
      WHERE j.user_id = $1
      ORDER BY place NULLS LAST, j.updated_at DESC, j.id DESC`,
    [userId],
  );
}

/** The latest run, finished or not. */
export async function lastRun(userId) {
  return one('SELECT id, started_at, finished_at, roles_done, roles_failed FROM pipeline_runs WHERE user_id = $1 ORDER BY id DESC LIMIT 1', [userId]);
}

/** The recent runs and where the queue stands. A run comes every 5 hours, so the next time is an estimate. */
export async function runSummary(userId, now = Date.now()) {
  const [runs, queue] = await Promise.all([
    all('SELECT id, started_at, finished_at, roles_done, roles_failed FROM pipeline_runs WHERE user_id = $1 ORDER BY id DESC LIMIT 20', [userId]),
    one(
      `SELECT COUNT(*) FILTER (WHERE j.status = 'queued')::int AS waiting,
              COUNT(*) FILTER (WHERE j.status = 'ready')::int AS ready,
              COUNT(*) FILTER (WHERE j.status = 'ready' AND v.check_status = 'flagged')::int AS flagged,
              COUNT(*) FILTER (WHERE j.status = 'approved')::int AS approved
         FROM tailor_jobs j
         LEFT JOIN LATERAL (SELECT check_status FROM resume_versions x WHERE x.plan_item_id = j.plan_item_id ORDER BY x.version DESC LIMIT 1) v ON TRUE
        WHERE j.user_id = $1`,
      [userId],
    ),
  ]);
  const hours = RUN_EVERY_HOURS * 3600_000;
  const recent = runs.filter(r => now - new Date(r.started_at).getTime() < hours);
  return {
    runs,
    queue,
    nextRunAt: runs[0] ? new Date(new Date(runs[0].started_at).getTime() + hours).toISOString() : null,
    window: { hours: RUN_EVERY_HOURS, done: recent.reduce((n, r) => n + r.roles_done, 0), failed: recent.reduce((n, r) => n + r.roles_failed, 0) },
  };
}

/** A company's roles in the queue, with the resume version each one uses: the final one, else the latest. */
export async function companyQueue(userId, company) {
  return all(
    `SELECT j.plan_item_id AS id, j.status, pi.title, pi.location, v.version, v.is_final, v.ats_after
       FROM tailor_jobs j JOIN plan_items pi ON pi.id = j.plan_item_id
       LEFT JOIN LATERAL (SELECT * FROM resume_versions x WHERE x.plan_item_id = j.plan_item_id ORDER BY x.is_final DESC, x.version DESC LIMIT 1) v ON TRUE
      WHERE j.user_id = $1 AND lower(trim(pi.company_name)) = lower(trim($2))
      ORDER BY pi.title, pi.location`,
    [userId, String(company ?? '')],
  );
}

/** The corrections in a run's standing rules. */
export function readCorrections(rules) {
  const at = String(rules ?? '').indexOf(CORRECTIONS);
  if (at < 0) return [];
  return String(rules).slice(at + CORRECTIONS.length).split('\n').filter(l => l.startsWith('- ')).map(l => l.slice(2).trim()).filter(Boolean);
}

/** Standing rules with these corrections in place of the old ones. */
export function withCorrections(rules, corrections) {
  const text = String(rules ?? '');
  const at = text.indexOf(CORRECTIONS);
  const base = (at < 0 ? text : text.slice(0, at)).trimEnd();
  return corrections.length ? `${base}\n\n${CORRECTIONS}${corrections.map(c => `- ${c}`).join('\n')}` : base;
}

const latestConfig = (userId) => one('SELECT * FROM tailoring_config WHERE user_id = $1 ORDER BY version DESC LIMIT 1', [userId]);

/** What the next run reads, for the Master resume and Templates pages. */
export async function runConfig(userId) {
  const c = await latestConfig(userId);
  if (!c) return null;
  return { version: c.version, created_at: c.created_at, master_latex: c.master_latex, email_template: c.email_template, linkedin_rules: c.linkedin_rules, corrections: readCorrections(c.standing_rules) };
}

/** Adds lines to the corrections, skipping any already there. Does nothing before the runs are set up. */
export async function addCorrections(userId, lines) {
  const c = await latestConfig(userId);
  if (!c) return;
  const have = readCorrections(c.standing_rules);
  const next = [...have, ...lines.filter(l => !have.includes(l))];
  if (next.length > have.length) await saveRunConfig(userId, { corrections: next });
}

/** Saves as the next version, so a run mid-way keeps what it read and nothing is lost. */
export async function saveRunConfig(userId, { email_template, linkedin_rules, corrections }) {
  const c = await latestConfig(userId);
  if (!c) throw fail(409, 'Your runs aren’t set up yet.');
  const email = email_template === undefined ? c.email_template : String(email_template).trim();
  const rules = linkedin_rules === undefined ? c.linkedin_rules : String(linkedin_rules).trim();
  if (!email || !rules) throw fail(400, 'A run needs both the email template and the LinkedIn rules.');
  let standing = c.standing_rules;
  if (corrections !== undefined) {
    if (!Array.isArray(corrections)) throw fail(400, 'Bad corrections.');
    const list = corrections.map(x => String(x ?? '').replace(/\s+/g, ' ').trim()).filter(Boolean);
    if (list.length > 50 || list.some(x => x.length > 500)) throw fail(400, 'Keep it to 50 corrections of 500 characters each.');
    standing = withCorrections(c.standing_rules, list);
  }
  await run(
    `INSERT INTO tailoring_config (user_id, version, system_prompt, master_latex, standing_rules, email_template, linkedin_rules)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [userId, c.version + 1, c.system_prompt, c.master_latex, standing, email, rules],
  );
  return runConfig(userId);
}

/** Every 2 minutes: a finished run that wrote something gets one message. */
export async function notifyRuns() {
  const runs = (await run(
    `UPDATE pipeline_runs r SET notified_at = NOW() WHERE finished_at IS NOT NULL AND notified_at IS NULL
     RETURNING user_id, roles_done, roles_failed,
       (SELECT COUNT(DISTINCT d.plan_item_id)::int FROM outreach_drafts d WHERE d.user_id = r.user_id AND d.created_at BETWEEN r.started_at AND r.finished_at) AS outreach`,
  )).rows;
  for (const r of runs.filter(x => x.roles_done > 0 || x.roles_failed > 0 || x.outreach > 0)) await tell(r.user_id, runMessage(r));
}

/** Gmail to the user's own address and WhatsApp. Neither stops the other. */
async function tell(userId, m) {
  await sendToSelf(userId, { subject: `[Scout’n’Jobs] ${m.subject}`, text: m.plain }).catch(err => console.warn('[review] email to self:', err.message));
  await notify(userId, 'review', m).catch(err => console.warn('[review] whatsapp:', err.message));
}

/** The 9 PM digest. Quiet when nothing in the queue needs the user. */
export async function sendReviewDigest(userId) {
  const d = await one(
    `SELECT COUNT(*) FILTER (WHERE j.status = 'ready')::int AS ready,
            COUNT(*) FILTER (WHERE j.status = 'ready' AND j.updated_at < NOW() - INTERVAL '1 day')::int AS unreviewed,
            COUNT(*) FILTER (WHERE j.status = 'approved' AND pi.apply_after < NOW() + INTERVAL '1 day')::int AS tomorrow,
            (SELECT COUNT(*)::int FROM email_outbox o WHERE o.user_id = $1 AND o.status = 'draft' AND o.purpose = 'referral') AS emails
       FROM tailor_jobs j JOIN plan_items pi ON pi.id = j.plan_item_id WHERE j.user_id = $1`,
    [userId],
  );
  if (!d.ready && !d.tomorrow && !d.emails) return { skipped: 'nothing' };
  await tell(userId, reviewMessage(d));
  return d;
}

/** A saved check with no `present` list came from the old rules, so check that version against the PDF here. */
async function withKeywords({ pdf_path, ...v }) {
  const table = v.report?.keyword_table;
  if (!pdf_path || Array.isArray(v.keywords?.present) || !keywordList(table).length) return v;
  const keywords = await downloadVersionPdf(pdf_path).then(pdfText).then(text => keywordCheck(text, table)).catch(() => null);
  return { ...v, keywords };
}

/** One role: the versions (newest first), the comments and the outreach. */
export async function reviewRole(userId, planItemId) {
  const role = await one(
    `SELECT j.plan_item_id AS id, j.status, j.referral_mode, j.outreach_due, (j.status = 'approved' AND pi.decision IS DISTINCT FROM 'approved') AS finishing, pi.company_name, pi.title, pi.location, pi.score, pi.apply_url, pi.job_description, pi.stage, pi.stage_note, pi.apply_after, pi.sponsorship, pi.contacts_at,
            r.contact_name AS referrer, r.note AS referrer_note
       FROM tailor_jobs j JOIN plan_items pi ON pi.id = j.plan_item_id
       LEFT JOIN referrers r ON r.user_id = j.user_id AND lower(r.company_name) = lower(trim(pi.company_name))
      WHERE j.user_id = $1 AND j.plan_item_id = $2`,
    [userId, planItemId],
  );
  if (!role) return null;
  const [versions, comments, outreach, contacts] = await Promise.all([
    all(
      `SELECT id, version, ats_before, ats_after, callback_before, callback_after, report, change_log, is_final, pages, check_status, check_errors,
              keywords, pdf_path, pdf_path IS NOT NULL AS has_pdf, created_at
         FROM resume_versions WHERE user_id = $1 AND plan_item_id = $2 ORDER BY version DESC`,
      [userId, planItemId],
    ),
    all('SELECT id, version_id, body, status, addressed_in_version, created_at FROM resume_comments WHERE user_id = $1 AND plan_item_id = $2 ORDER BY created_at', [userId, planItemId]),
    all(
      `SELECT d.id, d.audience, d.email_subject, d.email_body, d.linkedin_note, d.status, c.name, c.title, c.email, c.linkedin_url,
              (SELECT array_agg(pi.title ORDER BY pi.id) FROM outreach_drafts o JOIN plan_items pi ON pi.id = o.plan_item_id JOIN tailor_jobs j ON j.plan_item_id = o.plan_item_id
                WHERE o.user_id = d.user_id AND o.contact_id = d.contact_id AND o.plan_item_id <> d.plan_item_id AND j.status <> 'closed') AS also_for
         FROM outreach_drafts d LEFT JOIN job_contacts c ON c.id = d.contact_id WHERE d.user_id = $1 AND d.plan_item_id = $2 ORDER BY d.audience DESC, d.id`,
      [userId, planItemId],
    ),
    // Who the outreach would go to, shown while the role has none yet.
    NO_EMAILS.includes(role.referral_mode) ? [] : outreachTargets(userId, role.company_name, role.referral_mode)
      .then(list => list.map(c => ({ id: c.id, name: c.name, title: c.title, email: c.email, email_status: c.email_status, linkedin_url: c.linkedin_url, audience: c.audience }))),
  ]);
  const quant = isQuantRole({ title: role.title, company: role.company_name, description: role.job_description });
  return { role, versions: await Promise.all(versions.map(withKeywords)), comments, contacts, outreach: outreach.map(d => ({ ...d, problems: checkOutreach({ ...d, company: role.company_name, quant }) })) };
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
  if (job.status === 'approved') await withdrawApprovedAsks(userId, planItemId);
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
  if (draft.status === 'approved') throw fail(409, 'This email is in your Outbox now. Edit it there.');
  await run(
    "UPDATE outreach_drafts SET email_subject = $3, email_body = $4, linkedin_note = $5, status = 'edited', updated_at = NOW() WHERE user_id = $1 AND id = $2",
    [userId, draftId, String(email_subject ?? '').trim() || null, String(email_body ?? '').trim() || null, note || null],
  );
}

/**
 * The user's yes. A flagged or uncompiled version can't be approved, and every email
 * carries the PDF, so nothing is drafted until it's saved. Nothing sends from here.
 */
// The database is a 230 ms round trip from the server, so the work after the claim
// (PDF, file, emails) runs after Approve answers, one role at a time per user.
const finishing = new Set();
const finishQueue = new Map();
export const APPROVE_FAILED = 'Approve didn’t finish';

export async function approveRole(userId, planItemId, { withoutReferral = false, wait = false } = {}) {
  const [job, latest, item, written] = await Promise.all([
    one('SELECT status, referral_mode, outreach_due FROM tailor_jobs WHERE user_id = $1 AND plan_item_id = $2', [userId, planItemId]),
    one('SELECT id, pdf_path, check_status FROM resume_versions WHERE user_id = $1 AND plan_item_id = $2 ORDER BY version DESC LIMIT 1', [userId, planItemId]),
    one('SELECT * FROM plan_items WHERE id = $1 AND user_id = $2', [planItemId, userId]),
    all(
      `SELECT d.id, d.contact_id, d.email_subject, d.email_body, d.linkedin_note, c.name, c.title, c.email, c.linkedin_url
         FROM outreach_drafts d LEFT JOIN job_contacts c ON c.id = d.contact_id
        WHERE d.user_id = $1 AND d.plan_item_id = $2 AND d.status IN ('draft', 'edited') ORDER BY d.audience DESC, d.id`,
      [userId, planItemId],
    ),
  ]);
  if (!job) throw fail(404, 'That role isn’t in the queue.');
  if (job.status !== 'ready') throw fail(409, 'Only a role ready for review can be approved.');
  if (!latest?.pdf_path || latest.check_status !== 'passed') throw fail(409, 'This resume hasn’t passed its checks.');
  if (item.decision === 'approved' && !['proposed', 'tailoring', 'needs_you'].includes(item.stage)) throw fail(409, 'This role has already moved on in To apply.');
  // My contact and None email nobody, even if a run wrote drafts before the mode changed.
  const noEmails = withoutReferral || NO_EMAILS.includes(job.referral_mode);
  const drafts = noEmails ? [] : written;
  if (!noEmails && !drafts.length && job.outreach_due) throw fail(409, 'This role’s emails come with the next run. Approve it once they’re written, or press Apply without referral.');
  // No recruiter found: the template goes to Gmail Drafts with the resume and an empty To line, for the address the user finds.
  const blank = !noEmails && !drafts.length;
  const quant = isQuantRole({ title: item.title, company: item.company_name, description: item.job_description });
  for (const d of drafts) {
    const [problem] = checkOutreach({ ...d, company: item.company_name, quant });
    if (problem) throw fail(409, `${d.name || 'A contact'}: ${problem} Fix it on the Outreach tab first.`);
  }
  const [repeats, gmail] = await Promise.all([askedElsewhere(userId, planItemId, drafts), connectionFor(userId)]);
  const fresh = drafts.filter(d => !repeats.some(r => r.id === d.id));
  if ((blank || fresh.some(d => d.email_body)) && !gmail) throw fail(400, 'Connect your Gmail under Integrations → Gmail first.');

  // Two clicks at once: only one gets past this.
  const claimed = await one("UPDATE tailor_jobs SET status = 'approved', updated_at = NOW() WHERE user_id = $1 AND plan_item_id = $2 AND status = 'ready' RETURNING id", [userId, planItemId]);
  if (!claimed) throw fail(409, 'Only a role ready for review can be approved.');
  finishing.add(String(planItemId));
  const work = () => finishApproval(userId, item, latest, drafts, { blank }).finally(() => finishing.delete(String(planItemId)));
  const done = (finishQueue.get(userId) || Promise.resolve()).then(work, work);
  finishQueue.set(userId, done.catch(() => {}));
  if (wait) return done;
  done.catch(() => {});
  return {
    emails: fresh.filter(d => d.email_body).length, inGmail: 0, notes: fresh.filter(d => d.linkedin_note).length,
    skipped: [], repeated: repeats.length, pending: true, blankDraft: blank,
  };
}

/** The rest of an approval. Any failure puts the role back in Ready and says why on its page. */
async function finishApproval(userId, item, latest, drafts, { blank = false } = {}) {
  const planItemId = item.id;
  try {
    const { evaluationFor, getSettings } = await import('./dailyPlan.js');
    const [pdf, evaluationId, who, settings] = await Promise.all([
      downloadVersionPdf(latest.pdf_path).catch(() => { throw fail(502, 'couldn’t get the resume PDF'); }),
      item.evaluation_id || evaluationFor(userId, item),
      me(userId),
      getSettings(userId),
    ]);
    const [file] = await Promise.all([
      saveForEvaluation(userId, evaluationId, pdf, resumeFileName(who.name), 'tailored'),
      run('UPDATE plan_items SET evaluation_id = $2 WHERE id = $1', [planItemId, evaluationId]),
    ]);
    const { outboxIds, ...result } = await startApprovedAsks(userId, { ...item, evaluation_id: evaluationId }, drafts, file.id, settings);
    await run('UPDATE resume_versions SET is_final = FALSE WHERE user_id = $1 AND plan_item_id = $2 AND id <> $3', [userId, planItemId, latest.id]);
    await run('UPDATE resume_versions SET is_final = TRUE WHERE id = $1', [latest.id]);
    // Each Gmail copy takes seconds: written after this, on one connection, with the PDF already in hand.
    if (outboxIds.length) copyDraftsToGmail(userId, outboxIds, new Map([[String(file.id), pdf]])).catch(() => {});
    if (blank) await blankDraftFor(userId, item, who, pdf, resumeFileName(who.name));
    return { ...result, blankDraft: blank };
  } catch (err) {
    console.warn('[review] approve failed', planItemId, err.message);
    await backToReady(userId, planItemId, String(err.message || 'unknown problem').slice(0, 200));
    throw err;
  }
}

/**
 * A role approved with no recruiter found: the plain template ("Dear Hiring
 * Team,") in Gmail Drafts with the resume attached and nobody in To. The role
 * stays held; it applies when the user presses Apply without referral.
 */
async function blankDraftFor(userId, item, who, pdf, filename) {
  const t = templateAsk({ me: who.name, school: who.school, major: who.major, sig: signature(who), title: item.title, company: item.company_name, jobUrl: item.apply_url, attached: true, personName: '' });
  let note;
  try {
    const { putBlankDraft } = await import('./gmail.js');
    await putBlankDraft(userId, { subject: t.subject, text: t.body, attachments: [{ filename, content: pdf, contentType: 'application/pdf' }] });
    note = 'Your template is in Gmail Drafts with the resume attached and an empty To line: add the address you find and send it. This role applies only when you press Apply without referral.';
  } catch (err) {
    console.warn('[review] blank Gmail draft failed', item.id, err.message);
    note = `The Gmail draft couldn’t be made (${String(err.message).slice(0, 80)}). This role applies only when you press Apply without referral.`;
  }
  await run('UPDATE plan_items SET stage_note = $2 WHERE id = $1 AND user_id = $3', [item.id, note, userId]);
}

async function backToReady(userId, planItemId, why) {
  await run("UPDATE tailor_jobs SET status = 'ready', updated_at = NOW() WHERE user_id = $1 AND plan_item_id = $2 AND status = 'approved'", [userId, planItemId]);
  await run('UPDATE plan_items SET stage_note = $3 WHERE id = $1 AND user_id = $2', [planItemId, userId, `${APPROVE_FAILED} (${why}). Approve it again.`]);
}

/** An approval cut off by a restart: claimed but never finished. It goes back to Ready (cron). */
export async function recoverApprovals() {
  const stuck = await all(
    `SELECT j.user_id, j.plan_item_id FROM tailor_jobs j JOIN plan_items pi ON pi.id = j.plan_item_id
      WHERE j.status = 'approved' AND pi.decision IS DISTINCT FROM 'approved' AND j.updated_at < NOW() - INTERVAL '10 minutes'`,
  );
  const lost = stuck.filter(r => !finishing.has(String(r.plan_item_id)));
  for (const r of lost) await backToReady(r.user_id, r.plan_item_id, 'the server restarted');
  return lost.length;
}

/** The user's say-so for a role with no outreach: approves it if needed, then it goes at the next morning slot. */
export async function applyWithoutReferral(userId, planItemId) {
  const job = await one('SELECT status, referral_mode FROM tailor_jobs WHERE user_id = $1 AND plan_item_id = $2', [userId, planItemId]);
  if (!job) throw fail(404, 'That role isn’t in the queue.');
  if (!['ready', 'approved'].includes(job.status)) throw fail(409, 'Only a role ready for review or approved can apply.');
  const unsent = await one("SELECT 1 AS x FROM referral_asks a JOIN email_outbox o ON o.id = a.outbox_id WHERE a.user_id = $1 AND a.plan_item_id = $2 AND o.status IN ('draft', 'scheduled', 'sending') LIMIT 1", [userId, planItemId]);
  if (unsent) throw fail(409, 'OK or discard this role’s emails in People → Outbox first.');
  if (job.status === 'ready') {
    const written = !NO_EMAILS.includes(job.referral_mode) && await one("SELECT 1 AS x FROM outreach_drafts WHERE user_id = $1 AND plan_item_id = $2 AND status IN ('draft', 'edited') LIMIT 1", [userId, planItemId]);
    if (written) throw fail(409, 'This role has outreach waiting. Approve it instead.');
    await approveRole(userId, planItemId, { withoutReferral: true, wait: true });
  }
  await referralAction(userId, planItemId, { action: 'no_referral' });
}

/**
 * The user applied on the company's site themselves. The role moves to Applied
 * and shows in the Tracker; nothing applies for them and no run takes it.
 * Emails already in Outbox stay there for them to OK or discard.
 */
export async function markRoleApplied(userId, planItemId) {
  const [job, item] = await Promise.all([
    one('SELECT status FROM tailor_jobs WHERE user_id = $1 AND plan_item_id = $2', [userId, planItemId]),
    one('SELECT * FROM plan_items WHERE id = $1 AND user_id = $2', [planItemId, userId]),
  ]);
  if (!job) throw fail(404, 'That role isn’t in the queue.');
  if (job.status === 'in_progress') throw fail(409, 'A run is working on this role. Try again when it finishes.');
  if (['applied', 'closed'].includes(job.status)) throw fail(409, `This role is already ${job.status}.`);
  if (finishing.has(String(planItemId))) throw fail(409, 'Still finishing the approval. Try again in a minute.');
  // One submitted application per posting: an earlier one in the Tracker stands, and only the role moves.
  const earlier = item.apply_url && await one("SELECT id FROM evaluations WHERE user_id = $1 AND job_url = $2 AND apply_status = 'submitted' LIMIT 1", [userId, item.apply_url]);
  if (!earlier) {
    const { evaluationFor } = await import('./dailyPlan.js');
    const evaluationId = item.evaluation_id || await evaluationFor(userId, item);
    if (!item.evaluation_id) await run('UPDATE plan_items SET evaluation_id = $2 WHERE id = $1', [planItemId, evaluationId]);
    await markAppliedYourself(userId, evaluationId);
  }
  await run(
    `UPDATE plan_items SET stage = 'applied', needs_reason = NULL, applied_at = COALESCE(applied_at, NOW()), stage_note = 'You applied yourself.',
            decision = CASE WHEN decision IN ('pending', 'expired') THEN 'approved' ELSE decision END, decided_at = COALESCE(decided_at, NOW())
      WHERE id = $1 AND user_id = $2 AND stage NOT IN ('applied', 'done')`,
    [planItemId, userId],
  );
  await run("UPDATE tailor_jobs SET status = 'applied', outreach_due = FALSE, updated_at = NOW() WHERE user_id = $1 AND plan_item_id = $2", [userId, planItemId]);
  const waiting = await one(
    `SELECT COUNT(*)::int AS n FROM referral_asks a JOIN email_outbox o ON o.id = a.outbox_id
      WHERE a.user_id = $1 AND a.plan_item_id = $2 AND o.status IN ('draft', 'scheduled')`,
    [userId, planItemId],
  );
  return { emailsWaiting: waiting.n };
}

/** Search Apollo, by hand: its errors are the user's to see (a Free plan says so). */
async function apolloOnly(userId, item) {
  const { clearCooldown } = await import('./providerGuard.js');
  clearCooldown('apollo');
  const jobId = await companyRow(userId, item.company_name, item.location);
  try {
    await findApolloRecruitersAt(userId, jobId, item);
    await run('UPDATE plan_items SET contacts_at = NOW(), contacts_lookup = true WHERE id = $1', [item.id]);
  } catch (err) {
    if (err.code === 'PLAN') throw fail(402, 'Apollo’s Free plan doesn’t allow searches from the app. Upgrade the Apollo account whose key the app uses, then try again.');
    if (err.code === 'BUDGET' || err.code === 'QUOTA') throw fail(402, err.message);
    throw fail(502, `Apollo: ${err.message}`);
  }
  const found = await recruitersAt(userId, item.company_name);
  return { recruiters: found.length, emails: found.filter(c => c.email && c.email_status !== 'invalid').length };
}

/**
 * The role's outreach from the plain template, now rather than at the next
 * run: an email (and a LinkedIn note) to each of the best 2 recruiters, plus
 * an engineer in that mode; a note only for someone with no address. Drafts
 * like a run's: edit them, then Approve sends them with the resume attached.
 */
export async function templateOutreach(userId, planItemId) {
  const job = await one('SELECT status, referral_mode FROM tailor_jobs WHERE user_id = $1 AND plan_item_id = $2', [userId, planItemId]);
  if (!job) throw fail(404, 'That role isn’t in the queue.');
  if (job.status !== 'ready') throw fail(409, 'Only a role ready for review gets new outreach.');
  if (NO_EMAILS.includes(job.referral_mode)) throw fail(409, 'This role’s mode emails nobody.');
  if (await one('SELECT 1 AS x FROM outreach_drafts WHERE user_id = $1 AND plan_item_id = $2 LIMIT 1', [userId, planItemId])) throw fail(409, 'This role already has outreach.');
  const item = await one('SELECT * FROM plan_items WHERE id = $1 AND user_id = $2', [planItemId, userId]);
  const [people, who] = await Promise.all([outreachTargets(userId, item.company_name, job.referral_mode), me(userId)]);
  if (!people.length) throw fail(409, 'No recruiter found at this company yet. Find contacts first.');
  const base = { me: who.name, school: who.school, major: who.major, sig: signature(who), title: item.title, company: item.company_name, jobUrl: item.apply_url, attached: true };
  await tx(async (q) => {
    for (const p of people) {
      const t = templateAsk({ ...base, personName: p.name });
      const mail = Boolean(p.email && p.email_status !== 'invalid');
      await q.query(
        `INSERT INTO outreach_drafts (user_id, plan_item_id, contact_id, audience, email_subject, email_body, linkedin_note)
         VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (plan_item_id, contact_id) DO NOTHING`,
        [userId, planItemId, p.id, p.audience, mail ? t.subject : null, mail ? t.body : null, t.note],
      );
    }
    await q.query('UPDATE tailor_jobs SET outreach_due = FALSE, updated_at = NOW() WHERE user_id = $1 AND plan_item_id = $2', [userId, planItemId]);
  });
  return { drafts: people.length, emails: people.filter(p => p.email && p.email_status !== 'invalid').length };
}

/**
 * Recruiters for a Ready role with no outreach. The next run writes the emails
 * and notes. `source: 'apollo'` asks Apollo alone, even after other sources found nobody.
 */
export async function findRoleContacts(userId, planItemId, { source = 'all' } = {}) {
  const job = await one('SELECT status, referral_mode FROM tailor_jobs WHERE user_id = $1 AND plan_item_id = $2', [userId, planItemId]);
  if (!job) throw fail(404, 'That role isn’t in the queue.');
  if (job.status !== 'ready') throw fail(409, 'Only a role ready for review needs contacts.');
  if (NO_EMAILS.includes(job.referral_mode)) throw fail(409, 'This role’s mode emails nobody, so it needs no lookups.');
  if (await one('SELECT 1 AS x FROM outreach_drafts WHERE user_id = $1 AND plan_item_id = $2 LIMIT 1', [userId, planItemId])) throw fail(409, 'This role already has outreach.');
  const item = await one('SELECT * FROM plan_items WHERE id = $1 AND user_id = $2', [planItemId, userId]);
  const found = source === 'apollo' ? await apolloOnly(userId, item) : await findRecruitersFor(userId, item, { engineer: job.referral_mode === 'recruiters_engineers' });
  if (found.recruiters) await run('UPDATE tailor_jobs SET outreach_due = TRUE, updated_at = NOW() WHERE user_id = $1 AND plan_item_id = $2', [userId, planItemId]);
  return found;
}
