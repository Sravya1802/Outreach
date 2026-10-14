/**
 * replyWatcher.js — reads each connected inbox (IMAP, read-only) and turns
 * what it finds into contact updates:
 *   • a reply to one of our emails (by thread headers, or from an address we
 *     emailed) → contact "replied", follow-ups cancelled, the user is told
 *   • an out-of-office auto-reply → noted; follow-ups keep their schedule
 *   • a bounce → address marked invalid, follow-ups cancelled
 *   • LinkedIn's "X sent you a message" / "X accepted your invitation"
 *     emails → that contact marked replied / connected
 * Nothing is marked read or moved: the mailbox is opened read-only.
 */

import { all, one, run } from '../db.js';
import { connectionFor, friendlyGmailError, imapClient, markError, sendToSelf } from './gmail.js';
import { cancelForContact } from './outbox.js';

const LOOKBACK_DAYS = 2;
const MAX_MESSAGES = 400;

const lc = (s) => String(s ?? '').trim().toLowerCase();
export const normName = (s) => lc(s).normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();

/** "In-Reply-To: <a@x>\r\nReferences: <b@y> <c@z>" → { 'in-reply-to': [...], references: [...], … } */
export function parseHeaderBlock(buf) {
  const text = String(buf ?? '').replace(/\r?\n[ \t]+/g, ' ');
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^([A-Za-z-]+):\s*(.*)$/.exec(line);
    if (m) out[m[1].toLowerCase()] = m[2].trim();
  }
  return out;
}

export const messageIdsIn = (s) => String(s ?? '').match(/<[^<>\s]+>/g) || [];

/** LinkedIn notification subjects → who and what. */
export function linkedinEvent(subject) {
  const s = String(subject ?? '').trim();
  let m = /^(.+?),?\s+(?:has\s+)?accepted your invitation/i.exec(s);
  if (m) return { kind: 'linkedin_accept', name: m[1] };
  m = /^(.+?)\s+(?:just\s+)?(?:sent you a(?: new)? message|messaged you|replied to your message)/i.exec(s)
    || /^(?:new|you have a new) message from\s+(.+?)\s*$/i.exec(s);
  if (m) return { kind: 'linkedin_message', name: m[1] };
  return null;
}

export function looksAutoReply(headers, subject) {
  const auto = lc(headers['auto-submitted']);
  if (auto && auto !== 'no') return true;
  if (headers['x-autoreply'] || headers['x-autorespond'] || lc(headers['precedence']) === 'auto_reply') return true;
  return /\b(out of (the )?office|automatic reply|auto[- ]?reply|autoreply|away from (the )?office|on leave|vacation)\b/i.test(String(subject ?? ''));
}

export const isBounceSender = (addr) => /^(mailer-daemon|postmaster)@/i.test(String(addr ?? ''));

async function snippetOf(client, uid) {
  try {
    const msg = await client.fetchOne(uid, { source: { maxLength: 60_000 } }, { uid: true });
    const { simpleParser } = await import('mailparser');
    const parsed = await simpleParser(msg.source);
    const text = String(parsed.text || '').split(/\r?\n/).filter(l => !/^>/.test(l)).join('\n');
    const cut = text.search(/\n\s*On .{5,120}wrote:\s*\n/);
    return { snippet: (cut > 0 ? text.slice(0, cut) : text).replace(/\s+/g, ' ').trim().slice(0, 400), raw: String(msg.source).slice(0, 60_000) };
  } catch { return { snippet: '', raw: '' }; }
}

/** One pass over one user's inbox. Returns the new events it recorded. */
export async function checkInbox(userId) {
  const conn = await connectionFor(userId);
  if (!conn) return { skipped: 'not_connected' };

  const sent = await all(
    "SELECT id, contact_id, message_id, lower(to_email) AS to_email FROM email_outbox WHERE user_id = $1 AND status = 'sent' AND sent_at > NOW() - INTERVAL '120 days'",
    [userId],
  );
  const byMessageId = new Map(sent.filter(s => s.message_id).map(s => [s.message_id, s]));
  const byAddress = new Map(sent.map(s => [s.to_email, s]));
  const people = await all(
    `SELECT c.id, c.name, lower(c.email) AS email, c.status, j.name AS company_name
       FROM job_contacts c LEFT JOIN jobs j ON j.id = c.job_id WHERE c.user_id = $1`,
    [userId],
  );
  for (const p of people) if (p.email && !byAddress.has(p.email) && ['sent', 'dm_sent'].includes(p.status)) byAddress.set(p.email, { contact_id: p.id, id: null });
  const contactById = new Map(people.map(p => [Number(p.id), p]));
  const nameCount = new Map();
  for (const p of people) { const n = normName(p.name); if (n) nameCount.set(n, (nameCount.get(n) || 0) + 1); }
  const byName = new Map(people.filter(p => nameCount.get(normName(p.name)) === 1).map(p => [normName(p.name), p]));

  const client = imapClient(conn.email, conn.pass);
  const events = [];
  try {
    await client.connect();
  } catch (err) {
    await markError(userId, err);
    throw Object.assign(new Error(friendlyGmailError(err)), { status: 502 });
  }
  try {
    const lock = await client.getMailboxLock('INBOX', { readOnly: true });
    try {
      const since = new Date(new Date(conn.last_checked_at || conn.connected_at).getTime() - LOOKBACK_DAYS * 86400_000);
      const uids = (await client.search({ since }, { uid: true })) || [];
      const fetchList = uids.slice(-MAX_MESSAGES);
      const candidates = [];
      if (fetchList.length) {
        for await (const msg of client.fetch(fetchList, {
          uid: true, envelope: true, internalDate: true,
          headers: ['in-reply-to', 'references', 'auto-submitted', 'x-autoreply', 'x-autorespond', 'precedence'],
        }, { uid: true })) {
          candidates.push(msg);
        }
      }
      for (const msg of candidates) {
        const env = msg.envelope || {};
        const from = env.from?.[0] || {};
        const fromAddr = lc(from.address);
        if (!env.messageId || fromAddr === lc(conn.email)) continue;
        const headers = parseHeaderBlock(msg.headers);
        const refs = [...messageIdsIn(headers['in-reply-to']), ...messageIdsIn(headers.references)];
        let event = null;

        if (isBounceSender(fromAddr)) {
          const { snippet, raw } = await snippetOf(client, msg.uid);
          const ourId = [...byMessageId.keys()].find(id => raw.includes(id));
          const hit = ourId ? byMessageId.get(ourId) : [...byAddress.entries()].find(([addr]) => raw.toLowerCase().includes(addr))?.[1];
          if (hit) event = { channel: 'email', kind: 'bounce', contactId: hit.contact_id, outboxId: hit.id, snippet };
        } else if (/(^|\.)linkedin\.com$/i.test(fromAddr.split('@')[1] || '')) {
          const li = linkedinEvent(env.subject);
          const person = li && byName.get(normName(li.name));
          if (person) event = { channel: 'linkedin', kind: li.kind, contactId: person.id, outboxId: null, snippet: env.subject };
        } else {
          const hit = refs.map(r => byMessageId.get(r)).find(Boolean) || byAddress.get(fromAddr);
          if (hit) {
            const { snippet } = await snippetOf(client, msg.uid);
            event = { channel: 'email', kind: looksAutoReply(headers, env.subject) ? 'auto_reply' : 'reply', contactId: hit.contact_id, outboxId: hit.id, snippet };
          }
        }
        if (!event) continue;

        const inserted = (await run(
          `INSERT INTO email_replies (user_id, contact_id, outbox_id, channel, kind, from_email, from_name, subject, snippet, message_id, received_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) ON CONFLICT (user_id, message_id) DO NOTHING RETURNING id`,
          [userId, event.contactId, event.outboxId, event.channel, event.kind, fromAddr, from.name || null, env.subject || null, event.snippet || null,
            env.messageId, msg.internalDate || env.date || new Date()],
        )).rows[0];
        if (!inserted) continue;
        await applyEvent(userId, event);
        events.push({ ...event, fromName: from.name, subject: env.subject, contact: contactById.get(Number(event.contactId)) });
      }
    } finally {
      lock.release();
    }
    await run("UPDATE gmail_connections SET last_checked_at = NOW(), status = 'ok', last_error = NULL WHERE user_id = $1", [userId]);
  } finally {
    await client.logout().catch(() => {});
  }
  if (events.some(e => e.kind !== 'auto_reply')) await notify(userId, events.filter(e => e.kind !== 'auto_reply')).catch(err => console.warn('[replies] notify failed:', err.message));
  return { events: events.length };
}

async function applyEvent(userId, e) {
  if (!e.contactId) return;
  if (e.kind === 'reply' || e.kind === 'linkedin_message') {
    await run("UPDATE job_contacts SET status = 'replied', replied_at = NOW() WHERE id = $1 AND user_id = $2", [e.contactId, userId]);
    await cancelForContact(e.contactId, e.kind === 'reply' ? 'They replied' : 'They replied on LinkedIn');
  } else if (e.kind === 'linkedin_accept') {
    await run("UPDATE job_contacts SET status = CASE WHEN status = 'replied' THEN status ELSE 'connected' END WHERE id = $1 AND user_id = $2", [e.contactId, userId]);
  } else if (e.kind === 'bounce') {
    await run("UPDATE job_contacts SET email_status = 'invalid' WHERE id = $1 AND user_id = $2", [e.contactId, userId]);
    await cancelForContact(e.contactId, 'The address bounced');
  }
}

const SITE = process.env.FRONTEND_URL || 'https://outreach-jt.vercel.app';

export function describeEvent(e) {
  const who = e.contact?.name || e.fromName || 'Someone';
  const at = e.contact?.company_name ? ` (${e.contact.company_name})` : '';
  if (e.kind === 'reply') return `${who}${at} replied: “${e.snippet || e.subject || ''}”`;
  if (e.kind === 'linkedin_message') return `${who}${at} messaged you on LinkedIn. Read it on LinkedIn.`;
  if (e.kind === 'linkedin_accept') return `${who}${at} accepted your LinkedIn invitation.`;
  if (e.kind === 'bounce') return `Your email to ${who}${at} bounced. The address is marked invalid and follow-ups are cancelled.`;
  return `${who}${at}: ${e.subject || ''}`;
}

async function notify(userId, events) {
  const lines = events.map(describeEvent);
  const first = events[0];
  const subject = events.length === 1
    ? (first.kind === 'reply' ? `${first.contact?.name || first.fromName || 'Someone'} replied` : lines[0].slice(0, 90))
    : `${events.length} updates on your outreach`;
  const text = `${lines.join('\n\n')}\n\nSee everything: ${SITE}/outreach/outbox\n\n(OutreachOS sent this from your own Gmail.)`;
  await sendToSelf(userId, { subject: `[OutreachOS] ${subject}`, text });
}

let busy = false;
/** Check every connected inbox once (cron). */
export async function checkAllInboxes() {
  if (busy) return { skipped: true };
  busy = true;
  let checked = 0;
  let events = 0;
  try {
    const users = await all(
      // A rejected password isn't retried (Google locks accounts that keep failing); reconnecting sets it back to ok.
      "SELECT user_id FROM gmail_connections WHERE status = 'ok'",
    );
    for (const u of users) {
      try {
        const r = await checkInbox(u.user_id);
        checked += 1;
        events += r.events || 0;
      } catch (err) {
        console.warn(`[replies] ${String(u.user_id).slice(0, 8)}: ${err.message}`);
      }
    }
  } finally {
    busy = false;
  }
  return { checked, events };
}

export async function listReplies(userId) {
  return all(
    `SELECT r.id, r.contact_id, r.channel, r.kind, r.from_email, r.from_name, r.subject, r.snippet, r.received_at, r.seen,
            c.name AS contact_name, j.name AS company_name, j.id AS company_id
       FROM email_replies r LEFT JOIN job_contacts c ON c.id = r.contact_id LEFT JOIN jobs j ON j.id = c.job_id
      WHERE r.user_id = $1 ORDER BY r.received_at DESC LIMIT 200`,
    [userId],
  );
}

export async function lastError(userId) {
  return (await one('SELECT last_error FROM gmail_connections WHERE user_id = $1', [userId]))?.last_error || null;
}
