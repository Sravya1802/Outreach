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

const APP = 'Scout’n’Jobs';

// Each template: a bold header (one variable at most), a body, a small
// footer and a button that opens the site. Body numbering restarts at {{1}}.
export const WHATSAPP_TEMPLATES = {
  list: {
    name: 'snj_daily_list',
    header: { text: 'Tonight’s list · {{1}}', example: 'Thu, Oct 15' },
    body: {
      text: 'Hello,\n{{1}} roles scored 9+ today:\n{{2}}\n\nReply YES to approve all, or YES 1 3 for a couple of them.\nOpen Scout’n’Jobs to read each JD.\n\nGood luck! ;)',
      example: ['3', '1) Ramp · SWE Intern · 9.4  2) Stripe · Data Intern · 9.1  3) Figma · SWE Intern · 9.0'],
    },
    footer: APP,
    button: { text: 'Review and approve', path: '/applications/auto-apply' },
  },
  reply: {
    name: 'snj_reply_alert',
    header: { text: 'New reply · {{1}}', example: 'Ana Lee' },
    body: {
      text: 'Hello,\n{{1}} from {{2}} wrote:\n“{{3}}”\n\nOpen Gmail to answer them.\n\nGood luck! ;)',
      example: ['Ana Lee', 'Ramp', 'Happy to chat on Thursday'],
    },
    footer: APP,
    button: { text: 'See all replies', path: '/people/outbox' },
  },
  needs: {
    name: 'snj_needs_you',
    header: { text: 'Needs you · {{1}}', example: '2 roles' },
    body: {
      text: 'Hello,\nThese approved roles are waiting on you:\n{{1}}\n\nOpen Scout’n’Jobs to take care of them.\n\nGood luck! ;)',
      example: ['Ramp: resume scored 84%  ·  Stripe: enter your referral code'],
    },
    footer: APP,
    button: { text: 'Open my roles', path: '/applications/auto-apply' },
  },
  summary: {
    name: 'snj_morning_summary',
    header: { text: 'Today’s summary', example: null },
    body: {
      text: 'Hello,\n{{1}} applied · {{2}} need you · {{3}} LinkedIn notes to send.\n\nOpen Scout’n’Jobs for the details.\n\nGood luck! ;)',
      example: ['2', '1', '3'],
    },
    footer: APP,
    button: { text: 'See the details', path: '/applications/auto-apply' },
  },
  projects: {
    name: 'snj_project_ideas',
    header: { text: 'Projects to build · {{1}}', example: '3 new' },
    body: {
      text: 'Hello,\nYour listed roles keep asking for skills your resume doesn’t show yet. These projects would cover them:\n{{1}}\n\nOpen Scout’n’Jobs for each build plan.\n\nGood luck! ;)',
      example: ['1) TrialMatch API · C#, .NET, CI/CD · 19 of 30 roles  2) PacketSentry · C, cybersecurity · 19 of 30 roles'],
    },
    footer: APP,
    button: { text: 'See the projects', path: '/profile/projects' },
  },
  skills: {
    name: 'snj_missing_skills',
    header: { text: 'Skills to check · {{1}}', example: 'Stripe' },
    body: {
      text: 'Hello,\nThe {{1}} job asks for skills your resume doesn’t show:\n{{2}}\n\nIf you know any of them, reply ADD with their numbers (like ADD 1 3), or ADD ALL. They go on this resume and the next ones.\n\nGood luck! ;)',
      example: ['Stripe · Software Engineer, New Grad', '1) Kafka  2) Go  3) Kubernetes'],
    },
    footer: APP,
    button: { text: 'Open my roles', path: '/applications/auto-apply' },
  },
};

/** The "which of these do you know?" question after a resume is tailored. */
export function skillsMessage({ company, title, terms }) {
  const numbered = terms.map((t, i) => `${i + 1}) ${t}`);
  return {
    params: { header: company, body: [`${company} · ${title}`, numbered.join('  ')] },
    text: `*Skills to check · ${company}*\n\nThe ${company} · ${title} job asks for skills your resume doesn’t show:\n\n${numbered.join('\n')}\n\nIf you know any of them, reply *ADD* with their numbers (like ADD 1 3), or *ADD ALL*. They go on this resume and the next ones. Only add what you could talk about in an interview.`,
  };
}

/**
 * New projects to build → { params, text } for notify(). Each project:
 * { name, covers, demand: { roles, of } | null }.
 */
export function projectsMessage(projects) {
  const line = (p, i) => {
    const adds = (p.covers || []).slice(0, 4).join(', ');
    const who = p.demand ? `${p.demand.roles} of ${p.demand.of} roles` : 'for one role';
    const roles = (p.demand?.examples || p.roles || []).slice(0, 4);
    return {
      short: `${i + 1}) ${String(p.name).split('|')[0].trim()} · ${adds} · ${who}${roles.length ? ` (e.g. ${roles.slice(0, 2).join('; ')})` : ''}`,
      long: `*${i + 1}) ${p.name}*\nAdds: ${adds || 'skills the role asks for'}\nHelps: ${who}${roles.length ? `\nFor example:\n${roles.map(r => `  • ${r}`).join('\n')}` : ''}`,
    };
  };
  const lines = projects.map(line);
  const n = projects.length;
  return {
    params: { header: `${n} new`, body: [lines.map(l => l.short).join('  ')] },
    text: `*Projects to build · ${n} new*\n\nYour listed roles keep asking for skills your resume doesn’t show yet. These would cover them:\n\n${lines.map(l => l.long).join('\n\n')}\n\nBuild plans: ${SITE}/profile/projects\nWhen one's built, push it and mark it built there so your resumes can use it.`,
  };
}

/** The components Meta's API expects when creating a template. */
export function templateDefinition(kind) {
  const t = WHATSAPP_TEMPLATES[kind];
  const components = [];
  components.push({ type: 'HEADER', format: 'TEXT', text: t.header.text, ...(t.header.example ? { example: { header_text: [t.header.example] } } : {}) });
  components.push({ type: 'BODY', text: t.body.text, example: { body_text: [t.body.example] } });
  if (t.footer) components.push({ type: 'FOOTER', text: t.footer });
  components.push({ type: 'BUTTONS', buttons: [{ type: 'URL', text: t.button.text, url: `${SITE}${t.button.path}` }] });
  return { name: process.env[`WHATSAPP_TEMPLATE_${kind.toUpperCase()}`] || t.name, language: cfg().lang, category: 'UTILITY', allow_category_change: true, components };
}

const PREF_FOR = { list: 'list', reply: 'replies', needs: 'needs', summary: 'summary', projects: 'projects', skills: 'skills' };

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
  m = /^add\s+(all|[\d\s,and&]+)$/i.exec(t);
  if (m) {
    if (/^all$/i.test(m[1].trim())) return { cmd: 'add', picks: 'all' };
    const nums = [...m[1].matchAll(/\d+/g)].map(x => Number(x[0])).filter(n => n > 0 && n < 100);
    if (nums.length) return { cmd: 'add', picks: [...new Set(nums)] };
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

export async function sendTemplate(userId, phone, kind, params, { quiet = false } = {}) {
  const t = WHATSAPP_TEMPLATES[kind];
  const name = process.env[`WHATSAPP_TEMPLATE_${kind.toUpperCase()}`] || t.name;
  const bodyParams = (params.body || []).map(p => cleanParam(p));
  const components = [];
  if (t.header.example) components.push({ type: 'header', parameters: [{ type: 'text', text: cleanParam(params.header, 60) }] });
  components.push({ type: 'body', parameters: bodyParams.map(text => ({ type: 'text', text })) });
  const logged = `[${name}] ${[params.header, ...bodyParams].filter(Boolean).join(' | ')}`;
  try {
    const waId = await graphPost({ to: phone, type: 'template', template: { name, language: { code: cfg().lang }, components } });
    await logOut(userId, { kind, body: logged, waId });
    return { ok: true, waId };
  } catch (err) {
    if (!quiet) await logOut(userId, { kind, body: logged, error: err.message });
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
    // Template not approved yet: keep the message and retry it (retryWaiting).
    if (templatePending(err)) {
      await run(
        "INSERT INTO whatsapp_messages (user_id, direction, kind, body, status, error, payload) VALUES ($1, 'out', $2, $3, 'waiting_template', $4, $5)",
        [userId, kind, String(text ?? '').slice(0, 4000), String(err.message).slice(0, 300), JSON.stringify({ params, text })],
      ).catch(() => {});
      return { ok: false, waiting: true, error: err.message };
    }
    return { ok: false, error: err.message };
  }
}

// Meta: 132001 = the template doesn't exist in this language, which is what an
// unapproved (pending) template returns.
const templatePending = (err) => Number(err?.code) === 132001 || /132001|does not exist in the translation/i.test(String(err?.message));
const WAITING_DAYS = 3;

/**
 * Every 30 minutes: send messages that were waiting on a template's approval.
 * Inside the user's 24-hour window they go as text; otherwise as the template
 * once Meta has approved it. After 3 days they're dropped.
 */
export async function retryWaiting() {
  if (!whatsappConfigured()) return { sent: 0 };
  await run(`UPDATE whatsapp_messages SET status = 'expired' WHERE status = 'waiting_template' AND created_at < NOW() - make_interval(days => $1)`, [WAITING_DAYS]);
  const rows = await all("SELECT id, user_id, kind, payload FROM whatsapp_messages WHERE status = 'waiting_template' ORDER BY created_at LIMIT 50");
  let sent = 0;
  for (const r of rows) {
    const link = await linkFor(r.user_id);
    if (!link?.verified_at || !link.phone || !link.enabled || link.prefs?.[PREF_FOR[r.kind]] === false) {
      await run("UPDATE whatsapp_messages SET status = 'expired' WHERE id = $1", [r.id]);
      continue;
    }
    try {
      if (inWindow(link)) await sendText(r.user_id, link.phone, r.payload?.text, r.kind);
      else await sendTemplate(r.user_id, link.phone, r.kind, r.payload?.params || {}, { quiet: true });
      await run("UPDATE whatsapp_messages SET status = 'sent_late' WHERE id = $1", [r.id]);
      sent += 1;
    } catch (err) {
      if (!templatePending(err)) await run("UPDATE whatsapp_messages SET status = 'failed', error = $2 WHERE id = $1", [r.id, String(err.message).slice(0, 300)]);
    }
  }
  return { sent, waiting: rows.length - sent };
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
    prefs: { list: true, replies: true, needs: true, summary: true, projects: true, skills: true, ...(l?.prefs || {}) },
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
    : sendTemplate(userId, link.phone, 'summary', { body: ['0', '0', '0'] });
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
  const text = [
    `*Tonight’s list · ${day}*`,
    'Hello,',
    `${items.length} role${items.length === 1 ? '' : 's'} scored 9+ today:`,
    '',
    ...items.map((i, n) => [
      `*${n + 1})*`,
      `Company: *${i.company_name}*`,
      `Role: ${i.title}`,
      `Score: ${Number(i.score).toFixed(1)}/10`,
      ...(i.location ? [`Where: ${i.location}`] : []),
      ...(i.reason ? [`Why: _${i.reason}_`] : []),
      '',
    ].join('\n')),
    '',
    'Reply *YES* to approve all, or *YES 1 3* for a couple of them.',
    `Open Scout’n’Jobs to read each JD: ${SITE}/applications/auto-apply`,
    '',
    'Good luck! ;)',
  ].join('\n');
  return { params: { header: day, body: [String(items.length), short] }, text };
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
  '*ADD 1 3* / *ADD ALL*  you know those skills; they go on your resume',
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

/**
 * Everything the WhatsApp assistant may answer from: what it sent lately,
 * tonight's list, projects to build, recent resumes and applications.
 */
async function assistantData(userId) {
  const [sent, plan, projects, resumes, applied] = await Promise.all([
    all("SELECT created_at::text AS at, kind, left(body, 900) AS body FROM whatsapp_messages WHERE user_id = $1 AND direction = 'out' AND status NOT IN ('failed', 'waiting_template') ORDER BY created_at DESC LIMIT 6", [userId]),
    numberedTop(userId),
    all("SELECT name, covers, demand, status FROM planned_projects WHERE user_id = $1 AND status IN ('suggested', 'built') ORDER BY created_at DESC LIMIT 6", [userId]),
    all(`SELECT e.company_name, e.job_title, t.status, t.ats_score, t.report->'callback'->>'after' AS callback, t.report->>'verdict' AS verdict
           FROM resume_tailorings t JOIN evaluations e ON e.id = t.evaluation_id
          WHERE t.user_id = $1 AND t.kind = 'resume' AND t.status IN ('ready', 'needs_review') ORDER BY t.id DESC LIMIT 8`, [userId]),
    all("SELECT company_name, title, stage, stage_note FROM plan_items WHERE user_id = $1 AND decision = 'approved' ORDER BY decided_at DESC NULLS LAST LIMIT 10", [userId]),
  ]);
  return {
    messages_you_sent_them_recently: sent.reverse(),
    tonights_list: plan.plan ? { date: plan.plan.plan_date, roles: plan.items.map((it, i) => ({ n: i + 1, company: it.company_name, title: it.title, score: it.score, decision: it.decision })) } : null,
    projects_to_build: projects.map(p => ({ name: p.name, status: p.status, adds: p.covers, roles_it_helps: p.demand ? `${p.demand.roles} of ${p.demand.of} listed roles` : 'one role', example_roles: p.demand?.examples || [], keyword_counts: p.demand?.keywords || [] })),
    tailored_resumes: resumes,
    approved_roles: applied,
    links: { list: `${SITE}/applications/auto-apply`, tracker: `${SITE}/applications/tracker`, projects: `${SITE}/profile/projects` },
  };
}

const ASSISTANT = `You are Scout’n’Jobs answering the user on WhatsApp about their own job search.
Answer only from DATA. If DATA doesn't have it, say so in one line and point to the right page link.
Keep it short: 1–8 lines, WhatsApp formatting (*bold*, • bullets). Name specific companies and roles when the question is about them.
You can't take actions from a question; for those, tell them the command (YES 1 3, SKIP 2, LIST, ADD 1 3, STOP, HELP) or the page.`;

/** A question or remark that isn't a command: a short answer from their own data (Groq). */
async function answer(userId, text) {
  const canned = chatReply(text);
  if (!canned.startsWith('Sorry')) return canned;
  try {
    const { complete } = await import('./llm.js');
    const r = await complete({ task: 'email', maxTokens: 700, userId, system: ASSISTANT, user: `DATA:\n${JSON.stringify(await assistantData(userId))}\n\nTHEIR MESSAGE: ${String(text).slice(0, 500)}` });
    const out = String(r.text || '').trim();
    return out ? `${out.slice(0, 1500)}\n\n_Reply HELP for commands._` : canned;
  } catch (err) {
    console.warn('[whatsapp] answer failed:', err.message);
    return canned;
  }
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
  if (!c) return reply(userId, phone, await answer(userId, text));
  if (c.cmd === 'help') return reply(userId, phone, HELP);
  if (c.cmd === 'stop') { await run('UPDATE whatsapp_links SET enabled = false WHERE user_id = $1', [userId]); return reply(userId, phone, 'Paused. Send START to turn WhatsApp messages back on.'); }
  if (c.cmd === 'start') { await run('UPDATE whatsapp_links SET enabled = true WHERE user_id = $1', [userId]); return reply(userId, phone, 'WhatsApp messages are on again.'); }
  if (c.cmd === 'add') return reply(userId, phone, await addSkillsReply(userId, c.picks));
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

/** ADD 1 3: the user knows those skills from the last question; add them to that resume. */
async function addSkillsReply(userId, picks) {
  const { lastSkillsAsk, approveSkills } = await import('./resumeEngine.js');
  const ask = await lastSkillsAsk(userId);
  if (!ask?.terms?.length) return 'There’s no skills question waiting. It comes after a resume is tailored.';
  const nums = picks === 'all' ? ask.terms.map((_, i) => i + 1) : picks;
  const bad = nums.filter(n => n > ask.terms.length);
  const terms = nums.filter(n => n <= ask.terms.length).map(n => ask.terms[n - 1]);
  if (!terms.length) return `There are only ${ask.terms.length} skills on that list. Reply ADD with their numbers, like ADD 1 3.`;
  try {
    const t = await approveSkills(userId, ask.tailoringId, terms);
    const score = t?.ats_score != null ? ` The resume now scores ${t.ats_score}% on the ATS check${t.status === 'ready' ? ' and is ready to send' : ''}.` : '';
    return `Added ${terms.join(', ')} to your ${ask.company} resume, and they’ll be used on your next ones.${score}${bad.length ? `\n\nThere’s no number ${bad.join(', ')} on that list.` : ''}`;
  } catch (err) {
    return `Couldn’t add them: ${err.message}`;
  }
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
