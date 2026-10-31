/**
 * outbox.js — outreach email from each user's own Gmail, on a schedule:
 *   • first email at the next 8–11 AM weekday slot in the recipient's zone
 *     (or right away when the user says so)
 *   • at most `daily_cap` (default 20) a day per user, at least 3 minutes apart
 *   • two follow-ups in the same thread, 4 and 10 business days after the
 *     first one; any reply (or bounce) cancels what's left
 *   • emails the app writes on its own (referral asks) start as drafts: a copy
 *     goes to the user's Gmail Drafts with the resume attached, and nothing is
 *     sent until they approve it here (their edits in Gmail are kept). Sending
 *     or deleting the draft in Gmail is noticed by syncDrafts().
 * runOutbox() is called by a cron every 2 minutes.
 */

import { all, one, run } from '../db.js';
import { connectionFor, draftHash, messagesTo, putDraft, readDraft, removeDraft, sendAs, specialFolder, withImap } from './gmail.js';
import { fileBytes, fileForUser } from './resumeFiles.js';
import { nextSendSlot, businessDaysLater, timezoneFor, describeSlot } from './sendWindow.js';
import { marketFor } from './markets.js';

const FOLLOWUP_DAYS = [4, 10];
const MIN_GAP_MS = 3 * 60_000;
const MAX_ATTEMPTS = 3;

const str = (v) => String(v ?? '').trim();
const firstName = (name) => str(name).split(/\s+/)[0] || 'there';

/** Where the recipient probably is: the company's location, else the user's market. */
export async function recipientTimezone(userId, contactId) {
  const r = await one(
    `SELECT j.location, j.city, j.state FROM job_contacts c JOIN jobs j ON j.id = c.job_id WHERE c.id = $1 AND c.user_id = $2`,
    [contactId, userId],
  );
  const tz = timezoneFor(r?.location) || timezoneFor([r?.city, r?.state].filter(Boolean).join(', '));
  if (tz) return tz;
  return (await marketFor(userId)) === 'india' ? 'Asia/Kolkata' : 'America/New_York';
}

async function senderName(userId) {
  const c = await one('SELECT display_name FROM gmail_connections WHERE user_id = $1', [userId]);
  if (str(c?.display_name)) return str(c.display_name);
  const p = await one('SELECT first_name, last_name FROM user_profile WHERE user_id = $1', [userId]);
  return [p?.first_name, p?.last_name].filter(Boolean).join(' ').trim();
}

/** Short, polite follow-ups with the original quoted underneath. */
export function followupBody(step, { toName, company, sender, original, sentAt, tz }) {
  const hi = `Hi ${firstName(toName)},`;
  const sign = sender ? `\n${sender}` : '';
  const text = step === 1
    ? `${hi}\n\nFollowing up on my note below in case it got buried. I'd really value a few minutes of your perspective on ${company || 'your team'}, whenever suits you.\n\nThanks,${sign}`
    : `${hi}\n\nOne last note from me. If you're not the right person to ask about ${company ? `${company}'s` : 'your'} internship and new-grad hiring, I'd be grateful if you could point me to who is.\n\nThanks again,${sign}`;
  const when = new Intl.DateTimeFormat('en-US', { timeZone: tz || 'America/New_York', weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }).format(sentAt);
  const quoted = str(original).split('\n').map(l => `> ${l}`).join('\n');
  return `${text}\n\nOn ${when}, ${sender || 'I'} wrote:\n${quoted}`;
}

/**
 * Schedule (or send now) the first email to a contact. Returns the outbox row
 * with a human description of when it goes. `draft` holds it for the user's OK
 * (and puts a copy in their Gmail Drafts); `attachmentFileId` is a resume_files id.
 */
export async function scheduleEmail(userId, { contactId, subject, body, when = 'best', purpose = 'outreach', draft = false, attachmentFileId = null }) {
  const contact = await one(
    `SELECT c.*, j.name AS company_name FROM job_contacts c LEFT JOIN jobs j ON j.id = c.job_id WHERE c.id = $1 AND c.user_id = $2`,
    [contactId, userId],
  );
  if (!contact) throw Object.assign(new Error('Contact not found'), { status: 404 });
  if (!str(contact.email)) throw Object.assign(new Error('This contact has no email address yet. Find their email first.'), { status: 400 });
  if (contact.email_status === 'invalid') throw Object.assign(new Error('That email address bounced or is invalid.'), { status: 400 });
  if (contact.status === 'replied') throw Object.assign(new Error('They already replied. Answer them from Gmail.'), { status: 400 });
  if (!str(subject) || !str(body)) throw Object.assign(new Error('Write a subject and a message first.'), { status: 400 });
  if (!(await connectionFor(userId))) throw Object.assign(new Error('Connect your Gmail under Integrations → Gmail to send from here.'), { status: 400 });
  const active = await one(
    // The same address under another contact (the company saved twice) counts too.
    `SELECT id, status FROM email_outbox WHERE user_id = $1 AND (contact_id = $2 OR lower(to_email) = lower($3)) AND step = 0
        AND status IN ('draft','scheduled','sending','sent') LIMIT 1`,
    [userId, contactId, str(contact.email)],
  );
  if (active?.status === 'draft') throw Object.assign(new Error('An email to this person is already waiting for your OK in People → Outbox.'), { status: 409 });
  if (active) throw Object.assign(new Error('You’ve already emailed or scheduled this person. Follow-ups go out on their own.'), { status: 409 });

  const tz = await recipientTimezone(userId, contactId);
  // A draft's send time is set when it's approved.
  const sendAfter = when === 'now' || draft ? new Date() : nextSendSlot(tz);
  const row = (await run(
    `INSERT INTO email_outbox (user_id, contact_id, step, to_email, to_name, subject, body, recipient_tz, send_after, purpose, status, attachment_file_id)
     VALUES ($1, $2, 0, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
    [userId, contactId, str(contact.email).toLowerCase(), contact.name, str(subject).slice(0, 300), str(body).slice(0, 20000), tz, sendAfter,
      purpose === 'referral' ? 'referral' : 'outreach', draft ? 'draft' : 'scheduled', attachmentFileId || null],
  )).rows[0];
  await run('UPDATE job_contacts SET generated_subject = $1, generated_body = $2 WHERE id = $3 AND user_id = $4', [str(subject), str(body), contactId, userId]);
  if (draft) {
    const inGmail = await copyToGmailDrafts(row);
    return { ...row, in_gmail_drafts: inGmail, when: 'draft' };
  }
  if (when === 'now') return { ...(await sendOne(row.id)), when: 'now' };
  return { ...row, when: describeSlot(sendAfter, tz) };
}

/** The row's attachment (the role's tailored resume), ready for nodemailer. */
async function attachmentsFor(row) {
  if (!row.attachment_file_id) return [];
  const file = await fileForUser(row.user_id, row.attachment_file_id);
  if (!file) return [];
  return [{ filename: file.filename || 'resume.pdf', content: await fileBytes(file), contentType: 'application/pdf' }];
}

/** Put (or replace) the Gmail Drafts copy of a draft row. False when Gmail couldn't be reached. */
async function copyToGmailDrafts(row) {
  try {
    const hash = await putDraft(row.user_id, {
      to: row.to_email, toName: row.to_name, subject: row.subject, text: row.body, attachments: await attachmentsFor(row), since: row.created_at,
    });
    await run('UPDATE email_outbox SET gmail_draft_hash = $2 WHERE id = $1', [row.id, hash]);
    return true;
  } catch (err) {
    console.warn('[outbox] Gmail draft copy failed', row.id, err.message);
    return false;
  }
}

/**
 * The user's OK on a draft. If they edited the Gmail copy, that version is
 * what goes. Then it's scheduled like any first email (or sent now).
 */
export async function approveDraft(userId, id, { when = 'best' } = {}) {
  const row = await one('SELECT * FROM email_outbox WHERE id = $1 AND user_id = $2', [id, userId]);
  if (!row) throw Object.assign(new Error('Not found'), { status: 404 });
  if (row.status !== 'draft') throw Object.assign(new Error('This email isn’t waiting for your OK any more.'), { status: 409 });
  if (!(await connectionFor(userId))) throw Object.assign(new Error('Connect your Gmail under Integrations → Gmail to send from here.'), { status: 400 });

  let edit = null;
  if (row.gmail_draft_hash) {
    let copy;
    try {
      copy = await readDraft(userId, { to: row.to_email, since: row.created_at });
    } catch {
      throw Object.assign(new Error('Couldn’t check your Gmail draft for edits. Try again in a minute.'), { status: 502 });
    }
    if (copy && draftHash(copy.subject, copy.text) !== row.gmail_draft_hash && str(copy.text)) edit = copy;
  }
  const sendAfter = when === 'now' ? new Date() : nextSendSlot(row.recipient_tz);
  const updated = (await run(
    `UPDATE email_outbox SET status = 'scheduled', subject = $3, body = $4, body_html = $5, send_after = $6, approved_at = NOW(), error = NULL
      WHERE id = $1 AND user_id = $2 AND status = 'draft' RETURNING *`,
    [row.id, userId, edit ? (str(edit.subject) || row.subject).slice(0, 300) : row.subject, edit ? str(edit.text).slice(0, 20000) : row.body, edit?.html || null, sendAfter],
  )).rows[0];
  if (!updated) throw Object.assign(new Error('This email isn’t waiting for your OK any more.'), { status: 409 });
  // The Gmail copy goes, so it can't be sent twice.
  if (row.gmail_draft_hash) await removeDraft(userId, { to: row.to_email, since: row.created_at }).catch(err => console.warn('[outbox] draft cleanup', row.id, err.message));
  if (when === 'now') return { ...(await sendOne(row.id)), when: 'now', edited_in_gmail: Boolean(edit) };
  return { ...updated, when: describeSlot(sendAfter, row.recipient_tz), edited_in_gmail: Boolean(edit) };
}

/** The user sent the Gmail copy themselves: record it as sent (follow-ups as usual). */
async function markSentFromGmail(row, sent) {
  const set = async (messageId) => (await run(
    `UPDATE email_outbox SET status = 'sent', sent_at = $2, message_id = $3, subject = $4, body = $5, approved_at = NOW(), error = NULL
      WHERE id = $1 AND status = 'draft' RETURNING *`,
    [row.id, sent.date || new Date(), messageId, str(sent.subject) || row.subject, str(sent.text) || row.body],
  )).rows[0];
  let r;
  try { r = await set(sent.messageId); } catch { r = await set(null); } // a duplicate Message-ID shouldn't block it
  if (!r) return null;
  if (r.contact_id) {
    await run("UPDATE job_contacts SET status = CASE WHEN status IN ('replied','closed') THEN status ELSE 'sent' END, last_emailed_at = NOW() WHERE id = $1", [r.contact_id]);
  }
  if (r.purpose !== 'referral') await queueFollowups(r);
  return r;
}

/**
 * Compare the user's drafts with their Gmail: a copy that's gone from Drafts
 * and shows up in Sent was sent by them; gone from both means they deleted it.
 * Returns the rows that changed.
 */
export async function syncDrafts(userId) {
  const drafts = await all("SELECT * FROM email_outbox WHERE user_id = $1 AND status = 'draft' AND gmail_draft_hash IS NOT NULL ORDER BY id LIMIT 50", [userId]);
  if (!drafts.length) return [];
  const changed = [];
  await withImap(userId, async (client) => {
    const draftsFolder = await specialFolder(client, '\\Drafts');
    const sentFolder = await specialFolder(client, '\\Sent');
    for (const row of drafts) {
      if ((await messagesTo(client, draftsFolder, row.to_email, row.created_at)).length) continue;
      const sent = (await messagesTo(client, sentFolder, row.to_email, row.created_at))[0];
      const r = sent
        ? await markSentFromGmail(row, sent)
        : (await run("UPDATE email_outbox SET status = 'cancelled', cancel_reason = 'You deleted it from Gmail Drafts' WHERE id = $1 AND status = 'draft' RETURNING *", [row.id])).rows[0];
      if (r) changed.push(r);
    }
  });
  return changed;
}

async function sentInLastDay(userId) {
  return Number((await one("SELECT COUNT(*)::int AS n FROM email_outbox WHERE user_id = $1 AND status = 'sent' AND sent_at > NOW() - INTERVAL '24 hours'", [userId]))?.n || 0);
}

async function lastSentAt(userId) {
  return (await one("SELECT MAX(sent_at) AS t FROM email_outbox WHERE user_id = $1 AND status = 'sent'", [userId]))?.t || null;
}

async function reschedule(id, at, reason) {
  await run("UPDATE email_outbox SET status = 'scheduled', send_after = $2, error = $3 WHERE id = $1", [id, at, reason]);
}

/** Send one due row. Safe to call twice: the claim makes the second a no-op. */
export async function sendOne(id) {
  const row = (await run(
    "UPDATE email_outbox SET status = 'sending', attempts = attempts + 1 WHERE id = $1 AND status = 'scheduled' RETURNING *",
    [id],
  )).rows[0];
  if (!row) return one('SELECT * FROM email_outbox WHERE id = $1', [id]);

  const contact = row.contact_id ? await one('SELECT status, email_status FROM job_contacts WHERE id = $1', [row.contact_id]) : null;
  if (row.contact_id && !contact) return cancel(row.id, 'Contact deleted');
  if (contact?.status === 'replied') return cancel(row.id, 'They replied');
  if (contact?.email_status === 'invalid') return cancel(row.id, 'Address bounced');
  const conn = await one('SELECT daily_cap, status FROM gmail_connections WHERE user_id = $1', [row.user_id]);
  if (!conn) return cancel(row.id, 'Gmail disconnected');
  if (conn.status === 'error') {
    // Hold until the user reconnects; don't keep logging in with a rejected password.
    const at = nextSendSlot(row.recipient_tz, { now: new Date(Date.now() + 3600_000) });
    await run("UPDATE email_outbox SET status = 'scheduled', send_after = $2, attempts = GREATEST(attempts - 1, 0), error = 'Waiting for you to reconnect Gmail under Integrations → Gmail' WHERE id = $1", [row.id, at]);
    return one('SELECT * FROM email_outbox WHERE id = $1', [row.id]);
  }

  // Cap and spacing push the email later instead of dropping it.
  if (await sentInLastDay(row.user_id) >= (conn.daily_cap || 20)) {
    const at = nextSendSlot(row.recipient_tz, { now: new Date(Date.now() + 12 * 3600_000) });
    await reschedule(row.id, at, `Daily limit of ${conn.daily_cap || 20} reached; moved to ${describeSlot(at, row.recipient_tz)}`);
    return one('SELECT * FROM email_outbox WHERE id = $1', [row.id]);
  }
  const last = await lastSentAt(row.user_id);
  if (last && Date.now() - new Date(last).getTime() < MIN_GAP_MS) {
    await reschedule(row.id, new Date(new Date(last).getTime() + MIN_GAP_MS + Math.floor(Math.random() * 120_000)), null);
    return one('SELECT * FROM email_outbox WHERE id = $1', [row.id]);
  }

  let inReplyTo = null;
  if (row.thread_root_id) {
    const root = await one('SELECT message_id FROM email_outbox WHERE id = $1', [row.thread_root_id]);
    inReplyTo = root?.message_id || null;
  }
  try {
    const messageId = await sendAs(row.user_id, {
      to: row.to_email, toName: row.to_name, subject: row.subject, text: row.body, html: row.body_html || undefined, inReplyTo,
      attachments: await attachmentsFor(row),
    });
    await run("UPDATE email_outbox SET status = 'sent', sent_at = NOW(), message_id = $2, in_reply_to = $3, error = NULL WHERE id = $1", [row.id, messageId, inReplyTo]);
    if (row.contact_id) {
      await run("UPDATE job_contacts SET status = CASE WHEN status IN ('replied','closed') THEN status ELSE 'sent' END, last_emailed_at = NOW() WHERE id = $1", [row.contact_id]);
    }
    // Referral asks get no generic nudges; the referral flow adds an "I've applied" note in the thread.
    if (row.step === 0 && row.purpose !== 'referral') await queueFollowups({ ...row, sent_at: new Date(), message_id: messageId });
  } catch (err) {
    // A rejected password isn't the email's fault: it waits for a reconnect instead of counting toward failure.
    const authFailed = /app password/.test(String(err.message));
    const final = !authFailed && (row.attempts >= MAX_ATTEMPTS || err.status === 400);
    await run(
      `UPDATE email_outbox SET status = $2, error = $3, send_after = CASE WHEN $2 = 'scheduled' THEN NOW() + INTERVAL '30 minutes' ELSE send_after END WHERE id = $1`,
      [row.id, final ? 'failed' : 'scheduled', String(err.message).slice(0, 300)],
    );
  }
  return one('SELECT * FROM email_outbox WHERE id = $1', [row.id]);
}

async function cancel(id, reason) {
  await run("UPDATE email_outbox SET status = 'cancelled', cancel_reason = $2 WHERE id = $1", [id, reason]);
  return one('SELECT * FROM email_outbox WHERE id = $1', [id]);
}

async function queueFollowups(root) {
  const company = (await one('SELECT j.name FROM job_contacts c JOIN jobs j ON j.id = c.job_id WHERE c.id = $1', [root.contact_id]))?.name || '';
  const sender = await senderName(root.user_id);
  const subject = /^re:/i.test(root.subject) ? root.subject : `Re: ${root.subject}`;
  for (const [i, days] of FOLLOWUP_DAYS.entries()) {
    const step = i + 1;
    await run(
      `INSERT INTO email_outbox (user_id, contact_id, step, thread_root_id, to_email, to_name, subject, body, recipient_tz, send_after)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [root.user_id, root.contact_id, step, root.id, root.to_email, root.to_name, subject,
        followupBody(step, { toName: root.to_name, company, sender, original: root.body, sentAt: root.sent_at, tz: root.recipient_tz }),
        root.recipient_tz, businessDaysLater(root.sent_at, days, root.recipient_tz)],
    );
  }
}

/**
 * Add one short note in the same thread as a sent (or scheduled) email, at the
 * recipient's next morning slot. Returns the new row, or null if the thread is gone.
 */
export async function scheduleThreadNote(userId, rootId, { body, when = 'best' }) {
  const root = await one("SELECT * FROM email_outbox WHERE id = $1 AND user_id = $2 AND step = 0 AND status IN ('scheduled','sending','sent')", [rootId, userId]);
  if (!root) return null;
  const contact = root.contact_id ? await one('SELECT status FROM job_contacts WHERE id = $1', [root.contact_id]) : null;
  if (contact?.status === 'replied') return null;
  const subject = /^re:/i.test(root.subject) ? root.subject : `Re: ${root.subject}`;
  const at = when === 'now' ? new Date() : nextSendSlot(root.recipient_tz, { now: new Date(Math.max(Date.now(), new Date(root.send_after).getTime() + 3600_000)) });
  return (await run(
    `INSERT INTO email_outbox (user_id, contact_id, step, thread_root_id, to_email, to_name, subject, body, recipient_tz, send_after, purpose)
     VALUES ($1, $2, 1, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
    [userId, root.contact_id, root.id, root.to_email, root.to_name, subject, str(body).slice(0, 20000), root.recipient_tz, at, root.purpose],
  )).rows[0];
}

/** Cancel everything still scheduled for a contact (reply, bounce, user's call). */
export async function cancelForContact(contactId, reason) {
  const r = await run("UPDATE email_outbox SET status = 'cancelled', cancel_reason = $2 WHERE contact_id = $1 AND status = 'scheduled'", [contactId, reason]);
  return r.rowCount;
}

let running = false;
/** Send whatever is due. Called by cron; one pass at a time. */
export async function runOutbox({ limit = 25 } = {}) {
  if (running) return { skipped: true };
  running = true;
  let sent = 0;
  try {
    // Rows stuck in 'sending' (crash mid-send) go back after 10 minutes.
    await run("UPDATE email_outbox SET status = 'scheduled' WHERE status = 'sending' AND send_after < NOW() - INTERVAL '10 minutes' AND sent_at IS NULL AND message_id IS NULL");
    const due = await all("SELECT id FROM email_outbox WHERE status = 'scheduled' AND send_after <= NOW() ORDER BY send_after LIMIT $1", [limit]);
    for (const d of due) {
      const r = await sendOne(d.id).catch(err => { console.error('[outbox] send failed', d.id, err.message); return null; });
      if (r?.status === 'sent') sent += 1;
    }
    return { due: due.length, sent };
  } finally {
    running = false;
  }
}

export async function listOutbox(userId, { contactIds = null } = {}) {
  return all(
    `SELECT o.id, o.contact_id, o.step, o.thread_root_id, o.to_email, o.to_name, o.subject, o.body, o.recipient_tz, o.send_after,
            o.status, o.cancel_reason, o.error, o.sent_at, o.created_at, o.purpose, o.approved_at, (o.gmail_draft_hash IS NOT NULL) AS in_gmail_drafts,
            o.attachment_file_id, f.filename AS attachment_name,
            j.name AS company_name, j.id AS company_id, c.status AS contact_status, c.title AS contact_title, (c.email_status = 'guessed' AND lower(c.email) = lower(o.to_email)) AS email_guessed
       FROM email_outbox o
       LEFT JOIN job_contacts c ON c.id = o.contact_id
       LEFT JOIN jobs j ON j.id = c.job_id
       LEFT JOIN resume_files f ON f.id = o.attachment_file_id AND f.user_id = o.user_id
      WHERE o.user_id = $1 AND ($2::bigint[] IS NULL OR o.contact_id = ANY($2))
      ORDER BY COALESCE(o.thread_root_id, o.id) DESC, o.step
      LIMIT 600`,
    [userId, contactIds],
  );
}

/** Edit an email that hasn't gone out. A draft's Gmail copy is replaced to match. */
export async function editScheduled(userId, id, { subject, body }) {
  const r = await run(
    `UPDATE email_outbox SET subject = COALESCE($3, subject), body = COALESCE($4, body), body_html = NULL
      WHERE id = $1 AND user_id = $2 AND status IN ('draft', 'scheduled') RETURNING *`,
    [id, userId, str(subject) || null, str(body) || null],
  );
  const row = r.rows[0] || null;
  if (row?.status === 'draft' && row.gmail_draft_hash) await copyToGmailDrafts(row);
  return row;
}

/** Cancel one email (or discard a draft); cancelling the first email cancels its follow-ups too. */
export async function cancelScheduled(userId, id, reason = null) {
  const row = await one('SELECT * FROM email_outbox WHERE id = $1 AND user_id = $2', [id, userId]);
  if (!row) return null;
  const why = reason || (row.status === 'draft' ? 'You discarded it' : 'You cancelled it');
  await run(
    "UPDATE email_outbox SET status = 'cancelled', cancel_reason = $3 WHERE user_id = $1 AND status IN ('draft', 'scheduled') AND (id = $2 OR thread_root_id = $2)",
    [userId, row.step === 0 ? row.id : -1, why],
  );
  if (row.step !== 0) await run("UPDATE email_outbox SET status = 'cancelled', cancel_reason = $2 WHERE id = $1 AND status = 'scheduled'", [id, why]);
  if (row.status === 'draft' && row.gmail_draft_hash) {
    await removeDraft(userId, { to: row.to_email, since: row.created_at }).catch(err => console.warn('[outbox] draft cleanup', row.id, err.message));
  }
  return one('SELECT * FROM email_outbox WHERE id = $1', [id]);
}
