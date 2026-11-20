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
import { NOTE_END, askedElsewhere, companyRow, findApolloRecruitersAt, findRecruitersFor, recruitersAt, isCompanyPage, me, outreachTargets, referralAction, startApprovedAsks, withdrawApprovedAsks } from './referralFlow.js';
import { estimateCallback, pdfText } from './resumeEngine.js';
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

/** The posting's text: the role's own when it has 200+ characters, else the scraped posting's (joined as sr). */
const POSTING_TEXT = "CASE WHEN length(COALESCE(pi.job_description, '')) >= 200 THEN pi.job_description ELSE COALESCE(NULLIF(sr.description, ''), pi.job_description) END";

/** A run writes the table as [{ keyword, where }] or as { keyword: where }. */
const keywordList = (table) => (Array.isArray(table) ? table.map(k => String(k?.keyword || '')) : Object.keys(table && typeof table === 'object' ? table : {})).filter(Boolean);

/** "A / B", "C++, Python" and "Go; Rust" are separate things to find; "CI/CD" and "C++" are one. */
export const keywordTerms = (table) => [...new Set(keywordList(table).flatMap(splitKeyword))];
export const splitKeyword = (k) => String(k).split(/\s*[,;|]\s*|\s+\/\s+/)
  .map(t => t.trim().replace(/^(?:and|or|&)\s+/i, '').trim())
  .filter(t => t && !/^(?:etc\.?|and more|or similar|or related(?: fields?)?|related(?: fields?)?)$/i.test(t));

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

export async function checkVersion(v) {
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
  // A run that leaves the callback chance empty gets one from fillMissingCallbacks, one every 2 minutes (Groq's limit is per minute).
}

let callbackPauseUntil = 0;

/**
 * Catch up callback estimates a few at a time: the latest version of a Ready,
 * revising or approved role that has a PDF but no callback chance (a run left
 * it empty, or the AI providers were busy). When a provider says "rate limit",
 * wait 3 minutes (Groq's limit is per minute; each estimate is ~8k tokens).
 */
export async function fillMissingCallbacks(limit = 1) {
  if (Date.now() < callbackPauseUntil) return 0;
  const rows = await all(
    `SELECT v.id, v.user_id, v.plan_item_id, v.report, v.ats_before, v.ats_after, v.callback_after, v.pdf_path, pi.title, pi.company_name, ${POSTING_TEXT} AS description
       FROM tailor_jobs j
       JOIN LATERAL (SELECT * FROM resume_versions x WHERE x.plan_item_id = j.plan_item_id ORDER BY x.version DESC LIMIT 1) v ON TRUE
       JOIN plan_items pi ON pi.id = j.plan_item_id
       LEFT JOIN scraped_roles sr ON sr.id = COALESCE(j.scraped_role_id, pi.scraped_role_id)
      WHERE j.status IN ('ready', 'revision_requested', 'approved') AND v.callback_after IS NULL AND v.pdf_path IS NOT NULL
        AND COALESCE((v.report->'scores'->>'callback_tries')::int, 0) < 5
      ORDER BY (j.status = 'ready') DESC, v.created_at DESC LIMIT $1`,
    [limit],
  );
  let filled = 0;
  for (const v of rows) {
    try {
      const text = await pdfText(await downloadVersionPdf(v.pdf_path));
      if (await fillCallback(v, text)) filled += 1;
      else await run(`UPDATE resume_versions SET report = COALESCE(report, '{}'::jsonb) || jsonb_build_object('scores', COALESCE(report->'scores', '{}'::jsonb) || jsonb_build_object('callback_tries', 5)) WHERE id = $1`, [v.id]);
    } catch (err) {
      if (/\b429\b|rate limit/i.test(err.message)) { callbackPauseUntil = Date.now() + 3 * 60_000; console.warn('[review] callback estimate waiting on a rate limit:', err.message.slice(0, 160)); break; }
      // Anything else: count the try, so one bad version doesn't block the rest.
      await run(`UPDATE resume_versions SET report = COALESCE(report, '{}'::jsonb) || jsonb_build_object('scores', COALESCE(report->'scores', '{}'::jsonb) || jsonb_build_object('callback_tries', COALESCE((report->'scores'->>'callback_tries')::int, 0) + 1)) WHERE id = $1`, [v.id]);
    }
  }
  return filled;
}

/** Save a callback estimate (before, after and why) on a version that has none. */
export async function fillCallback(v, text) {
  const c = await estimateCallback({
    userId: v.user_id, title: v.title, company: v.company_name, description: v.description, afterText: text,
    keywordTable: v.report?.keyword_table, atsBefore: v.ats_before, atsAfter: v.ats_after,
  });
  if (!c) return null;
  await run(
    `UPDATE resume_versions SET callback_before = $2, callback_after = $3,
            report = COALESCE(report, '{}'::jsonb) || jsonb_build_object('scores', COALESCE(report->'scores', '{}'::jsonb) || jsonb_build_object('callback_reason', $4::text, 'callback_by', 'app'))
      WHERE id = $1 AND callback_after IS NULL`,
    [v.id, c.before, c.after, c.why || null],
  );
  return c;
}

let checking = false;

/** Compile and check the versions runs have written since the last pass. */
export async function checkNewVersions(limit = 10) {
  if (checking) return 0;
  checking = true;
  try {
    const rows = await all(
      `SELECT v.id, v.user_id, v.plan_item_id, v.version, v.latex, v.report, v.ats_before, v.ats_after, v.callback_after, pi.title, pi.company_name, ${POSTING_TEXT} AS description
         FROM resume_versions v JOIN plan_items pi ON pi.id = v.plan_item_id LEFT JOIN scraped_roles sr ON sr.id = pi.scraped_role_id
        WHERE v.checked_at IS NULL OR (v.pdf_path IS NULL AND v.latex IS NOT NULL AND v.check_status IS DISTINCT FROM 'flagged')
        ORDER BY v.created_at LIMIT $1`,
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
 *
 * The database is a 220 ms round trip away and the whole list (2,700+ roles)
 * took 4–8 s to read, after every button. So it's kept per user and only the
 * roles whose tailor_jobs.changed_at moved (migration 060's triggers) are
 * read again; the whole list is read again every 10 minutes for what the
 * triggers don't see (a referrer, a scraped posting's dates).
 */
const QUEUE_FULL_MS = 10 * 60_000;
const queueCache = new Map(); // userId → { rows: Map(id → row), mark: Date, fullAt: ms }
const queueLoading = new Map();

function queueSql(onlySome) {
  const hasPosting = "GREATEST(length(COALESCE(pi.job_description, '')), length(COALESCE(sr.description, ''))) > 200";
  return `SELECT j.plan_item_id AS id, j.status, j.closed_reason, j.referral_mode, j.outreach_due, j.updated_at, (j.status = 'ready' AND pi.stage_note LIKE 'Approve didn’t finish%') AS approve_failed, j.locked_at, j.locked_by_run AS run,
            COALESCE(sr.posted_at, sr.scraped_at, pi.created_at) AS posted_at, (sr.posted_at IS NOT NULL) AS posted_known, pi.company_name, pi.title, pi.location, pi.score, pi.sponsorship, pi.contacts_at,
            (j.status = 'queued' AND NOT ${hasPosting}) AS no_posting, sr.no_opt_phrase AS no_opt,
            CASE WHEN pi.title ~* '\\m(intern|internship|co-?op|summer analyst|summer associate)\\M' THEN 'intern' WHEN sr.role_type IN ('intern', 'new_grad') THEN sr.role_type ELSE 'new_grad' END AS role_kind,
            j.priority AS _priority, COALESCE(sr.posted_at, pi.created_at) AS _order_at, j.id AS _jid,
            v.id AS version_id, v.version, v.ats_after, v.callback_after, v.check_status, v.report->>'eligibility_flag' AS eligibility, r.contact_name AS referrer,
            (v.edited_at IS NOT NULL AND v.edited_at > COALESCE(v.update_seen_at, 'epoch'::timestamptz)) AS updated,
            CASE WHEN v.edited_at IS NOT NULL THEN regexp_replace(COALESCE(v.change_log, ''), '^.*;\\s*', '') END AS update_note, (v.pdf_path IS NULL) AS pdf_pending,
            CASE WHEN jsonb_typeof(v.report->'skills_to_learn') = 'array' THEN jsonb_array_length(v.report->'skills_to_learn') ELSE 0 END AS to_learn,
            COALESCE(pi.apply_deadline, sr.apply_deadline)::text AS deadline,
            ${yearsSelect("concat_ws(' ', pi.title, sr.title)", 'COALESCE(sr.description, pi.job_description)')},
            (SELECT COUNT(*)::int FROM resume_comments c WHERE c.plan_item_id = j.plan_item_id AND c.status = 'open') AS open_comments,
            (SELECT COUNT(*)::int FROM outreach_drafts d WHERE d.plan_item_id = j.plan_item_id AND d.status <> 'closed') AS outreach,
            (SELECT COUNT(*)::int FROM outreach_drafts d LEFT JOIN job_contacts c ON c.id = d.contact_id
              WHERE d.plan_item_id = j.plan_item_id AND d.status IN ('draft', 'edited')
                AND ((COALESCE(btrim(c.email), '') <> '' AND c.email_status IS DISTINCT FROM 'invalid' AND COALESCE(btrim(d.email_body), '') = '')
                     OR COALESCE(btrim(d.linkedin_note), '') = '')) AS writing
       FROM tailor_jobs j JOIN plan_items pi ON pi.id = j.plan_item_id
       LEFT JOIN scraped_roles sr ON sr.id = j.scraped_role_id
       LEFT JOIN LATERAL (SELECT * FROM resume_versions x WHERE x.plan_item_id = j.plan_item_id ORDER BY x.version DESC LIMIT 1) v ON TRUE
       LEFT JOIN referrers r ON r.user_id = j.user_id AND lower(r.company_name) = lower(trim(pi.company_name))
      WHERE j.user_id = $1${onlySome ? ' AND j.plan_item_id = ANY($2::bigint[])' : ''}`;
}

/**
 * The list in claim order: waiting roles that have a posting are numbered by
 * priority, then newest posting (as claim_tailor_jobs takes them); then the
 * rest, most recently changed first. Pure.
 */
export function orderQueue(rows) {
  const time = (v) => (v ? new Date(v).getTime() : 0);
  const waiting = rows.filter(r => r.status === 'queued' && !r.no_posting)
    .sort((a, b) => (Number(b._priority) || 0) - (Number(a._priority) || 0) || time(b._order_at) - time(a._order_at));
  const place = new Map(waiting.map((r, i) => [String(r.id), i + 1]));
  return rows.map(r => ({ ...r, place: place.get(String(r.id)) ?? null }))
    .sort((a, b) => (a.place ?? Infinity) - (b.place ?? Infinity) || time(b.updated_at) - time(a.updated_at) || Number(b._jid) - Number(a._jid));
}

async function fullQueue(userId) {
  const mark = (await one('SELECT NOW() AS at')).at;
  const rows = await all(queueSql(false), [userId]);
  queueCache.set(userId, { rows: new Map(rows.map(r => [String(r.id), r])), mark, fullAt: Date.now() });
}

async function loadQueue(userId) {
  const c = queueCache.get(userId);
  if (!c) return fullQueue(userId);
  // The 10-minute full read happens in the background; this request gets the changes only.
  if (Date.now() - c.fullAt > QUEUE_FULL_MS && !c.refreshing) {
    c.refreshing = true;
    fullQueue(userId).catch(err => { c.refreshing = false; console.warn('[review] queue refresh failed', err.message); });
  }
  // What changed since the last read (2 s of overlap, so nothing committed during it is missed).
  const since = new Date(new Date(c.mark).getTime() - 2000);
  const changed = await one(
    `SELECT NOW() AS at, (SELECT COUNT(*)::int FROM tailor_jobs j JOIN plan_items pi ON pi.id = j.plan_item_id WHERE j.user_id = $1) AS n,
            ARRAY(SELECT plan_item_id::text FROM tailor_jobs WHERE user_id = $1 AND changed_at > $2) AS ids`,
    [userId, since],
  );
  const ids = changed.ids || [];
  if (ids.length > 400) return fullQueue(userId);
  if (ids.length) {
    const rows = await all(queueSql(true), [userId, ids]);
    for (const id of ids) c.rows.delete(String(id));
    for (const r of rows) c.rows.set(String(r.id), r);
  }
  c.mark = changed.at;
  // A role deleted outright (never in normal use) isn't seen by the triggers: read everything again.
  if (changed.n !== c.rows.size) return fullQueue(userId);
}

export async function reviewQueue(userId) {
  // Two requests at once share one read.
  if (!queueLoading.has(userId)) queueLoading.set(userId, loadQueue(userId).finally(() => queueLoading.delete(userId)));
  await queueLoading.get(userId);
  return orderQueue([...queueCache.get(userId).rows.values()]);
}

/** At startup: read the queue of everyone active this week, so nobody's first visit waits for it. */
export async function warmQueues() {
  const users = await all("SELECT DISTINCT user_id FROM tailor_jobs WHERE updated_at > NOW() - INTERVAL '7 days'");
  for (const u of users) await reviewQueue(u.user_id).catch(() => {});
  return users.length;
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
  const { readyRoles } = await import('./readyToSubmit.js');
  const submit = await readyRoles(userId, { resolve: false }).catch(() => []);
  if (!d.ready && !d.tomorrow && !d.emails && !submit.length) return { skipped: 'nothing' };
  await tell(userId, reviewMessage({ ...d, submit }));
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
    `SELECT j.plan_item_id AS id, j.status, j.referral_mode, j.outreach_due, (j.status = 'approved' AND pi.decision IS DISTINCT FROM 'approved') AS finishing, pi.company_name, pi.title, pi.location, pi.score, pi.apply_url, ${POSTING_TEXT} AS job_description, pi.stage, pi.stage_note, pi.apply_after, pi.sponsorship, pi.contacts_at,
            r.contact_name AS referrer, r.note AS referrer_note
       FROM tailor_jobs j JOIN plan_items pi ON pi.id = j.plan_item_id
       LEFT JOIN scraped_roles sr ON sr.id = COALESCE(j.scraped_role_id, pi.scraped_role_id)
       LEFT JOIN referrers r ON r.user_id = j.user_id AND lower(r.company_name) = lower(trim(pi.company_name))
      WHERE j.user_id = $1 AND j.plan_item_id = $2`,
    [userId, planItemId],
  );
  if (!role) return null;
  // Opening the role is seeing its in-place edits: the list's "Updated" goes away.
  run('UPDATE resume_versions SET update_seen_at = NOW() WHERE plan_item_id = $1 AND user_id = $2 AND edited_at IS NOT NULL AND (update_seen_at IS NULL OR update_seen_at < edited_at)', [planItemId, userId]).catch(() => {});
  const [versions, comments, outreach, contacts, coveredBy] = await Promise.all([
    all(
      `SELECT id, version, ats_before, ats_after, callback_before, callback_after, report, change_log, is_final, pages, check_status, check_errors,
              keywords, pdf_path, pdf_path IS NOT NULL AS has_pdf, created_at
         FROM resume_versions WHERE user_id = $1 AND plan_item_id = $2 ORDER BY version DESC`,
      [userId, planItemId],
    ),
    all('SELECT id, version_id, body, status, addressed_in_version, created_at FROM resume_comments WHERE user_id = $1 AND plan_item_id = $2 ORDER BY created_at', [userId, planItemId]),
    all(
      `SELECT d.id, d.audience, d.email_subject, d.email_body, d.linkedin_note, d.status, c.name, c.title, c.email, c.email_status, c.linkedin_url,
              ob.status AS outbox_status, ob.send_after, ob.recipient_tz,
              (SELECT array_agg(p2.title ORDER BY p2.id) FROM plan_items p2 WHERE p2.id = ANY(d.also_plan_items)) AS also_roles,
              (SELECT array_agg(pi.title ORDER BY pi.id) FROM outreach_drafts o JOIN plan_items pi ON pi.id = o.plan_item_id JOIN tailor_jobs j ON j.plan_item_id = o.plan_item_id
                WHERE o.user_id = d.user_id AND o.contact_id = d.contact_id AND o.plan_item_id <> d.plan_item_id AND j.status <> 'closed' AND o.status <> 'closed') AS also_for
         FROM outreach_drafts d LEFT JOIN job_contacts c ON c.id = d.contact_id
         LEFT JOIN LATERAL (SELECT o.status, o.send_after, o.recipient_tz FROM referral_asks a JOIN email_outbox o ON o.id = a.outbox_id
                             WHERE a.plan_item_id = d.plan_item_id AND a.contact_id = d.contact_id AND a.channel = 'email' ORDER BY o.id DESC LIMIT 1) ob ON TRUE
        WHERE d.user_id = $1 AND d.plan_item_id = $2 AND d.status <> 'closed' ORDER BY d.audience DESC, d.id`,
      [userId, planItemId],
    ),
    // Who the outreach would go to, shown while the role has none yet.
    NO_EMAILS.includes(role.referral_mode) ? [] : outreachTargets(userId, role.company_name, role.referral_mode)
      .then(list => list.map(c => ({ id: c.id, name: c.name, title: c.title, email: c.email, email_status: c.email_status, linkedin_url: c.linkedin_url, audience: c.audience }))),
    // This role's people are asked in another role's email at the company (one email per person).
    all(
      `SELECT d.id, c.name, pi.id::text AS role_id, pi.title, d.status FROM outreach_drafts d JOIN plan_items pi ON pi.id = d.plan_item_id
         LEFT JOIN job_contacts c ON c.id = d.contact_id WHERE d.user_id = $1 AND $2::bigint = ANY(d.also_plan_items) AND d.status <> 'closed' ORDER BY d.id`,
      [userId, planItemId],
    ),
  ]);
  const quant = isQuantRole({ title: role.title, company: role.company_name, description: role.job_description });
  return { role, versions: await Promise.all(versions.map(withKeywords)), comments, contacts, covered_by: coveredBy, outreach: outreach.map(d => ({ ...d, writing: stillWriting(d), problems: checkOutreach({ ...d, company: role.company_name, quant }) })) };
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

export async function approveRole(userId, planItemId, { withoutReferral = false, wait = false, then = null } = {}) {
  const [job, latest, item, written] = await Promise.all([
    one('SELECT status, referral_mode, outreach_due FROM tailor_jobs WHERE user_id = $1 AND plan_item_id = $2', [userId, planItemId]),
    one('SELECT id, pdf_path, check_status FROM resume_versions WHERE user_id = $1 AND plan_item_id = $2 ORDER BY version DESC LIMIT 1', [userId, planItemId]),
    one('SELECT * FROM plan_items WHERE id = $1 AND user_id = $2', [planItemId, userId]),
    all(
      `SELECT d.id, d.contact_id, d.email_subject, d.email_body, d.linkedin_note, d.written_by, c.name, c.title, c.email, c.email_status, c.linkedin_url
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
  // Your Claude run writes every email and note: nothing goes out half written.
  const writing = drafts.filter(stillWriting).length;
  if (writing) throw fail(409, `Claude is still writing the outreach for ${writing === 1 ? '1 person' : `${writing} people`} on this role. Approve it once your next run has written it, or press Apply without referral.`);
  const quant = isQuantRole({ title: item.title, company: item.company_name, description: item.job_description });
  for (const d of drafts) {
    const [problem] = checkOutreach({ ...d, company: item.company_name, quant });
    if (problem) throw fail(409, `${d.name || 'A contact'}: ${problem} Fix it on the Outreach tab first.`);
  }
  const [repeats, gmail] = await Promise.all([askedElsewhere(userId, planItemId, drafts), connectionFor(userId)]);
  const fresh = drafts.filter(d => !repeats.some(r => r.id === d.id));
  if (fresh.some(d => d.email_body) && !gmail) throw fail(400, 'Connect your Gmail under Integrations → Gmail first.');

  // Two clicks at once: only one gets past this.
  const claimed = await one("UPDATE tailor_jobs SET status = 'approved', updated_at = NOW() WHERE user_id = $1 AND plan_item_id = $2 AND status = 'ready' RETURNING id", [userId, planItemId]);
  if (!claimed) throw fail(409, 'Only a role ready for review can be approved.');
  finishing.add(String(planItemId));
  const work = () => finishApproval(userId, item, latest, drafts).finally(() => finishing.delete(String(planItemId)));
  const done = (finishQueue.get(userId) || Promise.resolve()).then(work, work);
  finishQueue.set(userId, done.catch(() => {}));
  if (wait) return done;
  // Something to do once the approval has finished (Apply without referral), without holding up the click.
  if (then) done.then(() => then()).catch(err => console.warn('[review] after approve failed', planItemId, err.message));
  else done.catch(() => {});
  return {
    emails: fresh.filter(d => d.email_body).length, inGmail: 0, notes: fresh.filter(d => d.linkedin_note).length,
    skipped: [], repeated: repeats.length, pending: true,
  };
}

/** The rest of an approval. Any failure puts the role back in Ready and says why on its page. */
async function finishApproval(userId, item, latest, drafts) {
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
    return result;
  } catch (err) {
    console.warn('[review] approve failed', planItemId, err.message);
    await backToReady(userId, planItemId, String(err.message || 'unknown problem').slice(0, 200));
    throw err;
  }
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
/**
 * The user doesn't want this role: it goes to Closed ("Removed by you"), never
 * deleted, never queued again, and the runs leave it alone. Waiting, Ready or
 * revising roles only.
 */
export async function removeRole(userId, planItemId) {
  if (finishing.has(String(planItemId))) throw fail(409, 'Still finishing the approval. Try again in a minute.');
  const [job, item] = await Promise.all([
    one('SELECT status FROM tailor_jobs WHERE user_id = $1 AND plan_item_id = $2', [userId, planItemId]),
    one('SELECT stage FROM plan_items WHERE id = $1 AND user_id = $2', [planItemId, userId]),
  ]);
  const approved = job?.status === 'approved';
  if (approved && ['applying', 'applied', 'done'].includes(item?.stage)) throw fail(409, 'This role is already being applied to.');
  const row = await one(
    `UPDATE tailor_jobs SET status = 'closed', closed_reason = 'removed', locked_at = NULL, locked_by_run = NULL,
            outreach_due = CASE WHEN status = 'approved' THEN FALSE ELSE outreach_due END, updated_at = NOW()
      WHERE user_id = $1 AND plan_item_id = $2 AND status IN ('queued', 'ready', 'revision_requested', 'approved') AND status = $3
      RETURNING plan_item_id`,
    [userId, planItemId, job?.status ?? null],
  );
  if (!row) throw fail(409, 'Only a waiting, Ready or approved role can be removed.');
  if (!approved) {
    await run("UPDATE plan_items SET stage_note = 'You removed it.' WHERE id = $1 AND user_id = $2", [planItemId, userId]);
    return { ok: true, emailsWaiting: 0 };
  }
  // Out of To apply, the contact search and the digest. Emails stay as they are, as with I applied:
  // one email can also ask about other roles at the company, so the user decides in Outbox.
  await run(
    `UPDATE plan_items SET decision = 'skipped', stage = 'proposed', needs_reason = NULL, wait_until = NULL, apply_after = NULL, stage_note = 'You removed it.'
      WHERE id = $1 AND user_id = $2`,
    [planItemId, userId],
  );
  const waiting = await one(
    `SELECT COUNT(*)::int AS n FROM referral_asks a JOIN email_outbox o ON o.id = a.outbox_id
      WHERE a.user_id = $1 AND a.plan_item_id = $2 AND o.status IN ('draft', 'scheduled')`,
    [userId, planItemId],
  );
  return { ok: true, emailsWaiting: waiting.n };
}

/** Undo a removal: Ready again if it has a resume, else waiting. */
export async function restoreRemovedRole(userId, planItemId) {
  const row = await one(
    `UPDATE tailor_jobs j SET status = CASE WHEN EXISTS (SELECT 1 FROM resume_versions v WHERE v.plan_item_id = j.plan_item_id) THEN 'ready' ELSE 'queued' END,
            closed_reason = NULL, updated_at = NOW()
      WHERE j.user_id = $1 AND j.plan_item_id = $2 AND j.status = 'closed' AND j.closed_reason = 'removed'
      RETURNING j.status`,
    [userId, planItemId],
  );
  if (!row) throw fail(409, 'This role wasn’t removed by you, so there’s nothing to restore.');
  await run('UPDATE plan_items SET stage_note = NULL WHERE id = $1 AND user_id = $2', [planItemId, userId]);
  return { status: row.status };
}

/**
 * The user takes back their change request and keeps the version they have:
 * open comments become 'withdrawn' (kept, never answered), and the role is
 * Ready again, so Approve and Apply without referral work now.
 */
export async function keepVersion(userId, planItemId) {
  const job = await one('SELECT status FROM tailor_jobs WHERE user_id = $1 AND plan_item_id = $2', [userId, planItemId]);
  if (!job) throw fail(404, 'That role isn’t in the queue.');
  if (job.status === 'in_progress') throw fail(409, 'A run is writing the new version right now. Wait for it to finish.');
  if (job.status !== 'revision_requested') throw fail(409, 'This role isn’t waiting on a revision.');
  if (!await one('SELECT 1 AS x FROM resume_versions WHERE user_id = $1 AND plan_item_id = $2 AND pdf_path IS NOT NULL LIMIT 1', [userId, planItemId])) {
    throw fail(409, 'This role has no resume PDF yet, so there’s nothing to use.');
  }
  await run("UPDATE resume_comments SET status = 'withdrawn' WHERE plan_item_id = $1 AND status = 'open'", [planItemId]);
  await run("UPDATE tailor_jobs SET status = 'ready', updated_at = NOW() WHERE user_id = $1 AND plan_item_id = $2 AND status = 'revision_requested'", [userId, planItemId]);
  return { ok: true };
}

export async function applyWithoutReferral(userId, planItemId) {
  const job = await one('SELECT status, referral_mode FROM tailor_jobs WHERE user_id = $1 AND plan_item_id = $2', [userId, planItemId]);
  if (!job) throw fail(404, 'That role isn’t in the queue.');
  if (!['ready', 'approved'].includes(job.status)) throw fail(409, 'Only a role ready for review or approved can apply.');
  const unsent = await one("SELECT 1 AS x FROM referral_asks a JOIN email_outbox o ON o.id = a.outbox_id WHERE a.user_id = $1 AND a.plan_item_id = $2 AND o.status IN ('draft', 'scheduled', 'sending') LIMIT 1", [userId, planItemId]);
  if (unsent) throw fail(409, 'OK or discard this role’s emails in People → Outbox first.');
  if (job.status === 'ready') {
    const written = !NO_EMAILS.includes(job.referral_mode) && await one("SELECT 1 AS x FROM outreach_drafts WHERE user_id = $1 AND plan_item_id = $2 AND status IN ('draft', 'edited') LIMIT 1", [userId, planItemId]);
    if (written) throw fail(409, 'This role has outreach waiting. Approve it instead.');
    // The checks run now (a problem still answers the click); the approval and the apply step finish in the background.
    await approveRole(userId, planItemId, { withoutReferral: true, then: () => referralAction(userId, planItemId, { action: 'no_referral' }) });
    return { pending: true };
  }
  await referralAction(userId, planItemId, { action: 'no_referral' });
  return { pending: false };
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
  // Independent of each other: at once (each is a 220 ms round trip).
  const [, , waiting] = await Promise.all([
    run(
      `UPDATE plan_items SET stage = 'applied', needs_reason = NULL, applied_at = COALESCE(applied_at, NOW()), stage_note = 'You applied yourself.',
              decision = CASE WHEN decision IN ('pending', 'expired') THEN 'approved' ELSE decision END, decided_at = COALESCE(decided_at, NOW())
        WHERE id = $1 AND user_id = $2 AND stage NOT IN ('applied', 'done')`,
      [planItemId, userId],
    ),
    run("UPDATE tailor_jobs SET status = 'applied', outreach_due = FALSE, updated_at = NOW() WHERE user_id = $1 AND plan_item_id = $2", [userId, planItemId]),
    one(
      `SELECT COUNT(*)::int AS n FROM referral_asks a JOIN email_outbox o ON o.id = a.outbox_id
        WHERE a.user_id = $1 AND a.plan_item_id = $2 AND o.status IN ('draft', 'scheduled')`,
      [userId, planItemId],
    ),
  ]);
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

/** A draft your Claude run hasn't written yet: an email it owes (the person has an address) or the LinkedIn note. Pure. */
export function stillWriting(d) {
  const canMail = Boolean(String(d.email ?? '').trim()) && d.email_status !== 'invalid';
  return (canMail && !String(d.email_body ?? '').trim()) || !String(d.linkedin_note ?? '').trim();
}

/** Best fit first: interview callback, then ATS, then the role's fit score; ties by the older role. */
export function byFit(a, b) {
  const n = (v) => (v == null ? -Infinity : Number(v));
  return n(b.callback_after) - n(a.callback_after) || n(b.ats_after) - n(a.ats_after) || n(b.score) - n(a.score) || Number(a.id) - Number(b.id);
}

/**
 * Who gets an empty outreach row on which role, for roles queued together.
 * One person, one email per company: someone several roles would reach gets
 * one row, on the best-fit of those roles, with the others in `also`. Someone
 * who already has a row on another open role is left alone there: an
 * unwritten one takes these roles into its `also`, a written, approved or
 * sent one stays as it is (the run never rewrites an email) and they're
 * skipped here. Pure.
 *   roles:    [{ id, callback_after, ats_after, score }]
 *   targets:  Map role id → [{ id: contact id, audience }]   (outreachTargets)
 *   existing: Map contact id → { draftId, planItemId, unwritten }
 * → { insert: [{ planItemId, contactId, audience, also }], append: [{ draftId, add }], skip: [{ contactId, planItemId, roles }] }
 */
export function planOutreach({ roles, targets, existing = new Map() }) {
  const order = [...roles].sort(byFit).map(r => String(r.id));
  const wanted = new Map(); // contact id → { audience, roles: [role ids, best fit first] }
  for (const roleId of order) {
    for (const p of targets.get(roleId) || targets.get(Number(roleId)) || []) {
      const key = String(p.id);
      if (!wanted.has(key)) wanted.set(key, { audience: p.audience || 'recruiter', roles: [] });
      wanted.get(key).roles.push(roleId);
    }
  }
  const insert = [];
  const append = [];
  const skip = [];
  for (const [contactId, w] of wanted) {
    const had = existing.get(contactId) || existing.get(Number(contactId));
    if (had) {
      const add = w.roles.filter(r => r !== String(had.planItemId));
      if (had.unwritten && add.length) append.push({ draftId: String(had.draftId), add });
      else if (add.length) skip.push({ contactId, planItemId: String(had.planItemId), roles: add });
      continue;
    }
    const [best, ...rest] = w.roles;
    insert.push({ planItemId: best, contactId, audience: w.audience, also: rest });
  }
  return { insert, append, skip };
}

/**
 * Empty outreach rows for roles (Ready or Revising, a mode that emails), for
 * your Claude run to write: subject, body and note stay NULL until it does,
 * and the role page says "Claude is writing this email". The app never fills
 * in any text. People come from outreachTargets (the run's step 7 rule: the
 * best 2 recruiters, plus 1 engineer in that mode), grouped by company so each
 * person gets one row (planOutreach). Roles given a row are marked
 * outreach_due for the next run. → { inserted, appended, skipped, roles }
 */
export async function queueOutreachForRoles(userId, planItemIds, { dryRun = false } = {}) {
  const roles = await all(
    `SELECT pi.id, pi.company_name, pi.title, pi.score, j.referral_mode, v.callback_after, v.ats_after
       FROM tailor_jobs j JOIN plan_items pi ON pi.id = j.plan_item_id
       LEFT JOIN LATERAL (SELECT callback_after, ats_after FROM resume_versions x WHERE x.plan_item_id = pi.id ORDER BY version DESC LIMIT 1) v ON TRUE
      WHERE j.user_id = $1 AND pi.id = ANY($2::bigint[]) AND j.status IN ('ready', 'revision_requested') AND j.referral_mode NOT IN ('my_contact', 'none')`,
    [userId, planItemIds.map(Number)],
  );
  const result = { inserted: 0, appended: 0, skipped: [], roles: new Set(), plans: [] };
  const companies = new Map();
  for (const r of roles) {
    const key = r.company_name.trim().toLowerCase();
    if (!companies.has(key)) companies.set(key, []);
    companies.get(key).push(r);
  }
  for (const group of companies.values()) {
    const targets = new Map();
    for (const r of group) targets.set(String(r.id), await outreachTargets(userId, r.company_name, r.referral_mode));
    const contactIds = [...new Set([...targets.values()].flat().map(p => Number(p.id)))];
    if (!contactIds.length) continue;
    const rows = await all(
      `SELECT DISTINCT ON (d.contact_id) d.id, d.contact_id, d.plan_item_id,
              (d.status IN ('draft', 'edited') AND COALESCE(btrim(d.email_body), '') = '' AND COALESCE(btrim(d.linkedin_note), '') = '') AS unwritten
         FROM outreach_drafts d JOIN tailor_jobs j ON j.plan_item_id = d.plan_item_id
        WHERE d.user_id = $1 AND d.contact_id = ANY($2::bigint[]) AND j.status <> 'closed' AND d.status <> 'closed' AND NOT (d.plan_item_id = ANY($3::bigint[]))
        ORDER BY d.contact_id, d.id`,
      [userId, contactIds, group.map(r => Number(r.id))],
    );
    const existing = new Map(rows.map(r => [String(r.contact_id), { draftId: r.id, planItemId: r.plan_item_id, unwritten: r.unwritten }]));
    const plan = planOutreach({ roles: group, targets, existing });
    if (dryRun) { result.plans.push({ company: group[0].company_name, roles: group.map(r => ({ id: String(r.id), title: r.title, callback_after: r.callback_after, ats_after: r.ats_after })), targets: Object.fromEntries([...targets].map(([k, v]) => [k, v.map(p => ({ id: String(p.id), name: p.name, audience: p.audience, email: p.email || null }))])), ...plan }); continue; }
    for (const x of plan.insert) {
      try {
        const r = await run(
          `INSERT INTO outreach_drafts (user_id, plan_item_id, contact_id, audience, also_plan_items) VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (plan_item_id, contact_id) DO NOTHING`,
          [userId, x.planItemId, x.contactId, x.audience, x.also.length ? x.also.map(Number) : null],
        );
        if (r.rowCount) { result.inserted += 1; result.roles.add(String(x.planItemId)); }
      } catch (err) {
        // The per-role cap (migrations 040 and 050) refuses extra people: the rest still get theirs.
        if (!/limit/i.test(String(err.message))) throw err;
      }
    }
    for (const a of plan.append) {
      await run(
        `UPDATE outreach_drafts SET also_plan_items = (SELECT array_agg(DISTINCT x) FROM unnest(COALESCE(also_plan_items, '{}') || $2::bigint[]) x), updated_at = NOW()
          WHERE id = $1 AND COALESCE(btrim(email_body), '') = '' AND COALESCE(btrim(linkedin_note), '') = ''`,
        [a.draftId, a.add.map(Number)],
      );
      result.appended += 1;
    }
    result.skipped.push(...plan.skip);
  }
  if (result.roles.size) {
    await run('UPDATE tailor_jobs SET outreach_due = TRUE, updated_at = NOW() WHERE user_id = $1 AND plan_item_id = ANY($2::bigint[])', [userId, [...result.roles].map(Number)]);
  }
  return { ...result, roles: [...result.roles] };
}

/**
 * One person's drafts at one company, merged into one email. The person has
 * unsent rows on some roles (`rows`), and other roles would reach them too
 * (`extra`: roles with no outreach of their own; `also`: roles already listed
 * on their rows). Pure.
 *  - Already asked in an approved or sent email there (`approvedOn`): every
 *    unsent copy closes, and nothing is added.
 *  - Otherwise one row stays, on the best-fit role (byFit), with every other
 *    role in `also` (best fit first); its text is cleared so the run rewrites
 *    it with the "also" line, and the other copies close. A person on one role
 *    with nothing to add is left as they are.
 * → { keep: { planItemId, draftId | null, also } | null, close: [{ draftId, reason }] }
 */
export function planMerge({ rows, extra = [], also = [], approvedOn = null, roles }) {
  const title = (id) => roles.get(String(id))?.title || `role ${id}`;
  if (approvedOn) {
    return { keep: null, close: rows.map(r => ({ draftId: String(r.id), reason: `Already asked in the approved email for ${title(approvedOn)} (one email per person per company).` })) };
  }
  const all = [...new Set([...rows.map(r => String(r.planItemId)), ...extra.map(String), ...also.map(String)])]
    .filter(id => roles.has(id))
    .sort((a, b) => byFit(roles.get(a), roles.get(b)));
  if (!all.length) return { keep: null, close: [] };
  if (rows.length === 1 && all.length === 1) return { keep: null, close: [] };
  const [best, ...rest] = all;
  const kept = rows.find(r => String(r.planItemId) === best) || null;
  return {
    keep: { planItemId: best, draftId: kept ? String(kept.id) : null, also: rest },
    close: rows.filter(r => r !== kept).map(r => ({ draftId: String(r.id), reason: `Merged into the email for ${title(best)} (one email per person per company).` })),
  };
}

/**
 * One email per person per company, for drafts already written: every person
 * with unsent, unapproved drafts on more than one open role at a company (or
 * whom other roles there would reach) keeps one row, on the best-fit role,
 * listing the others; its text is cleared for the run to rewrite. The other
 * copies close with a reason (never deleted). Approved or sent emails are
 * never touched. → { kept, inserted, closed, backup, perCompany }
 */
export async function mergeCompanyOutreach(userId, { dryRun = true } = {}) {
  const open = await all(
    `SELECT d.id, d.plan_item_id, d.contact_id, d.audience, d.status, d.email_subject, d.email_body, d.linkedin_note, d.also_plan_items,
            lower(trim(pi.company_name)) AS company, pi.company_name, lower(NULLIF(trim(c.email), '')) AS email
       FROM outreach_drafts d JOIN tailor_jobs j ON j.plan_item_id = d.plan_item_id JOIN plan_items pi ON pi.id = d.plan_item_id
       LEFT JOIN job_contacts c ON c.id = d.contact_id
      WHERE d.user_id = $1 AND d.status IN ('draft', 'edited') AND j.status IN ('ready', 'revision_requested')`,
    [userId],
  );
  const asked = await all(
    `SELECT d.plan_item_id::text AS plan_item_id, d.contact_id, pi.title, lower(trim(pi.company_name)) AS company, lower(NULLIF(trim(c.email), '')) AS email
       FROM outreach_drafts d JOIN plan_items pi ON pi.id = d.plan_item_id LEFT JOIN job_contacts c ON c.id = d.contact_id
      WHERE d.user_id = $1 AND d.status IN ('approved', 'sent')`,
    [userId],
  );
  const companies = [...new Set(open.map(r => r.company))];
  const roleRows = await all(
    `SELECT pi.id::text AS id, pi.title, pi.company_name, lower(trim(pi.company_name)) AS company, pi.score, j.referral_mode, v.callback_after, v.ats_after,
            EXISTS (SELECT 1 FROM outreach_drafts d WHERE d.plan_item_id = pi.id AND d.status <> 'closed') AS has_rows
       FROM tailor_jobs j JOIN plan_items pi ON pi.id = j.plan_item_id
       LEFT JOIN LATERAL (SELECT callback_after, ats_after FROM resume_versions x WHERE x.plan_item_id = pi.id ORDER BY version DESC LIMIT 1) v ON TRUE
      WHERE j.user_id = $1 AND j.status IN ('ready', 'revision_requested') AND lower(trim(pi.company_name)) = ANY($2::text[])`,
    [userId, companies],
  );
  const roles = new Map(roleRows.map(r => [r.id, r]));
  const keyOf = (r) => `${r.company}|${r.email || `c${r.contact_id}`}`;
  const people = new Map();
  for (const r of open) {
    const k = keyOf(r);
    if (!people.has(k)) people.set(k, { rows: [], extra: new Set(), also: new Set(), company: r.company, email: r.email, audience: r.audience, contactId: r.contact_id });
    const p = people.get(k);
    p.rows.push({ id: r.id, planItemId: String(r.plan_item_id) });
    for (const a of r.also_plan_items || []) p.also.add(String(a));
  }
  // Roles at these companies with no outreach of their own: whom would they reach?
  const byCompanyMode = new Map();
  for (const r of roleRows.filter(x => !x.has_rows && !NO_EMAILS.includes(x.referral_mode))) {
    const k = `${r.company}|${r.referral_mode}`;
    if (!byCompanyMode.has(k)) byCompanyMode.set(k, await outreachTargets(userId, r.company_name, r.referral_mode));
    for (const t of byCompanyMode.get(k)) {
      const p = people.get(`${r.company}|${t.email ? String(t.email).trim().toLowerCase() : `c${t.id}`}`) || people.get(`${r.company}|c${t.id}`);
      if (p) p.extra.add(r.id);
    }
  }
  const plans = [];
  for (const p of people.values()) {
    // Already asked at this company in an approved or sent email (same address, or the same contact).
    const done = asked.find(a => a.company === p.company && ((a.email && a.email === p.email) || String(a.contact_id) === String(p.contactId)));
    const known = done ? new Map([...roles, [done.plan_item_id, { title: done.title }]]) : roles;
    const plan = planMerge({ rows: p.rows, extra: [...p.extra], also: [...p.also], approvedOn: done ? done.plan_item_id : null, roles: known });
    if (plan.keep || plan.close.length) plans.push({ ...plan, company: p.company, audience: p.audience, contactId: p.contactId });
  }
  const touched = new Set(plans.flatMap(x => [...x.close.map(c => c.draftId), ...(x.keep?.draftId ? [x.keep.draftId] : [])]));
  const backup = open.filter(r => touched.has(String(r.id)));
  const summary = { kept: plans.filter(x => x.keep).length, inserted: plans.filter(x => x.keep && !x.keep.draftId).length, closed: plans.reduce((n, x) => n + x.close.length, 0), plans, backup };
  if (dryRun) return summary;
  for (const x of plans) {
    // Close the copies first, so they no longer count toward the kept role's limit.
    for (const c of x.close) {
      await run(`UPDATE outreach_drafts SET status = 'closed', closed_reason = $2, closed_at = NOW(), updated_at = NOW() WHERE id = $1 AND status IN ('draft', 'edited')`, [c.draftId, c.reason]);
    }
    if (!x.keep) continue;
    const also = x.keep.also.length ? x.keep.also.map(Number) : null;
    if (x.keep.draftId) {
      await run(
        `UPDATE outreach_drafts SET email_subject = NULL, email_body = NULL, linkedin_note = NULL, status = 'draft', also_plan_items = $2, updated_at = NOW()
          WHERE id = $1 AND status IN ('draft', 'edited')`,
        [x.keep.draftId, also],
      );
    } else {
      await run(
        `INSERT INTO outreach_drafts (user_id, plan_item_id, contact_id, audience, also_plan_items) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (plan_item_id, contact_id) DO UPDATE SET email_subject = NULL, email_body = NULL, linkedin_note = NULL, status = 'draft', also_plan_items = EXCLUDED.also_plan_items, closed_reason = NULL, closed_at = NULL, updated_at = NOW()`,
        [userId, x.keep.planItemId, x.contactId, x.audience, also],
      );
    }
    await run('UPDATE tailor_jobs SET outreach_due = TRUE, updated_at = NOW() WHERE user_id = $1 AND plan_item_id = $2', [userId, x.keep.planItemId]);
  }
  // Roles whose people are now all asked elsewhere wait for no run.
  await run(
    `UPDATE tailor_jobs j SET outreach_due = FALSE, updated_at = NOW() WHERE j.user_id = $1 AND j.outreach_due
        AND EXISTS (SELECT 1 FROM outreach_drafts d WHERE d.plan_item_id = j.plan_item_id AND d.status = 'closed')
        AND NOT EXISTS (SELECT 1 FROM outreach_drafts d WHERE d.plan_item_id = j.plan_item_id AND d.status <> 'closed')`,
    [userId],
  );
  return summary;
}

/** One role's empty outreach rows (see queueOutreachForRoles). Returns the rows added. */
export async function queueOutreachDrafts(userId, planItemId) {
  return (await queueOutreachForRoles(userId, [planItemId])).inserted;
}

/**
 * Recruiters for a Ready role with no outreach. The next run writes the emails
 * and notes. `source: 'apollo'` asks Apollo alone, even after other sources found nobody.
 */
const EMAIL_RE = /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i;
const PROFILE_RE = /^https?:\/\/(?:[a-z]{2,3}\.)?linkedin\.com\/in\/[A-Za-z0-9_%-]+\/?$/i;

/**
 * People the user copied from Apollo (or anywhere) for this role: saved as the
 * company's contacts, marked as the user's own (source 'manual', picked first),
 * and the role's outreach comes next (the next run writes it, or Use template now).
 * Each person needs an email or a LinkedIn profile. → { added, people }
 */
export async function addRoleContacts(userId, planItemId, people) {
  const job = await one('SELECT status, referral_mode FROM tailor_jobs WHERE user_id = $1 AND plan_item_id = $2', [userId, planItemId]);
  if (!job) throw fail(404, 'That role isn’t in the queue.');
  if (!['ready', 'revision_requested', 'approved'].includes(job.status)) throw fail(409, 'Add people once the resume is ready for review.');
  const clean = (Array.isArray(people) ? people : []).slice(0, 200).map(p => ({
    name: String(p?.name || '').trim().slice(0, 80),
    title: String(p?.title || '').trim().slice(0, 120),
    email: String(p?.email || '').trim().toLowerCase(),
    linkedin_url: String(p?.linkedin_url || '').trim(),
  })).map(p => ({
    ...p,
    email: EMAIL_RE.test(p.email) ? p.email : '',
    linkedin_url: PROFILE_RE.test(p.linkedin_url.startsWith('http') ? p.linkedin_url : `https://${p.linkedin_url}`) ? (p.linkedin_url.startsWith('http') ? p.linkedin_url : `https://${p.linkedin_url}`) : '',
  })).filter(p => p.email || p.linkedin_url);
  if (!clean.length) throw fail(400, 'Each person needs an email address or a LinkedIn profile link.');
  const item = await one('SELECT * FROM plan_items WHERE id = $1 AND user_id = $2', [planItemId, userId]);
  const { companyRow } = await import('./referralFlow.js');
  const { upsertContact } = await import('./contactFinder.js');
  const { seniorityScore } = await import('./contactRules.js');
  const jobId = await companyRow(userId, item.company_name, item.location);
  let added = 0;
  // Five at a time: each person is a few round trips to the database.
  for (let i = 0; i < clean.length; i += 5) {
    const results = await Promise.all(clean.slice(i, i + 5).map(p => upsertContact({ all, run }, {
      userId, jobId, seniorityScore: seniorityScore(p.title),
      contact: { name: p.name || null, title: p.title, email: p.email || null, linkedin_url: p.linkedin_url || null, status: 'unverified', source: 'manual' },
    })));
    added += results.filter(r => r === 'inserted').length;
  }
  // Anyone already saved: theirs now (picked first). One statement for all of them.
  await run(
    `UPDATE job_contacts SET source = 'manual' WHERE user_id = $1 AND job_id = $2
       AND (lower(email) = ANY($3::text[]) OR lower(linkedin_url) = ANY($4::text[]))`,
    [userId, jobId, clean.map(p => p.email).filter(Boolean), clean.map(p => p.linkedin_url.toLowerCase()).filter(Boolean)],
  );
  await run('UPDATE plan_items SET contacts_at = COALESCE(contacts_at, NOW()) WHERE id = $1 AND user_id = $2', [planItemId, userId]);
  // Their emails: empty rows now, written by the next Claude run.
  const drafted = await queueOutreachDrafts(userId, planItemId);
  return { added, people: clean.length, drafted };
}

export async function findRoleContacts(userId, planItemId, { source = 'all' } = {}) {
  const job = await one('SELECT status, referral_mode FROM tailor_jobs WHERE user_id = $1 AND plan_item_id = $2', [userId, planItemId]);
  if (!job) throw fail(404, 'That role isn’t in the queue.');
  if (job.status !== 'ready') throw fail(409, 'Only a role ready for review needs contacts.');
  if (NO_EMAILS.includes(job.referral_mode)) throw fail(409, 'This role’s mode emails nobody, so it needs no lookups.');
  if (await one("SELECT 1 AS x FROM outreach_drafts WHERE user_id = $1 AND plan_item_id = $2 AND status <> 'closed' LIMIT 1", [userId, planItemId])) throw fail(409, 'This role already has outreach.');
  const item = await one('SELECT * FROM plan_items WHERE id = $1 AND user_id = $2', [planItemId, userId]);
  const found = source === 'apollo' ? await apolloOnly(userId, item) : await findRecruitersFor(userId, item, { engineer: job.referral_mode === 'recruiters_engineers' });
  if (found.recruiters) await queueOutreachDrafts(userId, planItemId);
  return found;
}
