/**
 * whatsapp.js — Meta's WhatsApp Cloud API, from one Scout’n’Jobs business number.
 *
 * Linking: the user gets a code in Integrations → WhatsApp and sends
 * "JOIN <code>" to the business number. That proves the phone is theirs and
 * opts them in (Meta requires opt-in).
 *
 * Sending: inside Meta's 24-hour window (the user messaged us recently) we
 * send plain text with full detail; outside it, an approved template.
 * Templates (utility) the owner creates in WhatsApp Manager — exact text in
 * WHATSAPP_TEMPLATES below. Meta rejects a template that starts or ends
 * with a variable, so none does.
 *
 * Replies the user can send: YES (approve all of tonight's list), YES 1 3,
 * SKIP 2, LIST, STOP, START, HELP.
 *
 * Env: WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_BUSINESS_NUMBER
 * (shown to users, e.g. +15551234567), WHATSAPP_VERIFY_TOKEN (webhook
 * handshake), WHATSAPP_APP_SECRET (webhook signature), optional
 * WHATSAPP_API_VERSION (default v25.0), WHATSAPP_TEMPLATE_LANG (en_US).
 */

import crypto from 'crypto';
import { all, one, run } from '../db.js';

const SITE = (process.env.FRONTEND_URL || process.env.FRONTEND_ORIGIN || 'https://scoutnjobs.vercel.app').replace(/\/+$/, '');
const WINDOW_MS = 23 * 3600_000; // stay inside Meta's 24 hours

export const WHATSAPP_TEMPLATES = {
  list: {
    name: 'oos_daily_list',
    text: 'Your Scout’n’Jobs list for {{1}} has {{2}} roles to approve: {{3}}. Open {{4}} for details, or reply YES to approve all or YES 1 3 to approve some.',
    example: ['Thu, Oct 15', '3', '1) Ramp · SWE Intern · 9.4  2) Stripe · Data Intern · 9.1', `${SITE}/applications/auto-apply`],
  },
  reply: {
    name: 'oos_reply_alert',
    text: 'New reply on Scout’n’Jobs: {{1}} from {{2}} wrote "{{3}}". Open Gmail to answer them.',
    example: ['Ana Lee', 'Ramp', 'Happy to chat on Thursday'],
  },
  needs: {
    name: 'oos_needs_you',
    text: 'Scout’n’Jobs: {{1}} of your approved roles need you: {{2}}. Open {{3}} to take care of them.',
    example: ['2', 'Ramp: resume scored 84% · Stripe: enter your referral code', `${SITE}/applications/auto-apply`],
  },
  summary: {
    name: 'oos_morning_summary',
    text: 'Your Scout’n’Jobs summary for today: {{1}} applied, {{2}} need you, {{3}} LinkedIn notes to send. Open {{4}} for the details.',
    example: ['2', '1', '3', `${SITE}/applications/auto-apply`],
  },
};

const PREF_FOR = { list: 'list', reply: 'replies', needs: 'needs', summary: 'summary' };

const cfg = () => ({
  token: process.env.WHATSAPP_TOKEN,
  phoneId: process.env.WHATSAPP_PHONE_NUMBER_ID,
  number: process.env.WHATSAPP_BUSINESS_NUMBER || '',
  verifyToken: process.env.WHATSAPP_VERIFY_TOKEN,
  appSecret: process.env.WHATSAPP_APP_SECRET,
  version: process.env.WHATSAPP_API_VERSION || 'v25.0',
  lang: process.env.WHATSAPP_TEMPLATE_LANG || 'en_US',
});

export const whatsappConfigured = () => Boolean(cfg().token && cfg().phoneId);

/** "+1 (555) 010-2000" → "15550102000"; null if it can't be a phone number. */
export function normalizePhone(s) {
  let d = String(s ?? '').replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  return d.length >= 8 && d.length <= 15 ? d : null;
}

/** Template parameters can't hold newlines, tabs or 4+ spaces in a row. */
export function cleanParam(s, max = 700) {
  const t = String(s ?? '').replace(/[\r\n\t]+/g, ' · ').replace(/ {4,}/g, '   ').trim();
  return (t.length > max ? `${t.slice(0, max - 1)}…` : t) || '-';
}

/** Parse what the user typed. */
export function parseCommand(text) {
  const t = String(text ?? '').trim();
  let m = /^join\s+(\d{6})\b/i.exec(t);
  if (m) return { cmd: 'join', code: m[1] };
  m = /^(yes|y|approve|skip|no)\b(.*)$/i.exec(t);
  if (m) {
    const nums = [...m[2].matchAll(/\d+/g)].map(x => Number(x[0])).filter(n => n > 0 && n < 100);
    const cmd = /^(skip|no)$/i.test(m[1]) ? 'skip' : 'yes';
    return { cmd, picks: nums.length ? [...new Set(nums)] : 'all' };
  }
  if (/^(list|today|tonight)\b/i.test(t)) return { cmd: 'list' };
  if (/^(stop|unsubscribe|pause)\b/i.test(t)) return { cmd: 'stop' };
  if (/^(start|resume)\b/i.test(t)) return { cmd: 'start' };
  if (/^(help|\?)$/i.test(t)) return { cmd: 'help' };
  return null;
}

async function graphPost(body) {
  const c = cfg();
  const res = await fetch(`https://graph.facebook.com/${c.version}/${c.phoneId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${c.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', ...body }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = data?.error;
    throw Object.assign(new Error(e?.error_user_msg || e?.message || `WhatsApp API ${res.status}`), { status: 502, code: e?.code });
  }
  return data?.messages?.[0]?.id || null;
}

async function logOut(userId, { kind, body, waId, error }) {
  await run(
    "INSERT INTO whatsapp_messages (user_id, direction, wa_message_id, kind, body, status, error) VALUES ($1, 'out', $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING",
    [userId, waId, kind, String(body ?? '').slice(0, 4000), error ? 'failed' : 'sent', error ? String(error).slice(0, 300) : null],
  ).catch(() => {});
}

export async function sendText(userId, phone, text, kind = 'text') {
  try {
    const waId = await graphPost({ to: phone, type: 'text', text: { body: String(text).slice(0, 4000), preview_url: false } });
    await logOut(userId, { kind, body: text, waId });
    return { ok: true, waId };
  } catch (err) {
    await logOut(userId, { kind, body: text, error: err.message });
    throw err;
  }
}

export async function sendTemplate(userId, phone, kind, params) {
  const t = WHATSAPP_TEMPLATES[kind];
  const name = process.env[`WHATSAPP_TEMPLATE_${kind.toUpperCase()}`] || t.name;
  const clean = params.map(p => cleanParam(p));
  try {
    const waId = await graphPost({
      to: phone,
      type: 'template',
      template: { name, language: { code: cfg().lang }, components: [{ type: 'body', parameters: clean.map(text => ({ type: 'text', text })) }] },
    });
    await logOut(userId, { kind, body: `[${name}] ${clean.join(' | ')}`, waId });
    return { ok: true, waId };
  } catch (err) {
    await logOut(userId, { kind, body: `[${name}] ${clean.join(' | ')}`, error: err.message });
    throw err;
  }
}

export async function linkFor(userId) {
  return one('SELECT * FROM whatsapp_links WHERE user_id = $1', [userId]);
}

const inWindow = (link) => Boolean(link?.last_inbound_at && Date.now() - new Date(link.last_inbound_at).getTime() < WINDOW_MS);

/**
 * Send one notification if the user is linked, opted in and wants this kind:
 * full text inside the 24-hour window, the template otherwise.
 */
export async function notify(userId, kind, { params, text }) {
  if (!whatsappConfigured()) return { skipped: 'not_configured' };
  const link = await linkFor(userId);
  if (!link?.verified_at || !link.phone) return { skipped: 'not_linked' };
  if (!link.enabled) return { skipped: 'stopped' };
  if (link.prefs && link.prefs[PREF_FOR[kind]] === false) return { skipped: 'pref_off' };
  try {
    return inWindow(link) ? await sendText(userId, link.phone, text, kind) : await sendTemplate(userId, link.phone, kind, params);
  } catch (err) {
    console.warn(`[whatsapp] ${kind} to ${String(userId).slice(0, 8)} failed: ${err.message}`);
    return { ok: false, error: err.message };
  }
}

// ── Linking ─────────────────────────────────────────────────────────────────

export async function whatsappStatus(userId) {
  const l = await linkFor(userId);
  const c = cfg();
  return {
    configured: whatsappConfigured(),
    businessNumber: c.number || null,
    linked: Boolean(l?.verified_at),
    phone: l?.verified_at ? l.phone : null,
    enabled: l?.enabled ?? true,
    prefs: l?.prefs || { list: true, replies: true, needs: true, summary: true },
    verifiedAt: l?.verified_at || null,
    pending: l?.join_code && new Date(l.join_code_expires) > new Date() ? { code: l.join_code, expires: l.join_code_expires } : null,
  };
}

export function waLink(number, text) {
  const n = normalizePhone(number);
  return n ? `https://wa.me/${n}?text=${encodeURIComponent(text)}` : null;
}

/** A 6-digit code, good for 30 minutes, to send as "JOIN <code>". */
export async function startJoin(userId) {
  if (!whatsappConfigured()) throw Object.assign(new Error('WhatsApp isn’t set up on the server yet.'), { status: 503 });
  for (let i = 0; i < 5; i++) {
    const code = String(crypto.randomInt(100000, 1000000));
    try {
      await run(
        `INSERT INTO whatsapp_links (user_id, join_code, join_code_expires) VALUES ($1, $2, NOW() + INTERVAL '30 minutes')
         ON CONFLICT (user_id) DO UPDATE SET join_code = EXCLUDED.join_code, join_code_expires = EXCLUDED.join_code_expires`,
        [userId, code],
      );
      const c = cfg();
      return { code, number: c.number, link: waLink(c.number, `JOIN ${code}`) };
    } catch (err) {
      if (!/whatsapp_links_code/.test(err.message)) throw err;
    }
  }
  throw new Error('Couldn’t make a code. Try again.');
}

export async function savePrefs(userId, { prefs, enabled }) {
  const cur = await linkFor(userId);
  if (!cur) throw Object.assign(new Error('Link WhatsApp first.'), { status: 400 });
  const next = { ...(cur.prefs || {}), ...(prefs || {}) };
  for (const k of Object.keys(next)) next[k] = next[k] !== false;
  await run('UPDATE whatsapp_links SET prefs = $2, enabled = COALESCE($3, enabled) WHERE user_id = $1', [userId, JSON.stringify(next), typeof enabled === 'boolean' ? enabled : null]);
  return whatsappStatus(userId);
}

export async function unlink(userId) {
  await run('DELETE FROM whatsapp_links WHERE user_id = $1', [userId]);
}

export async function sendTest(userId) {
  const link = await linkFor(userId);
  if (!link?.verified_at) throw Object.assign(new Error('Link WhatsApp first.'), { status: 400 });
  const text = 'Scout’n’Jobs test: WhatsApp is working. You’ll get your 10 PM list, reply alerts, roles that need you, and the morning summary here. Reply HELP for commands.';
  return inWindow(link)
    ? sendText(userId, link.phone, text, 'test')
    : sendTemplate(userId, link.phone, 'summary', ['0', '0', '0', `${SITE}/applications/auto-apply`]);
}

// ── Messages ────────────────────────────────────────────────────────────────

/** Tonight's top roles in the same order the list message numbers them. */
async function numberedTop(userId) {
  const plan = await one("SELECT * FROM daily_plans WHERE user_id = $1 AND status = 'ready' ORDER BY plan_date DESC LIMIT 1", [userId]);
  if (!plan) return { plan: null, items: [] };
  const items = await all("SELECT * FROM plan_items WHERE plan_id = $1 AND tier = 'top' ORDER BY score DESC NULLS LAST, id", [plan.id]);
  return { plan, items };
}

export function listMessage(items, date) {
  const day = new Date(`${String(date).slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
  const short = items.map((i, n) => `${n + 1}) ${i.company_name} · ${i.title} · ${Number(i.score).toFixed(1)}`).join('  ');
  const link = `${SITE}/applications/auto-apply`;
  const text = [
    `Your Scout’n’Jobs list for ${day}: ${items.length} role${items.length === 1 ? '' : 's'} to approve.`,
    '',
    ...items.map((i, n) => `${n + 1}) ${i.company_name} · ${i.title} · ${Number(i.score).toFixed(1)}${i.location ? `\n   ${i.location}` : ''}${i.reason ? `\n   ${i.reason}` : ''}`),
    '',
    'Reply YES to approve all, YES 1 3 to approve some, SKIP 2 to skip one.',
    link,
  ].join('\n');
  return { params: [day, String(items.length), short, link], text };
}

export async function sendPlanList(userId) {
  const { plan, items } = await numberedTop(userId);
  if (!plan || !items.length) return { skipped: 'empty' };
  const m = listMessage(items.filter(i => i.decision === 'pending' || i.decision === 'approved'), plan.plan_date);
  return notify(userId, 'list', m);
}

// ── Inbound ─────────────────────────────────────────────────────────────────

// WhatsApp formatting: *bold*, _italic_.
export const HELP = [
  '*Reply with*',
  '*YES*  approve tonight’s whole list',
  '*YES 1 3*  approve only those numbers',
  '*SKIP 2*  skip one',
  '*LIST*  see tonight’s list again',
  '*STOP* / *START*  pause or resume these messages',
  '*HELP*  show this again',
].join('\n');

const hourText = (h) => `${h % 12 || 12} ${h < 12 ? 'AM' : 'PM'}`;

export function welcomeMessage(listHour = 22) {
  return [
    '✅ *You’re connected to Scout’n’Jobs*',
    '',
    'I’ll message you here when:',
    `• your evening list is ready (${hourText(listHour)})`,
    '• someone replies to your outreach',
    '• one of your roles needs you',
    '• your morning summary is in',
    '',
    HELP,
  ].join('\n');
}

/** Small talk gets a short, friendly answer instead of the whole command list. */
export function chatReply(text) {
  const t = String(text ?? '').trim().toLowerCase();
  if (/^(thanks|thank you|thx|ty|thank u|tysm|great|cool|nice|awesome|perfect|👍|🙏|❤️|ok|okay|k|got it|sounds good)[!. ]*$/u.test(t)) return 'You’re welcome! Reply *HELP* any time to see what I can do.';
  if (/^(hi|hello|hey|hii+|yo|good (morning|afternoon|evening))[!. ]*$/.test(t)) return 'Hi! 👋 Reply *LIST* to see tonight’s roles, or *HELP* for everything I understand.';
  return 'Sorry, I only understand a few words. Reply *HELP* to see them.';
}

async function reply(userId, phone, text) {
  if (!whatsappConfigured()) return null;
  return sendText(userId, phone, text, 'command').catch(err => console.warn('[whatsapp] reply failed:', err.message));
}

/** One inbound text from a phone number. */
export async function handleInbound(from, text) {
  const phone = normalizePhone(from);
  if (!phone) return;
  const c = parseCommand(text);
  if (c?.cmd === 'join') {
    const pending = await one("SELECT * FROM whatsapp_links WHERE join_code = $1 AND join_code_expires > NOW()", [c.code]);
    if (!pending) return reply(null, phone, 'That code has expired or isn’t right. Get a new one in Scout’n’Jobs → Integrations → WhatsApp.');
    await run('UPDATE whatsapp_links SET phone = NULL, verified_at = NULL WHERE phone = $1 AND user_id <> $2', [phone, pending.user_id]);
    await run('UPDATE whatsapp_links SET phone = $2, verified_at = NOW(), enabled = true, join_code = NULL, join_code_expires = NULL, last_inbound_at = NOW() WHERE user_id = $1', [pending.user_id, phone]);
    const { getSettings } = await import('./dailyPlan.js');
    const listHour = (await getSettings(pending.user_id).catch(() => null))?.listHour ?? 22;
    return reply(pending.user_id, phone, welcomeMessage(listHour));
  }
  const link = await one('SELECT * FROM whatsapp_links WHERE phone = $1 AND verified_at IS NOT NULL', [phone]);
  if (!link) return reply(null, phone, `This number isn’t linked to Scout’n’Jobs. Get a code in ${SITE}/integrations/whatsapp and send JOIN <code>.`);
  await run('UPDATE whatsapp_links SET last_inbound_at = NOW() WHERE user_id = $1', [link.user_id]);
  const userId = link.user_id;
  if (!c) return reply(userId, phone, chatReply(text));
  if (c.cmd === 'help') return reply(userId, phone, HELP);
  if (c.cmd === 'stop') { await run('UPDATE whatsapp_links SET enabled = false WHERE user_id = $1', [userId]); return reply(userId, phone, 'Paused. Send START to turn WhatsApp messages back on.'); }
  if (c.cmd === 'start') { await run('UPDATE whatsapp_links SET enabled = true WHERE user_id = $1', [userId]); return reply(userId, phone, 'WhatsApp messages are on again.'); }
  const { plan, items } = await numberedTop(userId);
  if (c.cmd === 'list') {
    if (!plan || !items.length) return reply(userId, phone, 'No list right now. It arrives in the evening.');
    return reply(userId, phone, listMessage(items, plan.plan_date).text);
  }
  if (!plan || !items.length) return reply(userId, phone, 'There’s no list to approve right now.');
  const picks = c.picks === 'all' ? items.map((_, n) => n + 1) : c.picks;
  const bad = picks.filter(n => n > items.length);
  const chosen = picks.filter(n => n <= items.length).map(n => items[n - 1]);
  const { decide } = await import('./dailyPlan.js');
  const done = [];
  for (const it of chosen) {
    try {
      if (it.decision === 'expired') continue;
      await decide(userId, it.id, c.cmd === 'yes' ? 'approved' : 'skipped');
      done.push(it);
    } catch { /* already past the resume step, etc. */ }
  }
  const verb = c.cmd === 'yes' ? 'Approved' : 'Skipped';
  const lines = done.map(i => `• ${i.company_name} · ${i.title}`);
  return reply(userId, phone, `${done.length ? `${verb}:\n${lines.join('\n')}` : 'Nothing changed.'}${bad.length ? `\n\nThere’s no number ${bad.join(', ')} on tonight’s list.` : ''}${c.cmd === 'yes' && done.length ? '\n\nTailored resumes are being written now.' : ''}`);
}

/** Webhook handshake (GET). Returns the challenge or null. */
export function verifyHandshake(q) {
  const t = cfg().verifyToken;
  return q['hub.mode'] === 'subscribe' && t && q['hub.verify_token'] === t ? String(q['hub.challenge'] ?? '') : null;
}

/**
 * X-Hub-Signature-256 check. With no app secret configured, nothing is
 * accepted: an unsigned webhook would let anyone post fake "JOIN" messages.
 */
export function signatureOk(rawBody, header) {
  const secret = cfg().appSecret;
  if (!secret) return false;
  if (!rawBody || !header || !/^sha256=/.test(header)) return false;
  const want = `sha256=${crypto.createHmac('sha256', secret).update(rawBody).digest('hex')}`;
  const a = Buffer.from(want);
  const b = Buffer.from(String(header));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Webhook POST body: inbound messages (deduped) and delivery statuses. */
export async function handleWebhook(body) {
  for (const entry of body?.entry || []) {
    for (const change of entry.changes || []) {
      const v = change.value || {};
      for (const s of v.statuses || []) {
        await run("UPDATE whatsapp_messages SET status = $2, error = COALESCE($3, error) WHERE wa_message_id = $1 AND direction = 'out'",
          [s.id, s.status, s.errors?.[0]?.title || null]).catch(() => {});
      }
      for (const m of v.messages || []) {
        const text = m.text?.body || m.button?.text || m.interactive?.button_reply?.title || '';
        const fresh = (await run(
          "INSERT INTO whatsapp_messages (direction, wa_message_id, kind, body, status) VALUES ('in', $1, 'text', $2, 'received') ON CONFLICT DO NOTHING RETURNING id",
          [m.id, text.slice(0, 4000)],
        )).rows[0];
        if (!fresh) continue; // Meta retries deliveries; act once
        const link = await one('SELECT user_id FROM whatsapp_links WHERE phone = $1', [normalizePhone(m.from)]);
        if (link) await run('UPDATE whatsapp_messages SET user_id = $2 WHERE id = $1', [fresh.id, link.user_id]);
        await handleInbound(m.from, text).catch(err => console.error('[whatsapp] inbound failed:', err.message));
      }
    }
  }
}
