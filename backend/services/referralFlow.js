/**
 * referralFlow.js — what happens to an approved role after its resume is
 * ready (dailyPlan.advanceUser hands it over at stage `asking_referral`):
 *
 *   1. Ask for a referral. Who: people the user knows there (LinkedIn
 *      connections export), else contacts they already saved for the company.
 *      Email when we have an address (outbox, the recipient's next 8–11 AM
 *      weekday slot); otherwise a drafted LinkedIn note the user sends
 *      themselves. Nobody known → a LinkedIn search link + a note.
 *   2. Wait `referralWaitDays` business days. The user reports what happened:
 *      a link or code / "they submitted me" / "they said no". Email replies
 *      are flagged automatically (replyWatcher).
 *   3. Apply at a 6–10 AM slot in the company's time zone (autoApplier, for
 *      Greenhouse / Lever / Ashby; anything else becomes "apply yourself").
 *      Then an "I've applied" note goes in each email thread.
 *   4. A morning summary email, once a day, when anything happened.
 */

import { all, one, run } from '../db.js';
import { complete } from './llm.js';
import { connectionsAt, companyKey } from './linkedinConnections.js';
import { scheduleEmail, scheduleThreadNote } from './outbox.js';
import { businessDaysLater, nextSendSlot, partsIn } from './sendWindow.js';
import { sendToSelf } from './gmail.js';
import { notify as whatsappNotify } from './whatsapp.js';
import { detectPlatform } from './resumeRegistry.js';

const SITE = (process.env.FRONTEND_URL || process.env.FRONTEND_ORIGIN || 'https://scoutnjobs.vercel.app').replace(/\/+$/, '');
const MAX_ASKS_PER_ROLE = 2;
const AUTO_PLATFORMS = ['greenhouse', 'lever', 'ashby'];

const str = (v) => String(v ?? '').trim();
const first = (name) => str(name).split(/\s+/)[0] || 'there';

export function linkedinSearchUrl(company, school) {
  const q = [company, school].filter(Boolean).join(' ');
  return `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(q)}&origin=GLOBAL_SEARCH_HEADER`;
}

/** Plain template, used when the AI is unavailable and for the "search" case. */
export function templateAsk({ personName, me, school, title, company, jobUrl, why }) {
  const hi = `Hi ${first(personName)},`;
  const intro = `I'm ${me || 'a student'}${school ? ` at ${school}` : ''}, applying for the ${title} role at ${company}.`;
  const fit = why ? ` ${why}` : '';
  const note = `${hi} ${intro} Would you be open to referring me, or pointing me to the right person? Happy to send my resume. Thank you!`.slice(0, 300);
  const body = `${hi}\n\n${intro}${fit}\n\nWould you be open to referring me for it, or pointing me to the right person? I can send my resume and anything else that helps. The posting: ${jobUrl}\n\nThank you for considering it,\n${me || ''}`.trim();
  return { subject: `Referral for the ${title} role?`.slice(0, 120), body, note };
}

async function draftAsk(userId, ctx) {
  try {
    const r = await complete({
      task: 'email',
      json: true,
      maxTokens: 900,
      userId,
      system: `You write a short, polite referral request from a student to someone at a company.
Return JSON: {"subject": "...", "body": "...", "note": "..."}
- body: under 110 words. Greeting with their first name; who the student is (name, school) in one line; the role; one specific reason they fit (from FIT, never invented); the ask (refer me, or point me to the right person); the job link; thanks. No flattery, no "I hope this finds you well".
- note: a LinkedIn connection note under 280 characters with the same ask.
- subject: under 60 characters.
- ${ctx.knows ? 'They are a LinkedIn connection of the student, so a warmer tone is fine.' : 'They don\'t know the student; keep it brief and respectful.'}`,
      user: JSON.stringify({ to: ctx.personName, theirTitle: ctx.personTitle, student: ctx.me, school: ctx.school, role: ctx.title, company: ctx.company, jobLink: ctx.jobUrl, FIT: ctx.why }),
    });
    const d = JSON.parse(String(r.text).replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, ''));
    if (!str(d.body) || !str(d.note)) throw new Error('empty draft');
    return { subject: str(d.subject).slice(0, 120) || templateAsk(ctx).subject, body: str(d.body), note: str(d.note).slice(0, 300) };
  } catch {
    return templateAsk(ctx);
  }
}

export async function me(userId) {
  const p = await one('SELECT first_name, last_name, education_school FROM user_profile WHERE user_id = $1', [userId]);
  const m = await one("SELECT parsed FROM resume_files WHERE user_id = $1 AND kind = 'master' AND is_current", [userId]);
  return {
    name: [p?.first_name, p?.last_name].filter(Boolean).join(' ') || str(m?.parsed?.name),
    school: str(p?.education_school) || str(m?.parsed?.education?.[0]?.school),
  };
}

/** The user's company row (jobs), created if needed, so contacts and outreach have a home. */
export async function companyRow(userId, name, location) {
  const found = await one('SELECT id FROM jobs WHERE user_id = $1 AND lower(name) = lower($2) LIMIT 1', [userId, name]);
  if (found) return found.id;
  return (await run('INSERT INTO jobs (user_id, name, location, category) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING RETURNING id', [userId, name, location, 'daily_plan'])).rows[0]?.id
    || (await one('SELECT id FROM jobs WHERE user_id = $1 AND lower(name) = lower($2) LIMIT 1', [userId, name]))?.id;
}

export async function contactFor(userId, jobId, person) {
  const byUrl = person.profile_url && await one('SELECT * FROM job_contacts WHERE user_id = $1 AND job_id = $2 AND lower(linkedin_url) = lower($3)', [userId, jobId, person.profile_url]);
  if (byUrl) return byUrl;
  const byName = await one('SELECT * FROM job_contacts WHERE user_id = $1 AND job_id = $2 AND lower(name) = lower($3)', [userId, jobId, person.full_name]);
  if (byName) return byName;
  return (await run(
    `INSERT INTO job_contacts (user_id, job_id, name, title, linkedin_url, email, email_status, source)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'linkedin_connection') RETURNING *`,
    [userId, jobId, person.full_name, person.position, person.profile_url, person.email, person.email ? 'unverified' : 'unknown'],
  )).rows[0];
}

/** Step 1: ask. Moves the role to waiting_referral with its apply time set. */
export async function askForReferral(userId, item, settings) {
  // Never ask twice for one role: if asks exist, only (re)set the wait.
  const existing = await all('SELECT channel, person_name FROM referral_asks WHERE plan_item_id = $1', [item.id]);
  if (existing.length) {
    const tz0 = item.company_tz || settings.timezone;
    const at = item.apply_after ? new Date(item.apply_after) : businessDaysLater(new Date(), settings.referralWaitDays, tz0, { startHour: 6, endHour: 10 });
    await run("UPDATE plan_items SET stage = 'waiting_referral', referral_status = CASE WHEN referral_status = 'none' THEN 'asked' ELSE referral_status END, wait_until = $2, apply_after = $2, stage_note = $3 WHERE id = $1",
      [item.id, at, referralNote(existing, describeDay(at, tz0))]);
    return;
  }
  const who = await me(userId);
  const jobId = await companyRow(userId, item.company_name, item.location);
  const latest = await one("SELECT report FROM resume_tailorings WHERE id = $1", [item.tailoring_id]);
  const why = str(item.reason) || str(latest?.report?.notes).slice(0, 200);

  // People: connections first, then contacts already saved for this company.
  const people = [];
  for (const c of (await connectionsAt(userId, item.company_name)).slice(0, MAX_ASKS_PER_ROLE)) {
    const contact = await contactFor(userId, jobId, c);
    people.push({ name: c.full_name, title: c.position, linkedin: c.profile_url, email: contact.email || c.email, contactId: contact.id, connectionId: c.id, knows: true });
  }
  if (people.length < MAX_ASKS_PER_ROLE) {
    const saved = await all(
      `SELECT c.* FROM job_contacts c JOIN jobs j ON j.id = c.job_id
        WHERE c.user_id = $1 AND (lower(j.name) = lower($2)) AND COALESCE(c.status, 'pending') NOT IN ('replied', 'closed')
        ORDER BY (c.email IS NOT NULL AND COALESCE(c.email_status, '') <> 'invalid') DESC, c.seniority_score DESC NULLS LAST LIMIT 6`,
      [userId, item.company_name],
    );
    for (const c of saved) {
      if (people.length >= MAX_ASKS_PER_ROLE) break;
      if (people.some(p => p.contactId === Number(c.id) || p.contactId === c.id)) continue;
      people.push({ name: c.name, title: c.title, linkedin: c.linkedin_url, email: c.email_status === 'invalid' ? null : c.email, contactId: c.id, connectionId: null, knows: false });
    }
  }

  const base = { me: who.name, school: who.school, title: item.title, company: item.company_name, jobUrl: item.apply_url, why };
  if (!people.length) {
    const t = templateAsk({ ...base, personName: '' });
    await run(
      "INSERT INTO referral_asks (user_id, plan_item_id, channel, linkedin_url, message, status) VALUES ($1, $2, 'search', $3, $4, 'to_send')",
      [userId, item.id, linkedinSearchUrl(item.company_name, who.school), t.note.replace(/^Hi there, /, 'Hi, ')],
    );
  }
  for (const p of people) {
    const d = await draftAsk(userId, { ...base, personName: p.name, personTitle: p.title, knows: p.knows });
    let outboxId = null;
    let status = 'to_send';
    let channel = 'linkedin';
    if (p.email) {
      try {
        const o = await scheduleEmail(userId, { contactId: p.contactId, subject: d.subject, body: d.body, when: 'best', purpose: 'referral' });
        outboxId = o.id;
        status = 'scheduled';
        channel = 'email';
      } catch { /* already emailed, no Gmail, etc.: fall back to a LinkedIn note */ }
    }
    await run(
      `INSERT INTO referral_asks (user_id, plan_item_id, channel, person_name, person_title, linkedin_url, email, contact_id, connection_id, outbox_id, subject, message, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [userId, item.id, channel, p.name, p.title, p.linkedin || linkedinSearchUrl(`${p.name} ${item.company_name}`), p.email, p.contactId, p.connectionId, outboxId,
        channel === 'email' ? d.subject : null, channel === 'email' ? d.body : d.note, status],
    );
  }

  const tz = item.company_tz || settings.timezone;
  const applyAt = businessDaysLater(new Date(), settings.referralWaitDays, tz, { startHour: 6, endHour: 10 });
  const asked = await all('SELECT channel, person_name FROM referral_asks WHERE plan_item_id = $1', [item.id]);
  const note = referralNote(asked, describeDay(applyAt, tz));
  await run(
    "UPDATE plan_items SET stage = 'waiting_referral', referral_status = 'asked', wait_until = $2, apply_after = $2, stage_note = $3 WHERE id = $1",
    [item.id, applyAt, note],
  );
}

const names = (xs) => xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;

/** The status line under a waiting role. */
export function referralNote(asks, when) {
  const emailed = asks.filter(a => a.channel === 'email').map(a => a.person_name);
  const notes = asks.filter(a => a.channel === 'linkedin').map(a => a.person_name);
  if (!emailed.length && !notes.length) return `Nobody you know there yet. Use the LinkedIn search below to find someone, send the note, and tell us what happens. Applying ${when} otherwise.`;
  const parts = [];
  if (emailed.length) parts.push(`Emailing ${names(emailed)} at their next morning`);
  if (notes.length) parts.push(`${emailed.length ? 'n' : 'N'}otes for ${names(notes)} are ready for you to send on LinkedIn`);
  return `${parts.join('; ')}. Applying ${when} unless a referral comes first.`;
}

function describeDay(date, tz) {
  return new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(date) + ` ${tz.split('/').pop().replace(/_/g, ' ')} time`;
}

/** The user's buttons on a waiting role. */
export async function referralAction(userId, itemId, { action, link }) {
  const item = await one('SELECT * FROM plan_items WHERE id = $1 AND user_id = $2', [itemId, userId]);
  if (!item) throw Object.assign(new Error('Not found'), { status: 404 });
  if (!['asking_referral', 'waiting_referral', 'ready_to_apply', 'needs_you'].includes(item.stage)) {
    throw Object.assign(new Error('This role has already moved past the referral step.'), { status: 409 });
  }
  const tz = item.company_tz || 'America/New_York';
  const nextMorning = nextSendSlot(tz, { startHour: 6, endHour: 10 });
  if (action === 'submitted') {
    await run("UPDATE plan_items SET referral_status = 'submitted', stage = 'referred', stage_note = 'They submitted you, so we won’t apply again.' WHERE id = $1", [item.id]);
    if (item.evaluation_id) await run("UPDATE evaluations SET apply_status = 'submitted', applied_at = NOW()::text, apply_error = 'Referred: the referrer submitted the application' WHERE id = $1 AND user_id = $2", [item.evaluation_id, userId]);
    await run("UPDATE email_outbox SET status = 'cancelled', cancel_reason = 'Referred' WHERE status = 'scheduled' AND id IN (SELECT outbox_id FROM referral_asks WHERE plan_item_id = $1)", [item.id]);
  } else if (action === 'link') {
    const v = str(link);
    if (!v) throw Object.assign(new Error('Paste the referral link or code.'), { status: 400 });
    const isUrl = /^https?:\/\//i.test(v);
    if (isUrl && AUTO_PLATFORMS.includes(detectPlatform(v))) {
      await run("UPDATE plan_items SET referral_status = 'link', referral_link = $2, stage = 'ready_to_apply', apply_after = $3, stage_note = $4 WHERE id = $1",
        [item.id, v, nextMorning, `Applying through your referral link ${describeDay(nextMorning, tz)}.`]);
    } else {
      await run("UPDATE plan_items SET referral_status = 'link', referral_link = $2, stage = 'needs_you', needs_reason = 'referral', stage_note = $3 WHERE id = $1",
        [item.id, v, isUrl ? 'Apply through your referral link yourself (that site can’t be filled in automatically). Your tailored resume is ready to download.' : `Apply yourself and enter your referral code: ${v}. Your tailored resume is ready to download.`]);
    }
  } else if (action === 'declined') {
    await run("UPDATE plan_items SET referral_status = 'declined', stage = 'ready_to_apply', needs_reason = NULL, apply_after = $2, stage_note = $3 WHERE id = $1",
      [item.id, nextMorning, `No referral. Applying ${describeDay(nextMorning, tz)}.`]);
  } else if (action === 'apply_now') {
    await run("UPDATE plan_items SET stage = 'ready_to_apply', needs_reason = NULL, apply_after = NOW(), stage_note = 'Applying now.' WHERE id = $1", [item.id]);
  } else if (action === 'applied_myself') {
    await run("UPDATE plan_items SET stage = 'applied', needs_reason = NULL, applied_at = NOW(), stage_note = 'You applied yourself.' WHERE id = $1", [item.id]);
    if (item.evaluation_id) await run("UPDATE evaluations SET apply_status = 'submitted', applied_at = NOW()::text WHERE id = $1 AND user_id = $2", [item.evaluation_id, userId]);
  } else {
    throw Object.assign(new Error('Unknown action'), { status: 400 });
  }
  return one('SELECT * FROM plan_items WHERE id = $1', [item.id]);
}

export async function markAskSent(userId, askId) {
  const r = await run("UPDATE referral_asks SET status = 'marked_sent' WHERE id = $1 AND user_id = $2 AND status = 'to_send' RETURNING *", [askId, userId]);
  if (r.rows[0]?.contact_id) await run("UPDATE job_contacts SET status = CASE WHEN status IN ('replied','closed') THEN status ELSE 'dm_sent' END WHERE id = $1", [r.rows[0].contact_id]);
  return r.rows[0] || null;
}

export async function asksFor(userId, itemIds) {
  if (!itemIds.length) return [];
  return all(
    `SELECT a.id, a.plan_item_id, a.channel, a.person_name, a.person_title, a.linkedin_url, a.email, a.subject, a.message, a.status,
            o.status AS email_status, o.send_after, o.sent_at, o.recipient_tz, c.status AS contact_status
       FROM referral_asks a LEFT JOIN email_outbox o ON o.id = a.outbox_id LEFT JOIN job_contacts c ON c.id = a.contact_id
      WHERE a.user_id = $1 AND a.plan_item_id = ANY($2) ORDER BY a.id`,
    [userId, itemIds],
  );
}

// ── Applying ────────────────────────────────────────────────────────────────

async function applyItem(userId, item) {
  const url = item.referral_link && /^https?:\/\//i.test(item.referral_link) ? item.referral_link : item.apply_url;
  if (!AUTO_PLATFORMS.includes(detectPlatform(url))) {
    await run("UPDATE plan_items SET stage = 'needs_you', needs_reason = 'apply', stage_note = $2 WHERE id = $1",
      [item.id, 'This job site can’t be filled in automatically. Apply yourself with the tailored resume (download it from the role), then press “I applied”.']);
    return;
  }
  await run("UPDATE plan_items SET stage = 'applying', stage_note = 'Filling in the application…' WHERE id = $1", [item.id]);
  if (url !== item.apply_url) await run('UPDATE evaluations SET job_url = $1 WHERE id = $2 AND user_id = $3', [url, item.evaluation_id, userId]);
  await run("UPDATE evaluations SET apply_mode = 'auto', apply_status = 'queued' WHERE id = $1 AND user_id = $2 AND apply_status IS DISTINCT FROM 'submitted'", [item.evaluation_id, userId]);
  const { processOneEvaluation } = await import('./autoApplier.js');
  const r = await processOneEvaluation(userId, item.evaluation_id, { headless: true }).catch(err => ({ ok: false, error: err.message }));
  if (r.ok) {
    await run("UPDATE plan_items SET stage = 'applied', applied_at = NOW(), stage_note = $2 WHERE id = $1", [item.id, `Applied on ${r.platform || 'the company site'} with your tailored resume.`]);
    await sendAppliedNotes(userId, item);
  } else if (r.alreadySubmitted) {
    await run("UPDATE plan_items SET stage = 'applied', applied_at = NOW(), stage_note = 'Already applied.' WHERE id = $1", [item.id]);
  } else if (r.capReached || r.paused) {
    // Try again at the next morning slot.
    const tz = item.company_tz || 'America/New_York';
    await run("UPDATE plan_items SET stage = 'ready_to_apply', apply_after = $2, stage_note = $3 WHERE id = $1",
      [item.id, nextSendSlot(tz, { now: new Date(Date.now() + 12 * 3600_000), startHour: 6, endHour: 10 }), r.paused ? 'Auto-apply is paused in your profile. It will try again tomorrow morning.' : `${r.error}. Trying again tomorrow morning.`]);
  } else {
    await run("UPDATE plan_items SET stage = 'needs_you', needs_reason = 'apply', stage_note = $2 WHERE id = $1",
      [item.id, `Couldn’t finish the application: ${r.error || 'unknown problem'}. Apply yourself with the tailored resume, then press “I applied”.`]);
  }
}

async function sendAppliedNotes(userId, item) {
  const who = await me(userId);
  const asks = await all("SELECT * FROM referral_asks WHERE plan_item_id = $1 AND channel = 'email' AND outbox_id IS NOT NULL", [item.id]);
  for (const a of asks) {
    const body = `Hi ${first(a.person_name)},\n\nA quick update: I went ahead and applied for the ${item.title} role. If you're still open to referring me, the application is in under my name, ${who.name || 'as above'}. Thank you either way!\n\n${who.name || ''}`.trim();
    await scheduleThreadNote(userId, a.outbox_id, { body }).catch(() => {});
  }
}

// ── The tick ────────────────────────────────────────────────────────────────

/** Move this user's roles through ask → wait → apply. At most one application per call. */
export async function advanceReferrals(userId, settings) {
  for (const item of await all("SELECT * FROM plan_items WHERE user_id = $1 AND decision = 'approved' AND stage = 'asking_referral' ORDER BY decided_at LIMIT 5", [userId])) {
    try { await askForReferral(userId, item, settings); } catch (err) {
      await run("UPDATE plan_items SET stage = 'needs_you', needs_reason = 'referral', stage_note = $2 WHERE id = $1", [item.id, `Couldn’t prepare the referral ask: ${String(err.message).slice(0, 200)}`]);
    }
  }
  // Someone answered: say so (the user decides what it means).
  const waiting = await all("SELECT * FROM plan_items WHERE user_id = $1 AND decision = 'approved' AND stage = 'waiting_referral'", [userId]);
  for (const item of waiting) {
    const replied = await all(
      `SELECT a.id, a.person_name FROM referral_asks a JOIN job_contacts c ON c.id = a.contact_id
        WHERE a.plan_item_id = $1 AND a.status <> 'replied' AND c.status = 'replied'`,
      [item.id],
    );
    for (const r of replied) {
      await run("UPDATE referral_asks SET status = 'replied' WHERE id = $1", [r.id]);
      await run('UPDATE plan_items SET stage_note = $2 WHERE id = $1', [item.id, `${r.person_name} replied. Read it in Gmail, then tell us: referral link, they submitted you, or no.`]);
    }
    if (item.apply_after && new Date(item.apply_after) <= new Date()) {
      await run("UPDATE plan_items SET stage = 'ready_to_apply', stage_note = 'No referral came through in time. Applying now, in the company’s morning.' WHERE id = $1", [item.id]);
    }
  }
  const due = await one("SELECT * FROM plan_items WHERE user_id = $1 AND decision = 'approved' AND stage = 'ready_to_apply' AND apply_after <= NOW() ORDER BY apply_after LIMIT 1", [userId]);
  if (due) await applyItem(userId, due);
}

/** One summary a day at 11 AM (user's zone) when anything happened since the last one. */
export async function maybeSendSummary(userId, settings, now = new Date()) {
  const local = partsIn(now, settings.timezone);
  if (local.hour < 11) return { skipped: 'too_early' };
  const date = `${local.year}-${String(local.month).padStart(2, '0')}-${String(local.day).padStart(2, '0')}`;
  const key = 'daily_plan_summary_date';
  if ((await one('SELECT value FROM meta WHERE user_id = $1 AND key = $2', [userId, key]))?.value === date) return { skipped: 'sent' };
  const since = (await one("SELECT value FROM meta WHERE user_id = $1 AND key = 'daily_plan_summary_at'", [userId]))?.value || new Date(Date.now() - 86400_000).toISOString();
  const applied = await all("SELECT company_name, title FROM plan_items WHERE user_id = $1 AND applied_at > $2", [userId, since]);
  const needsYou = await all("SELECT company_name, title, stage_note FROM plan_items WHERE user_id = $1 AND decision = 'approved' AND stage = 'needs_you'", [userId]);
  const waiting = await all("SELECT company_name, title, apply_after FROM plan_items WHERE user_id = $1 AND decision = 'approved' AND stage = 'waiting_referral'", [userId]);
  const toSend = await all("SELECT a.person_name, pi.company_name FROM referral_asks a JOIN plan_items pi ON pi.id = a.plan_item_id WHERE a.user_id = $1 AND a.status = 'to_send' AND pi.stage = 'waiting_referral'", [userId]);
  const mark = async () => {
    await run("INSERT INTO meta (user_id, key, value) VALUES ($1, $2, $3) ON CONFLICT (user_id, key) DO UPDATE SET value = EXCLUDED.value", [userId, key, date]);
    await run("INSERT INTO meta (user_id, key, value) VALUES ($1, 'daily_plan_summary_at', $2) ON CONFLICT (user_id, key) DO UPDATE SET value = EXCLUDED.value", [userId, now.toISOString()]);
  };
  if (!applied.length && !needsYou.length && !toSend.length) { await mark(); return { skipped: 'nothing' }; }
  const lines = [];
  if (applied.length) lines.push(`Applied (${applied.length}):\n${applied.map(a => `  • ${a.company_name} · ${a.title}`).join('\n')}`);
  if (needsYou.length) lines.push(`Needs you (${needsYou.length}):\n${needsYou.map(a => `  • ${a.company_name} · ${a.title}: ${a.stage_note || ''}`).join('\n')}`);
  if (toSend.length) lines.push(`LinkedIn notes to send (${toSend.length}):\n${toSend.map(a => `  • ${a.person_name || 'Find someone'} at ${a.company_name}`).join('\n')}`);
  if (waiting.length) lines.push(`Waiting on a referral: ${waiting.length}`);
  const r = await sendToSelf(userId, {
    subject: `[Scout’n’Jobs] Today: ${applied.length} applied${needsYou.length ? ` · ${needsYou.length} need you` : ''}`,
    text: `${lines.join('\n\n')}\n\nOpen your plan: ${SITE}/applications/auto-apply`,
  }).catch(() => ({ skipped: true }));
  await whatsappNotify(userId, 'summary', {
    params: [String(applied.length), String(needsYou.length), String(toSend.length), `${SITE}/applications/auto-apply`],
    text: `Today in Scout’n’Jobs\n\n${lines.join('\n\n')}\n\n${SITE}/applications/auto-apply`,
  }).catch(() => {});
  if (r.ok || r.skipped) await mark();
  return r;
}

export { companyKey };

/** Numbers for the Dashboard's Referrals panel. */
export async function referralStats(userId) {
  const roles = await one(
    `SELECT COUNT(*) FILTER (WHERE referral_status <> 'none')::int AS asked,
            COUNT(*) FILTER (WHERE referral_status IN ('link','submitted'))::int AS got,
            COUNT(*) FILTER (WHERE referral_status = 'submitted')::int AS submitted,
            COUNT(*) FILTER (WHERE referral_status = 'link')::int AS link,
            COUNT(*) FILTER (WHERE referral_status = 'declined')::int AS declined,
            COUNT(*) FILTER (WHERE stage = 'waiting_referral')::int AS waiting,
            COUNT(*) FILTER (WHERE referral_status = 'asked' AND stage IN ('applied','ready_to_apply','applying'))::int AS without
       FROM plan_items WHERE user_id = $1 AND decision = 'approved'`,
    [userId],
  );
  const asks = await one(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE a.channel = 'email' AND o.status = 'sent')::int AS emails_sent,
            COUNT(*) FILTER (WHERE a.channel = 'email' AND o.status IN ('scheduled','sending'))::int AS emails_scheduled,
            COUNT(*) FILTER (WHERE a.channel <> 'email' AND a.status = 'marked_sent')::int AS notes_sent,
            COUNT(*) FILTER (WHERE a.status = 'to_send')::int AS to_send,
            COUNT(*) FILTER (WHERE a.status = 'replied' OR c.status = 'replied')::int AS replied
       FROM referral_asks a LEFT JOIN email_outbox o ON o.id = a.outbox_id LEFT JOIN job_contacts c ON c.id = a.contact_id
      WHERE a.user_id = $1`,
    [userId],
  );
  const known = await one('SELECT COUNT(*)::int AS n, COUNT(DISTINCT company_key)::int AS companies FROM linkedin_connections WHERE user_id = $1', [userId]);
  return { roles, asks, connections: { total: known?.n || 0, companies: known?.companies || 0 } };
}
