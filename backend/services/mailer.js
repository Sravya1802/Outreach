// ── Email (Gmail SMTP via nodemailer) ────────────────────────────────────────
// Net-new email subsystem for the daily roles digest (#9). Configured entirely
// from env so it no-ops cleanly when credentials aren't set:
//   GMAIL_USER          – the Gmail address you send FROM
//   GMAIL_APP_PASSWORD  – a Google "App Password" (NOT your normal password;
//                         create one at https://myaccount.google.com/apppasswords)
//   NOTIFY_EMAIL        – where digests are sent (defaults to GMAIL_USER)
import nodemailer from 'nodemailer';

let _transporter = null;

export function mailerConfigured() {
  return !!(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD);
}

export function notifyRecipient() {
  return process.env.NOTIFY_EMAIL || process.env.GMAIL_USER || null;
}

function getTransporter() {
  if (_transporter) return _transporter;
  if (!mailerConfigured()) return null;
  _transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD },
  });
  return _transporter;
}

/**
 * Send an email. Returns { skipped:true } when not configured (so callers/crons
 * never crash on a missing setup), or { ok:true, messageId } on success.
 */
export async function sendMail({ to, subject, html, text }) {
  const t = getTransporter();
  if (!t) {
    console.warn('[mailer] not configured (GMAIL_USER / GMAIL_APP_PASSWORD missing) — skipping send');
    return { skipped: true, reason: 'not_configured' };
  }
  const recipient = to || notifyRecipient();
  if (!recipient) return { skipped: true, reason: 'no_recipient' };
  const info = await t.sendMail({
    from: `OutreachOS <${process.env.GMAIL_USER}>`,
    to: recipient,
    subject,
    text: text || undefined,
    html: html || undefined,
  });
  return { ok: true, messageId: info.messageId, to: recipient };
}
