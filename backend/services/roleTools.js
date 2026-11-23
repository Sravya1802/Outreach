/**
 * roleTools.js — what the To apply dashboard and the role page need beyond the
 * resume and the emails themselves (user, 2026-11-23):
 *   • gap questions: your hourly Claude run asks (gap_chat, sender 'claude',
 *     with options); you answer here; the run acts on 'answered' ones. The app
 *     writes no question text.
 *   • version history: why each version exists, its scores against the one
 *     before, what changed, and its text for comparing two versions.
 *   • "No outreach for this company": the switch, and closing what's unsent.
 *   • fixing people: remove from a role, move to another role at the company,
 *     delete a contact, delete everyone at a company. Only unsent emails and
 *     notes are deleted: a sent email or a reply always stays in history.
 */

import { all, one, run } from '../db.js';

const fail = (status, message) => Object.assign(new Error(message), { status });
const str = (v) => String(v ?? '').trim();
const ids = (xs) => [...new Set((Array.isArray(xs) ? xs : []).map(x => Number(x)).filter(n => Number.isInteger(n) && n > 0))].slice(0, 500);
export const companyKey = (name) => str(name).toLowerCase();

async function ownRole(userId, planItemId) {
  const r = await one(
    `SELECT pi.id, pi.company_name, pi.title, j.status, j.referral_mode, j.outreach_cap FROM plan_items pi JOIN tailor_jobs j ON j.plan_item_id = pi.id
      WHERE pi.id = $1 AND pi.user_id = $2`,
    [planItemId, userId],
  );
  if (!r) throw fail(404, 'That role isn’t in your list.');
  return r;
}

// ── Gap questions ───────────────────────────────────────────────────────────

export async function gapChat(userId, planItemId) {
  await ownRole(userId, planItemId);
  return all(
    `SELECT id::text, sender, text, options, answer, status, created_at, answered_at FROM gap_chat
      WHERE user_id = $1 AND plan_item_id = $2 ORDER BY created_at, id`,
    [userId, planItemId],
  );
}

/** Your answer to one of the run's questions: it's 'answered' until the run updates the resume. */
export async function answerGap(userId, gapId, answer) {
  const a = str(answer).slice(0, 4000);
  if (!a) throw fail(400, 'Write an answer or pick one.');
  const row = await one('SELECT id, sender, status FROM gap_chat WHERE id = $1 AND user_id = $2', [gapId, userId]);
  if (!row) throw fail(404, 'That question is gone.');
  if (row.sender !== 'claude') throw fail(400, 'Only Claude’s questions take an answer.');
  if (row.status === 'applied') throw fail(409, 'Claude already used your answer for this one.');
  await run("UPDATE gap_chat SET answer = $3, status = 'answered', answered_at = NOW() WHERE id = $1 AND user_id = $2", [gapId, userId, a]);
  return { ok: true };
}

// ── Version history ─────────────────────────────────────────────────────────

/** Why a version exists. Pure: the version, the comments addressed in it, and its change log. */
export function versionReason(v, comments = []) {
  const log = str(v.change_log);
  const mine = comments.filter(c => Number(c.addressed_in_version) === Number(v.version));
  if (mine.length) return { kind: 'comment', label: 'Your comment', quote: str(mine[0].body).slice(0, 240) };
  if (Number(v.version) === 1) return { kind: 'first', label: 'First tailoring' };
  if (/\bmaster\b|master_latex/i.test(log) && !/comment/i.test(log)) return { kind: 'master', label: 'Master update' };
  if (/\bfix|rebuild|recompil|compile|broken|typo|correct/i.test(log)) return { kind: 'fix', label: 'Fix' };
  if (/comment/i.test(log)) return { kind: 'comment', label: 'Your comment' };
  return { kind: 'revision', label: 'Revision' };
}

/**
 * What changed in a version, in 1–3 short lines: its change log (one entry per
 * ";"-separated step, the "vN:" prefix and any in-place edit dropped) and the
 * report's changes_made. Pure.
 */
export function changeBullets(v) {
  const log = str(v.change_log).replace(/^v\d+\s*:\s*/i, '');
  const fromLog = log.split(/;\s*/).map(s => s.trim()).filter(s => s && !/^(scheduled run|nov \d+:)/i.test(s));
  const made = Array.isArray(v.report?.changes_made) ? v.report.changes_made.map(s => str(s).replace(/^v\d+\s*:\s*/i, '')) : [];
  const out = [];
  for (const s of [...fromLog, ...made]) if (s && !out.some(o => o.toLowerCase() === s.toLowerCase())) out.push(s.length > 220 ? `${s.slice(0, 217)}…` : s);
  return out.slice(0, 3);
}

/** An in-place edit noted in the change log ("Nov 16: Cancer Center chatbot deployment changed from AWS to Azure (Sravya)"). Pure. */
export function inPlaceEdit(v) {
  if (!v.edited_at) return null;
  const m = str(v.change_log).match(/((?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]* \d{1,2}:[^;]+)/i);
  return { at: v.edited_at, text: m ? m[1].trim() : 'Edited in place.' };
}

export async function versionHistory(userId, planItemId) {
  await ownRole(userId, planItemId);
  const [versions, comments] = await Promise.all([
    all(
      `SELECT id::text, version, created_at, edited_at, change_log, report, ats_before, ats_after, callback_before, callback_after, check_status, is_final
         FROM resume_versions WHERE user_id = $1 AND plan_item_id = $2 ORDER BY version DESC`,
      [userId, planItemId],
    ),
    all('SELECT body, addressed_in_version FROM resume_comments WHERE user_id = $1 AND plan_item_id = $2 AND addressed_in_version IS NOT NULL ORDER BY id', [userId, planItemId]),
  ]);
  return versions.map((v, i) => {
    const prev = versions[i + 1];
    return {
      id: v.id, version: v.version, created_at: v.created_at, is_final: v.is_final, check_status: v.check_status,
      reason: versionReason(v, comments), edit: inPlaceEdit(v), bullets: changeBullets(v),
      // Against the version before; v1 against the master resume.
      ats: { from: prev ? prev.ats_after : v.ats_before, to: v.ats_after },
      callback: { from: prev ? prev.callback_after : v.callback_before, to: v.callback_after },
    };
  });
}

/** A LaTeX resume as plain lines (one per heading, entry and bullet), for comparing versions. Pure. */
export function latexLines(tex) {
  const body = str(tex).split(/\\begin\{document\}/)[1] ?? str(tex);
  return body.split(/\\end\{document\}/)[0]
    .replace(/(?<!\\)%.*$/gm, '')
    .replace(/\\item\s*/g, '\n• ')
    .replace(/\\section\*?\{([^}]*)\}/g, '\n## $1\n')
    .replace(/\\(textbf|textit|emph|underline|href\{[^}]*\})\{([^}]*)\}/g, '$2')
    .replace(/\\href\{[^}]*\}\{([^}]*)\}/g, '$1')
    .replace(/\\hfill/g, ' · ')
    .replace(/\\\\/g, '\n')
    .replace(/\\(begin|end)\{[^}]*\}(\[[^\]]*\])?(\{[^}]*\})*/g, '\n')
    .replace(/\\(vspace|hspace)\*?\{[^}]*\}/g, '')
    .replace(/\\[a-zA-Z]+\*?(\[[^\]]*\])?/g, '')
    .replace(/[{}]/g, '')
    .replace(/\\([%&$#_])/g, '$1')
    .split('\n')
    .map(l => l.replace(/\s+/g, ' ').trim())
    .filter(l => l && l !== '·');
}

export async function versionText(userId, versionId) {
  const v = await one('SELECT id::text, version, latex FROM resume_versions WHERE id = $1 AND user_id = $2', [versionId, userId]);
  if (!v) throw fail(404, 'That version is gone.');
  return { id: v.id, version: v.version, lines: latexLines(v.latex) };
}

/** Opening a role (its page or its card) is seeing its versions: the dashboard's "new version" dot goes. */
export function markVersionsSeen(userId, planItemId) {
  return run('UPDATE resume_versions SET seen_at = NOW() WHERE user_id = $1 AND plan_item_id = $2 AND seen_at IS NULL', [userId, planItemId]).catch(() => {});
}

// ── Taking unsent outreach away ─────────────────────────────────────────────

/**
 * Cancel and delete what hasn't gone out to these people (on these roles, or
 * all of them): waiting emails (their Gmail draft copy too), unsent emails and
 * LinkedIn notes still to send. Sent emails, sent notes and replies stay.
 */
async function dropUnsent(userId, contactIds, planItemIds = null, reason = 'You removed them') {
  if (!contactIds.length) return { emails: 0, notes: 0, drafts: 0 };
  const scope = planItemIds ? 'AND a.plan_item_id = ANY($3::bigint[])' : '';
  const params = planItemIds ? [userId, contactIds, planItemIds] : [userId, contactIds];
  const outbox = await all(
    `SELECT DISTINCT o.id FROM email_outbox o LEFT JOIN referral_asks a ON a.outbox_id = o.id
      WHERE o.user_id = $1 AND o.contact_id = ANY($2::bigint[]) AND o.status IN ('draft', 'scheduled') ${planItemIds ? `AND (a.plan_item_id = ANY($3::bigint[]))` : ''}`,
    params,
  );
  const { cancelScheduled } = await import('./outbox.js');
  for (const o of outbox) await cancelScheduled(userId, o.id, reason);
  const asks = await run(
    `DELETE FROM referral_asks a WHERE a.user_id = $1 AND a.contact_id = ANY($2::bigint[]) ${scope}
        AND ((a.channel = 'linkedin' AND a.status = 'to_send')
          OR (a.channel = 'email' AND a.status IN ('draft', 'scheduled') AND NOT EXISTS (SELECT 1 FROM email_outbox o WHERE o.id = a.outbox_id AND o.status IN ('sending', 'sent'))))`,
    params,
  );
  const drafts = await run(
    `DELETE FROM outreach_drafts d WHERE d.user_id = $1 AND d.contact_id = ANY($2::bigint[]) ${planItemIds ? 'AND d.plan_item_id = ANY($3::bigint[])' : ''}
        AND d.status IN ('draft', 'edited', 'approved', 'closed')
        AND NOT EXISTS (SELECT 1 FROM referral_asks a JOIN email_outbox o ON o.id = a.outbox_id
                         WHERE a.plan_item_id = d.plan_item_id AND a.contact_id = d.contact_id AND o.status IN ('sending', 'sent'))`,
    params,
  );
  return { emails: outbox.length, notes: asks.rowCount, drafts: drafts.rowCount };
}

/** These people come off this role (their unsent email and note go); they stay saved at the company. */
export async function removeFromRole(userId, planItemId, contactIds) {
  await ownRole(userId, planItemId);
  const people = ids(contactIds);
  if (!people.length) throw fail(400, 'Pick at least one person.');
  return { removed: people.length, ...(await dropUnsent(userId, people, [Number(planItemId)])) };
}

/**
 * These people's emails belong to another role at the same company: each
 * unsent draft moves there with its text cleared, so your next Claude run
 * writes it for the right role. Someone the other role already has just leaves this one.
 */
export async function moveToRole(userId, fromId, contactIds, toId) {
  const [from, to] = await Promise.all([ownRole(userId, fromId), ownRole(userId, toId)]);
  if (String(fromId) === String(toId)) throw fail(400, 'Pick a different role.');
  if (companyKey(from.company_name) !== companyKey(to.company_name)) throw fail(400, 'Move people only to a role at the same company.');
  if (['closed', 'applied'].includes(to.status)) throw fail(409, `That role is ${to.status}, so it takes no new outreach.`);
  const people = ids(contactIds);
  if (!people.length) throw fail(400, 'Pick at least one person.');
  const there = new Set((await all('SELECT contact_id FROM outreach_drafts WHERE plan_item_id = $1 AND status <> \'closed\' AND contact_id = ANY($2::bigint[])', [toId, people])).map(r => Number(r.contact_id)));
  const movable = (await all(
    `SELECT id, contact_id FROM outreach_drafts WHERE user_id = $1 AND plan_item_id = $2 AND contact_id = ANY($3::bigint[]) AND status IN ('draft', 'edited', 'approved')`,
    [userId, fromId, people],
  )).filter(d => !there.has(Number(d.contact_id)));
  // Their waiting emails and notes on the old role go first (they were written for it).
  const dropped = await dropUnsent(userId, people.filter(p => there.has(p)), [Number(fromId)], 'Moved to another role');
  await dropOutboxAndNotesOnly(userId, movable.map(d => Number(d.contact_id)), Number(fromId));
  let moved = 0;
  for (const d of movable) {
    try {
      const r = await run(
        `UPDATE outreach_drafts SET plan_item_id = $2, email_subject = NULL, email_body = NULL, linkedin_note = NULL, also_plan_items = NULL, status = 'draft', updated_at = NOW()
          WHERE id = $1 AND user_id = $3`,
        [d.id, toId, userId],
      );
      moved += r.rowCount;
    } catch (err) {
      if (/limit|no outreach/i.test(String(err.message))) throw fail(409, `${to.title} can’t take more people: ${String(err.message).replace(/^Role \d+:?\s*/, '')}.`);
      throw err;
    }
  }
  if (moved) await run('UPDATE tailor_jobs SET outreach_due = TRUE, updated_at = NOW() WHERE plan_item_id = $1 AND user_id = $2', [toId, userId]);
  // alreadyThere: people the other role already had, so they just left this one.
  return { moved, alreadyThere: there.size, left: dropped.drafts, to: { id: String(toId), title: to.title } };
}

/** Waiting emails and unsent notes for these people on one role, keeping their draft rows (moving them). */
async function dropOutboxAndNotesOnly(userId, contactIds, planItemId) {
  if (!contactIds.length) return;
  const outbox = await all(
    `SELECT DISTINCT o.id FROM email_outbox o JOIN referral_asks a ON a.outbox_id = o.id
      WHERE o.user_id = $1 AND o.contact_id = ANY($2::bigint[]) AND a.plan_item_id = $3 AND o.status IN ('draft', 'scheduled')`,
    [userId, contactIds, planItemId],
  );
  const { cancelScheduled } = await import('./outbox.js');
  for (const o of outbox) await cancelScheduled(userId, o.id, 'Moved to another role');
  await run(
    `DELETE FROM referral_asks a WHERE a.user_id = $1 AND a.contact_id = ANY($2::bigint[]) AND a.plan_item_id = $3
        AND ((a.channel = 'linkedin' AND a.status = 'to_send') OR (a.channel = 'email' AND a.status IN ('draft', 'scheduled')))`,
    [userId, contactIds, planItemId],
  );
}

/**
 * Delete people: their unsent emails and notes go everywhere. Someone you
 * already emailed, or who replied, is kept for the history (closed, so nothing
 * new goes to them); everyone else is deleted.
 */
export async function deleteContacts(userId, contactIds) {
  const people = ids(contactIds);
  if (!people.length) throw fail(400, 'Pick at least one person.');
  const mine = (await all('SELECT id FROM job_contacts WHERE user_id = $1 AND id = ANY($2::bigint[])', [userId, people])).map(r => Number(r.id));
  const dropped = await dropUnsent(userId, mine, null, 'You deleted the contact');
  const kept = (await all(
    `SELECT DISTINCT c.id FROM job_contacts c
      WHERE c.id = ANY($1::bigint[]) AND (
        EXISTS (SELECT 1 FROM email_outbox o WHERE o.contact_id = c.id AND o.status IN ('sending', 'sent'))
        OR EXISTS (SELECT 1 FROM email_replies r WHERE r.contact_id = c.id)
        OR EXISTS (SELECT 1 FROM referral_asks a WHERE a.contact_id = c.id AND a.status IN ('sent', 'marked_sent', 'replied')))`,
    [mine],
  )).map(r => Number(r.id));
  if (kept.length) await run("UPDATE job_contacts SET status = 'closed' WHERE id = ANY($1::bigint[]) AND user_id = $2", [kept, userId]);
  const gone = mine.filter(id => !kept.includes(id));
  if (gone.length) await run('DELETE FROM job_contacts WHERE id = ANY($1::bigint[]) AND user_id = $2', [gone, userId]);
  return { deleted: gone.length, keptForHistory: kept.length, emails: dropped.emails + dropped.drafts, notes: dropped.notes };
}

/** What "Delete all contacts" at a company would take: people, and unsent emails. */
export async function companyContactsSummary(userId, company) {
  const key = companyKey(company);
  return one(
    `SELECT max(j.name) AS company, COUNT(DISTINCT c.id)::int AS contacts,
            (SELECT COUNT(*)::int FROM outreach_drafts d JOIN job_contacts c2 ON c2.id = d.contact_id JOIN jobs j2 ON j2.id = c2.job_id
              WHERE d.user_id = $1 AND lower(trim(j2.name)) = $2 AND d.status IN ('draft', 'edited', 'approved') AND COALESCE(btrim(c2.email), '') <> ''
                AND NOT EXISTS (SELECT 1 FROM referral_asks a JOIN email_outbox o ON o.id = a.outbox_id
                                 WHERE a.plan_item_id = d.plan_item_id AND a.contact_id = d.contact_id AND o.status IN ('sending', 'sent'))) AS unsent_emails
       FROM job_contacts c JOIN jobs j ON j.id = c.job_id
      WHERE c.user_id = $1 AND lower(trim(j.name)) = $2 AND COALESCE(c.status, 'pending') <> 'closed'`,
    [userId, key],
  );
}

export async function deleteCompanyContacts(userId, company) {
  const people = (await all(
    `SELECT c.id FROM job_contacts c JOIN jobs j ON j.id = c.job_id WHERE c.user_id = $1 AND lower(trim(j.name)) = $2 AND COALESCE(c.status, 'pending') <> 'closed'`,
    [userId, companyKey(company)],
  )).map(r => r.id);
  if (!people.length) return { deleted: 0, keptForHistory: 0, emails: 0, notes: 0 };
  return deleteContacts(userId, people);
}

// ── No outreach for a company ───────────────────────────────────────────────

export async function companyOutreach(userId, company) {
  const row = await one('SELECT no_outreach FROM company_prefs WHERE user_id = $1 AND company_key = $2', [userId, companyKey(company)]);
  return { company: str(company), noOutreach: Boolean(row?.no_outreach) };
}

/**
 * The switch. On: no new outreach rows for the company (the database refuses
 * them, migration 062), and what's unsent is closed: drafts closed with the
 * reason, waiting emails cancelled, notes still to send removed. Sent ones stay.
 */
export async function setCompanyOutreach(userId, company, noOutreach) {
  const key = companyKey(company);
  if (!key) throw fail(400, 'Which company?');
  await run(
    `INSERT INTO company_prefs (user_id, company_key, no_outreach) VALUES ($1, $2, $3)
     ON CONFLICT (user_id, company_key) DO UPDATE SET no_outreach = EXCLUDED.no_outreach, updated_at = NOW()`,
    [userId, key, Boolean(noOutreach)],
  );
  if (!noOutreach) return { company: str(company), noOutreach: false, closed: 0, cancelled: 0, notes: 0 };
  const roles = (await all('SELECT pi.id FROM plan_items pi JOIN tailor_jobs j ON j.plan_item_id = pi.id WHERE pi.user_id = $1 AND lower(trim(pi.company_name)) = $2', [userId, key])).map(r => Number(r.id));
  if (!roles.length) return { company: str(company), noOutreach: true, closed: 0, cancelled: 0, notes: 0 };
  const outbox = await all(
    `SELECT DISTINCT o.id FROM email_outbox o JOIN referral_asks a ON a.outbox_id = o.id
      WHERE o.user_id = $1 AND a.plan_item_id = ANY($2::bigint[]) AND o.status IN ('draft', 'scheduled')`,
    [userId, roles],
  );
  const { cancelScheduled } = await import('./outbox.js');
  for (const o of outbox) await cancelScheduled(userId, o.id, 'No outreach for this company');
  const notes = await run("DELETE FROM referral_asks WHERE user_id = $1 AND plan_item_id = ANY($2::bigint[]) AND channel = 'linkedin' AND status = 'to_send'", [userId, roles]);
  const closed = await run(
    `UPDATE outreach_drafts d SET status = 'closed', closed_reason = 'No outreach for this company (your choice)', closed_at = NOW(), updated_at = NOW()
      WHERE d.user_id = $1 AND d.plan_item_id = ANY($2::bigint[]) AND d.status IN ('draft', 'edited', 'approved')
        AND NOT EXISTS (SELECT 1 FROM referral_asks a JOIN email_outbox o ON o.id = a.outbox_id
                         WHERE a.plan_item_id = d.plan_item_id AND a.contact_id = d.contact_id AND o.status IN ('sending', 'sent'))`,
    [userId, roles],
  );
  await run('UPDATE tailor_jobs SET outreach_due = FALSE WHERE user_id = $1 AND plan_item_id = ANY($2::bigint[])', [userId, roles]);
  return { company: str(company), noOutreach: true, closed: closed.rowCount, cancelled: outbox.length, notes: notes.rowCount };
}

/** Companies with outreach switched off, by key. */
export async function noOutreachCompanies(userId) {
  return new Set((await all('SELECT company_key FROM company_prefs WHERE user_id = $1 AND no_outreach', [userId])).map(r => r.company_key));
}
