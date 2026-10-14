/**
 * outbox.js — outreach email from each user's own Gmail, on a schedule:
 *   • first email at the next 8–11 AM weekday slot in the recipient's zone
 *     (or right away when the user says so)
 *   • at most `daily_cap` (default 20) a day per user, at least 3 minutes apart
 *   • two follow-ups in the same thread, 4 and 10 business days after the
 *     first one; any reply (or bounce) cancels what's left
 * runOutbox() is called by a cron every 2 minutes.
 */

import { all, one, run } from '../db.js';
import { connectionFor, sendAs } from './gmail.js';
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
 * with a human description of when it goes.
 */
export async function scheduleEmail(userId, { contactId, subject, body, when = 'best' }) {
  const contact = await one(
    `SELECT c.*, j.name AS company_name FROM job_contacts c LEFT JOIN jobs j ON j.id = c.job_id WHERE c.id = $1 AND c.user_id = $2`,
    [contactId, userId],
  );
  if (!contact) throw Object.assign(new Error('Contact not found'), { status: 404 });
  if (!str(contact.email)) throw Object.assign(new Error('This contact has no email address yet. Find their email first.'), { status: 400 });
  if (contact.email_status === 'invalid') throw Object.assign(new Error('That email address bounced or is invalid.'), { status: 400 });
  if (contact.status === 'replied') throw Object.assign(new Error('They already replied. Answer them from Gmail.'), { status: 400 });
  if (!str(subject) || !str(body)) throw Object.assign(new Error('Write a subject and a message first.'), { status: 400 });
  if (!(await connectionFor(userId))) throw Object.assign(new Error('Connect your Gmail in Settings to send from here.'), { status: 400 });
  const active = await one(
    "SELECT id FROM email_outbox WHERE user_id = $1 AND contact_id = $2 AND step = 0 AND status IN ('scheduled','sending','sent') LIMIT 1",
    [userId, contactId],
  );
  if (active) throw Object.assign(new Error('You’ve already emailed or scheduled this person. Follow-ups go out on their own.'), { status: 409 });

  const tz = await recipientTimezone(userId, contactId);
  const sendAfter = when === 'now' ? new Date() : nextSendSlot(tz);
  const row = (await run(
    `INSERT INTO email_outbox (user_id, contact_id, step, to_email, to_name, subject, body, recipient_tz, send_after)
     VALUES ($1, $2, 0, $3, $4, $5, $6, $7, $8) RETURNING *`,
    [userId, contactId, str(contact.email).toLowerCase(), contact.name, str(subject).slice(0, 300), str(body).slice(0, 20000), tz, sendAfter],
  )).rows[0];
  await run('UPDATE job_contacts SET generated_subject = $1, generated_body = $2 WHERE id = $3 AND user_id = $4', [str(subject), str(body), contactId, userId]);
  if (when === 'now') return { ...(await sendOne(row.id)), when: 'now' };
  return { ...row, when: describeSlot(sendAfter, tz) };
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
    await run("UPDATE email_outbox SET status = 'scheduled', send_after = $2, attempts = GREATEST(attempts - 1, 0), error = 'Waiting for you to reconnect Gmail in Settings' WHERE id = $1", [row.id, at]);
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
    const messageId = await sendAs(row.user_id, { to: row.to_email, toName: row.to_name, subject: row.subject, text: row.body, inReplyTo });
    await run("UPDATE email_outbox SET status = 'sent', sent_at = NOW(), message_id = $2, in_reply_to = $3, error = NULL WHERE id = $1", [row.id, messageId, inReplyTo]);
    if (row.contact_id) {
      await run("UPDATE job_contacts SET status = CASE WHEN status IN ('replied','closed') THEN status ELSE 'sent' END, last_emailed_at = NOW() WHERE id = $1", [row.contact_id]);
    }
    if (row.step === 0) await queueFollowups({ ...row, sent_at: new Date(), message_id: messageId });
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

export async function listOutbox(userId) {
  return all(
    `SELECT o.id, o.contact_id, o.step, o.thread_root_id, o.to_email, o.to_name, o.subject, o.body, o.recipient_tz, o.send_after,
            o.status, o.cancel_reason, o.error, o.sent_at, o.created_at, j.name AS company_name, j.id AS company_id, c.status AS contact_status
       FROM email_outbox o
       LEFT JOIN job_contacts c ON c.id = o.contact_id
       LEFT JOIN jobs j ON j.id = c.job_id
      WHERE o.user_id = $1
      ORDER BY COALESCE(o.thread_root_id, o.id) DESC, o.step
      LIMIT 600`,
    [userId],
  );
}

export async function editScheduled(userId, id, { subject, body }) {
  const r = await run(
    `UPDATE email_outbox SET subject = COALESCE($3, subject), body = COALESCE($4, body)
      WHERE id = $1 AND user_id = $2 AND status = 'scheduled' RETURNING *`,
    [id, userId, str(subject) || null, str(body) || null],
  );
  return r.rows[0] || null;
}

/** Cancel one email; cancelling the first email cancels its follow-ups too. */
export async function cancelScheduled(userId, id) {
  const row = await one('SELECT * FROM email_outbox WHERE id = $1 AND user_id = $2', [id, userId]);
  if (!row) return null;
  await run(
    "UPDATE email_outbox SET status = 'cancelled', cancel_reason = 'You cancelled it' WHERE user_id = $1 AND status = 'scheduled' AND (id = $2 OR thread_root_id = $2)",
    [userId, row.step === 0 ? row.id : -1],
  );
  if (row.step !== 0) await run("UPDATE email_outbox SET status = 'cancelled', cancel_reason = 'You cancelled it' WHERE id = $1 AND status = 'scheduled'", [id]);
  return one('SELECT * FROM email_outbox WHERE id = $1', [id]);
}
