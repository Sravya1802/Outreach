/**
 * outreachApproval.js — "Approve all" for outreach emails your Claude run has
 * finished writing, on the Review queue (every role) or one Role page.
 *
 * Two kinds of email are approved:
 *   • waiting in Outbox (a role you approved put them there, with a Gmail
 *     Drafts copy): your edits in Gmail are kept, the copy is removed, and the
 *     email is scheduled;
 *   • written on a Ready or approved role but not yet in Outbox: it goes
 *     straight to scheduled, with the role's latest tailored resume (attached
 *     when it goes). Approving emails doesn't approve the role's resume or
 *     start applying; Approve on the role does that.
 * Skipped, with the reason counted: still empty or being written, not written
 * by your Claude run, the role's resume not ready, a check that fails, the
 * person already asked for another role or replied, a Gmail copy gone or
 * unreadable. Nothing is sent here: send times come from planApproved (next
 * business morning, 8–10 AM their time, 40 a day, 2–4 minutes apart).
 */

import { all, tx } from '../db.js';
import { connectionFor, deleteUids, draftHash, folderMessagesSince, specialFolder, withImap } from './gmail.js';
import { planApproved, sendBlock } from './outbox.js';
import { askedElsewhere, linkedinSearchUrl, referralEmailMoved } from './referralFlow.js';
import { checkOutreach, isQuantRole } from './tailorPipeline.js';
import { OUTREACH_TZ, timezoneFor } from './sendWindow.js';
import { marketFor } from './markets.js';

const str = (v) => String(v ?? '').trim();

export const SKIP_LABEL = {
  writing: 'still empty or being written by Claude',
  not_claude: 'not written by your Claude run',
  no_resume: 'the role’s resume hasn’t passed its checks',
  problem: 'a check failed (see the role page)',
  asked: 'already emailed or scheduled for another role',
  replied: 'they already replied',
  invalid: 'the address bounced or is invalid',
  not_in_gmail: 'no longer in your Gmail Drafts (sent or deleted there)',
  gmail: 'couldn’t read your Gmail Drafts to check for edits',
};

/**
 * Why one email can't be approved, or null. Pure. `d` is a draft or Outbox
 * row with: subject, body, written_by, name, company, quant, contact_status,
 * email_status, resume_ok.
 */
export function skipReason(d) {
  if (!str(d.subject) || !str(d.body)) return 'writing';
  if (d.email_status === 'invalid') return 'invalid';
  if (d.contact_status === 'replied') return 'replied';
  if (sendBlock(d)) return 'not_claude';
  if (d.resume_ok === false) return 'no_resume';
  if (checkOutreach({ email_body: d.body, name: d.name, company: d.company, quant: d.quant }).length) return 'problem';
  return null;
}

/** { approved, skipped, reasons: [{ reason, label, count, names }] }. Pure. */
export function summarize(approved, skipped) {
  const by = new Map();
  for (const s of skipped) {
    const r = by.get(s.reason) || { reason: s.reason, label: SKIP_LABEL[s.reason] || s.reason, count: 0, names: [] };
    r.count += 1;
    if (r.names.length < 5 && s.name) r.names.push(s.name);
    by.set(s.reason, r);
  }
  return { approved, skipped: skipped.length, reasons: [...by.values()].sort((a, b) => b.count - a.count) };
}

const busy = new Set();

/** The Outbox drafts and the role drafts in scope, each with what skipReason needs. */
async function candidates(userId, planItemId) {
  const latest = `LEFT JOIN LATERAL (SELECT (v.pdf_path IS NOT NULL AND v.check_status = 'passed') AS ok FROM resume_versions v
                   WHERE v.plan_item_id = pi.id ORDER BY v.version DESC LIMIT 1) v ON TRUE`;
  const [outbox, drafts] = await Promise.all([
    all(
      `SELECT o.*, a.plan_item_id, pi.title AS role_title, pi.company_name AS company, pi.job_description, c.status AS contact_status, c.email_status, v.ok AS resume_ok
         FROM email_outbox o
         LEFT JOIN referral_asks a ON a.outbox_id = o.id
         LEFT JOIN plan_items pi ON pi.id = a.plan_item_id
         LEFT JOIN job_contacts c ON c.id = o.contact_id
         ${latest}
        WHERE o.user_id = $1 AND o.status = 'draft' AND ($2::bigint IS NULL OR a.plan_item_id = $2)
        ORDER BY o.id`,
      [userId, planItemId],
    ),
    all(
      `SELECT d.id, d.plan_item_id, d.contact_id, d.email_subject AS subject, d.email_body AS body, d.linkedin_note, d.written_by,
              c.name, c.title, c.email, c.email_status, c.linkedin_url, c.status AS contact_status, jb.location, jb.city, jb.state,
              pi.title AS role_title, pi.company_name AS company, pi.job_description, v.ok AS resume_ok
         FROM outreach_drafts d
         JOIN tailor_jobs j ON j.plan_item_id = d.plan_item_id
         JOIN plan_items pi ON pi.id = d.plan_item_id
         JOIN job_contacts c ON c.id = d.contact_id
         LEFT JOIN jobs jb ON jb.id = c.job_id
         ${latest}
        WHERE d.user_id = $1 AND d.status IN ('draft', 'edited') AND j.status IN ('ready', 'approved')
          AND COALESCE(btrim(c.email), '') <> '' AND ($2::bigint IS NULL OR d.plan_item_id = $2)
        ORDER BY d.plan_item_id, d.audience DESC, d.id`,
      [userId, planItemId],
    ),
  ]);
  const quant = (r) => isQuantRole({ title: r.role_title, company: r.company, description: r.job_description });
  return {
    outbox: outbox.map(o => ({ ...o, name: o.to_name, quant: quant(o), resume_ok: o.plan_item_id ? o.resume_ok === true : true })),
    drafts: drafts.map(d => ({ ...d, quant: quant(d), resume_ok: d.resume_ok === true })),
  };
}

/**
 * Approve every finished email in scope (one role, or all). dryRun says what
 * would happen without changing anything (the Gmail edit check isn't run).
 */
export async function approveWrittenOutreach(userId, { planItemId = null, dryRun = false } = {}) {
  if (dryRun) return approve(userId, planItemId, true);
  if (busy.has(userId)) throw Object.assign(new Error('Already approving your emails. Give it a minute.'), { status: 409 });
  if (!(await connectionFor(userId))) throw Object.assign(new Error('Connect your Gmail under Integrations → Gmail first.'), { status: 400 });
  busy.add(userId);
  try {
    return await approve(userId, planItemId, false);
  } finally {
    busy.delete(userId);
  }
}

async function approve(userId, planItemId, dryRun) {
  const { outbox, drafts } = await candidates(userId, planItemId);
  const skipped = [];
  const skip = (x, reason) => skipped.push({ id: x.id, name: x.name || x.to_name || x.email || x.to_email, company: x.company, reason });

  // Role drafts: one email per person, never someone already emailed or scheduled.
  const okDrafts = [];
  const byRole = new Map();
  for (const d of drafts) {
    const why = skipReason(d);
    if (why) { skip(d, why); continue; }
    byRole.set(d.plan_item_id, [...(byRole.get(d.plan_item_id) || []), d]);
  }
  const active = await all(
    `SELECT contact_id, lower(to_email) AS email FROM email_outbox WHERE user_id = $1 AND step = 0 AND status IN ('draft', 'scheduled', 'sending', 'sent')`,
    [userId],
  );
  const seen = new Set(active.map(a => a.email));
  // Outbox drafts approved now are already in `seen` by their address.
  for (const [roleId, list] of byRole) {
    const repeats = await askedElsewhere(userId, roleId, list);
    for (const d of list) {
      const email = str(d.email).toLowerCase();
      if (repeats.some(r => r.id === d.id) || seen.has(email)) { skip(d, 'asked'); continue; }
      seen.add(email);
      okDrafts.push(d);
    }
  }

  // Outbox drafts: the same checks, then (for real) your Gmail edits.
  let okOutbox = [];
  for (const o of outbox) {
    const why = skipReason(o);
    if (why) skip(o, why);
    else okOutbox.push(o);
  }
  if (dryRun) return { ...summarize(okOutbox.length + okDrafts.length, skipped), dryRun: true };

  let removeUids = [];
  let draftsFolder = null;
  const withCopy = okOutbox.filter(o => o.gmail_draft_hash);
  if (withCopy.length) {
    try {
      await withImap(userId, async (client) => {
        draftsFolder = await specialFolder(client, '\\Drafts');
        const since = withCopy.reduce((m, o) => (new Date(o.created_at) < m ? new Date(o.created_at) : m), new Date());
        const msgs = await folderMessagesSince(client, draftsFolder, since);
        const kept = [];
        for (const o of okOutbox) {
          if (!o.gmail_draft_hash) { kept.push(o); continue; }
          const cutoff = new Date(o.created_at).getTime() - 5 * 60_000;
          const copies = msgs.filter(m => m.to.includes(String(o.to_email).toLowerCase()) && (!m.date || new Date(m.date).getTime() >= cutoff))
            .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
          if (!copies.length) { skip(o, 'not_in_gmail'); continue; }
          const copy = copies[0];
          if (draftHash(copy.subject, copy.text) !== o.gmail_draft_hash && str(copy.text)) {
            const edited = { ...o, subject: str(copy.subject) || o.subject, body: copy.text, body_html: copy.html, written_by: 'you' };
            const why = skipReason(edited);
            if (why) { skip(o, why); continue; }
            kept.push({ ...edited, edited: true });
          } else kept.push(o);
          removeUids.push(...copies.map(m => m.uid));
        }
        okOutbox = kept;
      });
    } catch (err) {
      console.warn('[approve-all] Gmail drafts unreadable', err.message);
      for (const o of withCopy) skip(o, 'gmail');
      okOutbox = okOutbox.filter(o => !o.gmail_draft_hash);
      removeUids = [];
    }
  }

  const fallbackTz = (await marketFor(userId)) === 'india' ? 'Asia/Kolkata' : OUTREACH_TZ;
  const newIds = await tx(async (q) => {
    const ids = [];
    if (okOutbox.length) {
      const r = await q.query(
        `UPDATE email_outbox o SET status = 'scheduled', subject = left(u.subject, 300), body = left(u.body, 20000), body_html = u.html,
                written_by = u.writer, send_after = NOW(), approved_at = NOW(), error = NULL, gmail_draft_hash = NULL, gmail_sync_due = FALSE
           FROM unnest($2::bigint[], $3::text[], $4::text[], $5::text[], $6::text[]) AS u(id, subject, body, html, writer)
          WHERE o.id = u.id AND o.user_id = $1 AND o.status = 'draft' RETURNING o.id`,
        [userId, okOutbox.map(o => o.id), okOutbox.map(o => o.subject), okOutbox.map(o => o.body), okOutbox.map(o => (o.edited ? o.body_html : null)), okOutbox.map(o => o.written_by)],
      );
      ids.push(...r.rows.map(x => x.id));
      await q.query("UPDATE referral_asks SET status = 'scheduled' WHERE outbox_id = ANY($1::bigint[]) AND status = 'draft'", [r.rows.map(x => x.id)]);
    }
    if (okDrafts.length) {
      const tz = okDrafts.map(d => timezoneFor(d.location) || timezoneFor([d.city, d.state].filter(Boolean).join(', ')) || fallbackTz);
      const ins = await q.query(
        `INSERT INTO email_outbox (user_id, contact_id, step, to_email, to_name, subject, body, recipient_tz, send_after, purpose, status, written_by, approved_at)
         SELECT $1, u.contact_id, 0, lower(u.email), u.name, left(u.subject, 300), left(u.body, 20000), u.tz, NOW(), 'referral', 'scheduled', u.writer, NOW()
           FROM unnest($2::bigint[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[], $8::text[]) AS u(contact_id, email, name, subject, body, tz, writer)
         RETURNING id, contact_id`,
        [userId, okDrafts.map(d => d.contact_id), okDrafts.map(d => str(d.email)), okDrafts.map(d => d.name), okDrafts.map(d => str(d.subject)),
          okDrafts.map(d => str(d.body)), tz, okDrafts.map(d => d.written_by)],
      );
      const outboxOf = new Map(ins.rows.map(x => [String(x.contact_id), x.id]));
      ids.push(...ins.rows.map(x => x.id));
      await q.query(
        `INSERT INTO referral_asks (user_id, plan_item_id, channel, person_name, person_title, linkedin_url, email, contact_id, outbox_id, subject, message, status)
         SELECT $1, u.plan_item_id, 'email', u.name, u.title, u.linkedin, u.email, u.contact_id, u.outbox_id, u.subject, u.body, 'scheduled'
           FROM unnest($2::bigint[], $3::text[], $4::text[], $5::text[], $6::text[], $7::bigint[], $8::bigint[], $9::text[], $10::text[])
             AS u(plan_item_id, name, title, linkedin, email, contact_id, outbox_id, subject, body)`,
        [userId, okDrafts.map(d => d.plan_item_id), okDrafts.map(d => d.name), okDrafts.map(d => d.title),
          okDrafts.map(d => d.linkedin_url || linkedinSearchUrl(`${d.name} ${d.company}`)), okDrafts.map(d => str(d.email)),
          okDrafts.map(d => d.contact_id), okDrafts.map(d => outboxOf.get(String(d.contact_id))), okDrafts.map(d => str(d.subject)), okDrafts.map(d => str(d.body))],
      );
      // The LinkedIn note goes to your to-send list with it (you send those by hand).
      const notes = okDrafts.filter(d => str(d.linkedin_note));
      if (notes.length) {
        await q.query(
          `INSERT INTO referral_asks (user_id, plan_item_id, channel, person_name, person_title, linkedin_url, email, contact_id, message, status)
           SELECT $1, u.plan_item_id, 'linkedin', u.name, u.title, u.linkedin, u.email, u.contact_id, u.note, 'to_send'
             FROM unnest($2::bigint[], $3::text[], $4::text[], $5::text[], $6::text[], $7::bigint[], $8::text[]) AS u(plan_item_id, name, title, linkedin, email, contact_id, note)
            WHERE NOT EXISTS (SELECT 1 FROM referral_asks x WHERE x.plan_item_id = u.plan_item_id AND x.contact_id = u.contact_id AND x.channel = 'linkedin')`,
          [userId, notes.map(d => d.plan_item_id), notes.map(d => d.name), notes.map(d => d.title),
            notes.map(d => d.linkedin_url || linkedinSearchUrl(`${d.name} ${d.company}`)), notes.map(d => str(d.email)), notes.map(d => d.contact_id), notes.map(d => str(d.linkedin_note))],
        );
      }
      await q.query("UPDATE outreach_drafts SET status = 'approved', updated_at = NOW() WHERE user_id = $1 AND id = ANY($2::bigint[])", [userId, okDrafts.map(d => d.id)]);
    }
    return ids;
  });

  // The Gmail copies go once they're scheduled, so nothing can be sent twice.
  if (removeUids.length) {
    await withImap(userId, (client) => deleteUids(client, draftsFolder, removeUids))
      .catch(err => console.warn('[approve-all] Gmail draft cleanup', err.message));
  }
  const plan = await planApproved(userId, newIds);
  const times = [...plan.values()].sort((a, b) => a - b);

  // Approved roles: the status line and the 2-business-day wait follow the latest send (again when each one goes).
  holdRoles(userId, newIds).catch(err => console.warn('[approve-all] referral wait update failed', err.message));

  return {
    ...summarize(newIds.length, skipped),
    first: times[0]?.toISOString() ?? null,
    last: times[times.length - 1]?.toISOString() ?? null,
    unplaced: newIds.length - plan.size,
  };
}

/** Each approved role with a newly scheduled email: its wait counts from its latest send. */
async function holdRoles(userId, ids) {
  if (!ids.length) return;
  const latest = await all(
    `SELECT DISTINCT ON (a.plan_item_id) o.* FROM email_outbox o JOIN referral_asks a ON a.outbox_id = o.id
       JOIN plan_items pi ON pi.id = a.plan_item_id
      WHERE o.user_id = $1 AND o.id = ANY($2::bigint[]) AND pi.stage = 'waiting_referral'
      ORDER BY a.plan_item_id, o.send_after DESC`,
    [userId, ids],
  );
  for (const row of latest) await referralEmailMoved(userId, row);
}
