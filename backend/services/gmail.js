/**
 * gmail.js — each user's own Gmail, connected with a Google app password.
 * SMTP sends as them; IMAP (replyWatcher.js) reads replies. The password is
 * checked against both before it's saved, and stored sealed (secretBox).
 */

import crypto from 'crypto';
import nodemailer from 'nodemailer';
import { ImapFlow } from 'imapflow';
import { one, run } from '../db.js';
import { seal, open } from './secretBox.js';

const SMTP = { host: 'smtp.gmail.com', port: 465, secure: true };
const IMAP = { host: 'imap.gmail.com', port: 993, secure: true };

export const normalizeAppPassword = (p) => String(p ?? '').replace(/\s+/g, '');
export const isAppPassword = (p) => /^[a-z]{16}$/i.test(normalizeAppPassword(p));
export const isEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e ?? '').trim());

/** What to tell the user when Google says no. */
export function friendlyGmailError(err) {
  const m = `${err?.code || ''} ${err?.responseCode || ''} ${err?.message || ''} ${err?.response || ''}`;
  if (/EAUTH|535|AUTHENTICATIONFAILED|Invalid credentials|Username and Password not accepted|authentication failed/i.test(m)) {
    return 'Google didn’t accept that app password. Use a 16-letter app password made for this Google account, not your normal password.';
  }
  if (/Application-specific password required/i.test(m)) return 'This account needs an app password. Turn on 2-Step Verification, then create one.';
  if (/ETIMEDOUT|ECONNREFUSED|ENOTFOUND|ECONNRESET|EAI_AGAIN/i.test(m)) return 'Couldn’t reach Gmail. Try again in a minute.';
  if (/web login required|534/i.test(m)) return 'Google wants you to sign in once in a browser first. Open Gmail, then try again.';
  return `Gmail said: ${String(err?.message || err).slice(0, 160)}`;
}

function smtpTransport(email, pass) {
  return nodemailer.createTransport({ ...SMTP, auth: { user: email, pass }, connectionTimeout: 20_000, greetingTimeout: 15_000, socketTimeout: 60_000 });
}

export function imapClient(email, pass) {
  return new ImapFlow({ ...IMAP, auth: { user: email, pass }, logger: false, socketTimeout: 60_000 });
}

/** Throws a friendly error unless both sending and reading work. */
export async function verifyCredentials(email, pass) {
  try {
    await smtpTransport(email, pass).verify();
    const imap = imapClient(email, pass);
    await imap.connect();
    await imap.logout();
  } catch (err) {
    throw Object.assign(new Error(friendlyGmailError(err)), { status: 400 });
  }
}

export async function connectGmail(userId, { email, appPassword, displayName }) {
  const addr = String(email ?? '').trim().toLowerCase();
  const pass = normalizeAppPassword(appPassword);
  if (!isEmail(addr)) throw Object.assign(new Error('Enter your Gmail address.'), { status: 400 });
  if (!isAppPassword(pass)) throw Object.assign(new Error('An app password is 16 letters (Google shows it in 4 groups of 4).'), { status: 400 });
  await verifyCredentials(addr, pass);
  const name = String(displayName ?? '').trim().slice(0, 80) || null;
  await run(
    `INSERT INTO gmail_connections (user_id, email, app_password, display_name, status, last_error, connected_at, last_checked_at)
     VALUES ($1, $2, $3, $4, 'ok', NULL, NOW(), NOW())
     ON CONFLICT (user_id) DO UPDATE SET email = EXCLUDED.email, app_password = EXCLUDED.app_password,
       display_name = COALESCE(EXCLUDED.display_name, gmail_connections.display_name), status = 'ok', last_error = NULL,
       connected_at = NOW(), last_checked_at = NOW()`,
    [userId, addr, seal(pass), name],
  );
  transports.delete(userId);
  return gmailStatus(userId);
}

export async function gmailStatus(userId) {
  const r = await one('SELECT email, display_name, status, last_error, connected_at, last_checked_at, daily_cap FROM gmail_connections WHERE user_id = $1', [userId]);
  return r ? { connected: true, ...r } : { connected: false };
}

export async function disconnectGmail(userId) {
  transports.delete(userId);
  await run("UPDATE email_outbox SET status = 'cancelled', cancel_reason = 'Gmail disconnected' WHERE user_id = $1 AND status = 'scheduled'", [userId]);
  await run('DELETE FROM gmail_connections WHERE user_id = $1', [userId]);
}

/** The decrypted connection, or null. */
export async function connectionFor(userId) {
  const r = await one('SELECT * FROM gmail_connections WHERE user_id = $1', [userId]);
  if (!r) return null;
  return { ...r, pass: open(r.app_password) };
}

export async function markError(userId, err) {
  await run("UPDATE gmail_connections SET status = 'error', last_error = $2 WHERE user_id = $1", [userId, friendlyGmailError(err)]).catch(() => {});
}

const transports = new Map();

async function transportFor(userId) {
  const c = await connectionFor(userId);
  if (!c) throw Object.assign(new Error('Connect your Gmail in Settings first.'), { status: 400 });
  const cached = transports.get(userId);
  if (cached && cached.stamp === String(c.connected_at)) return { t: cached.t, c };
  const t = smtpTransport(c.email, c.pass);
  transports.set(userId, { t, stamp: String(c.connected_at) });
  return { t, c };
}

export function newMessageId(email) {
  const domain = String(email).split('@')[1] || 'gmail.com';
  return `<oos-${crypto.randomUUID()}@${domain}>`;
}

/** Send as the user. Returns the Message-ID used (for threading and reply matching). */
export async function sendAs(userId, { to, toName, subject, text, html, inReplyTo, references }) {
  const { t, c } = await transportFor(userId);
  const messageId = newMessageId(c.email);
  try {
    await t.sendMail({
      from: c.display_name ? { name: c.display_name, address: c.email } : c.email,
      to: toName ? { name: toName, address: to } : to,
      subject,
      text,
      html,
      messageId,
      ...(inReplyTo ? { inReplyTo, references: references || inReplyTo } : {}),
    });
  } catch (err) {
    if (/EAUTH|535/.test(`${err.code} ${err.responseCode}`)) await markError(userId, err);
    throw Object.assign(new Error(friendlyGmailError(err)), { status: 502 });
  }
  return messageId;
}

/** The user's own Gmail emails them (lists, summaries, reply alerts). */
export async function sendToSelf(userId, { subject, text, html }) {
  const c = await connectionFor(userId);
  if (!c) return { skipped: true, reason: 'gmail_not_connected' };
  const messageId = await sendAs(userId, { to: c.email, subject, text, html });
  return { ok: true, to: c.email, messageId };
}
