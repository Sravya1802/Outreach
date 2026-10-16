/**
 * referralFlow.js — what happens to an approved role after its resume is
 * ready (dailyPlan.advanceUser hands it over at stage `asking_referral`):
 *
 *   0. As soon as a role is approved, people at the company are found
 *      (prepareContacts → findPeopleFor): work emails (contactFinder) and
 *      LinkedIn profiles beyond the user's own connections (Apollo, Apify,
 *      Google), within the monthly lookup allowance. They land in People.
 *   1. Ask for a referral. Who: people the user knows there (LinkedIn
 *      connections export) first, then recruiters, then engineers.
 *      Up to 2 get an email draft with the tailored resume attached, waiting
 *      for the user's OK (People → Outbox, also in Gmail Drafts); once
 *      approved it goes at the recipient's next 8–11 AM weekday slot.
 *      Up to 2 others get a drafted LinkedIn note the user sends themselves
 *      (copy + open profile). Nobody found → a LinkedIn search link + a note.
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
import { cancelScheduled, scheduleEmail, scheduleThreadNote } from './outbox.js';
import { businessDaysLater, nextSendSlot, partsIn } from './sendWindow.js';
import { connectionFor, sendToSelf } from './gmail.js';
import { notify as whatsappNotify } from './whatsapp.js';
import { detectPlatform } from './resumeRegistry.js';
import { isRecruiterTitle } from './contactRules.js';

const SITE = (process.env.FRONTEND_URL || process.env.FRONTEND_ORIGIN || 'https://scoutnjobs.vercel.app').replace(/\/+$/, '');
const MAX_EMAILS_PER_ROLE = 2;
const MAX_NOTES_PER_ROLE = 2;
const isProfile = (url) => /linkedin\.com\/in\//i.test(String(url || ''));
const AUTO_PLATFORMS = ['greenhouse', 'lever', 'ashby'];

const str = (v) => String(v ?? '').trim();
const first = (name) => str(name).split(/\s+/)[0] || 'there';

export function linkedinSearchUrl(company, school) {
  const q = [company, school].filter(Boolean).join(' ');
  return `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(q)}&origin=GLOBAL_SEARCH_HEADER`;
}

/** Plain template, used when the AI is unavailable and for the "search" case. */
export function templateAsk({ personName, me, school, title, company, jobUrl, why, attached = false }) {
  const hi = `Hi ${first(personName)},`;
  const intro = `I'm ${me || 'a student'}${school ? ` at ${school}` : ''}, applying for the ${title} role at ${company}.`;
  const fit = why ? ` ${why}` : '';
  const note = `${hi} ${intro} Would you be open to referring me, or pointing me to the right person? Happy to send my resume. Thank you!`.slice(0, 300);
  const resume = attached ? 'My resume is attached.' : 'I can send my resume and anything else that helps.';
  const body = `${hi}\n\n${intro}${fit}\n\nWould you be open to referring me for it, or pointing me to the right person? ${resume} The posting: ${jobUrl}\n\nThank you for considering it,\n${me || ''}`.trim();
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
- body: under 110 words of plain text in 3–4 short paragraphs separated by a blank line. Greeting with their first name; who the student is (name, school) in one line; the role; one specific reason they fit (from FIT, never invented); the ask (refer me, or point me to the right person); ${ctx.attached ? 'one line saying their resume is attached' : 'an offer to send their resume'}; the job link; thanks, then the student's full name on its own line. No flattery, no "I hope this finds you well".
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

async function hasEmailContact(userId, companyName) {
  return Boolean(await one(
    `SELECT 1 FROM job_contacts c JOIN jobs j ON j.id = c.job_id
      WHERE c.user_id = $1 AND lower(j.name) = lower($2) AND c.email IS NOT NULL AND COALESCE(c.email_status, '') <> 'invalid'
        AND COALESCE(c.status, 'pending') NOT IN ('replied', 'closed') LIMIT 1`,
    [userId, companyName],
  ));
}

/** Look up email addresses at the company (engineering and recruiting people) and save them as contacts. */
export async function findEmailsAt(userId, jobId, item) {
  const job = await one('SELECT * FROM jobs WHERE id = $1 AND user_id = $2', [jobId, userId]);
  if (!job) return 0;
  const { findCompanyEmails, upsertContact } = await import('./contactFinder.js');
  const { seniorityScore } = await import('./contactRules.js');
  const result = await findCompanyEmails({ ...job, url: job.url || item.apply_url }, { userId });
  if (!result.domain) return 0;
  await run('UPDATE jobs SET domain = $1, domain_source = $2 WHERE id = $3 AND user_id = $4',
    [result.domain, result.domainSource === 'mx' ? 'guess' : result.domainSource, jobId, userId]);
  let added = 0;
  for (const c of result.candidates) {
    if ((await upsertContact({ all, run }, { userId, jobId, contact: c, seniorityScore: seniorityScore(c.title) })) === 'inserted') added += 1;
  }
  return added;
}

/** A role's asks that are still out (a discarded email doesn't count). */
async function liveAsks(itemId) {
  return all(
    `SELECT a.channel, a.person_name, a.status FROM referral_asks a LEFT JOIN email_outbox o ON o.id = a.outbox_id
      WHERE a.plan_item_id = $1 AND (a.channel <> 'email' OR o.status IS DISTINCT FROM 'cancelled') ORDER BY a.id`,
    [itemId],
  );
}

async function linkedinPeopleAt(userId, companyName) {
  return Number((await one(
    `SELECT COUNT(*)::int AS n FROM job_contacts c JOIN jobs j ON j.id = c.job_id
      WHERE c.user_id = $1 AND lower(j.name) = lower($2) AND c.linkedin_url ILIKE '%linkedin.com/in/%'`,
    [userId, companyName],
  ))?.n || 0);
}

/** People at the company on LinkedIn (not just the user's connections), saved as contacts. */
export async function findLinkedInPeopleAt(userId, jobId) {
  const job = await one('SELECT * FROM jobs WHERE id = $1 AND user_id = $2', [jobId, userId]);
  if (!job) return 0;
  const { findPeopleAtLinkedInCompany } = await import('./apify.js');
  const { resolveCompanyDomain } = await import('./companyDomain.js');
  const { upsertContact } = await import('./contactFinder.js');
  const { seniorityScore } = await import('./contactRules.js');
  // Only a domain we're sure of (no guessing) narrows the search.
  const trusted = await resolveCompanyDomain(job, { verify: async () => false }).catch(() => null);
  const found = await findPeopleAtLinkedInCompany(job.name, job.linkedin_company_url || null, trusted?.domain || null, null, { userId });
  let added = 0;
  for (const p of found.slice(0, 10)) {
    if (!p.name || p.name.toLowerCase() === 'unknown') continue;
    const r = await upsertContact({ all, run }, {
      userId, jobId, seniorityScore: seniorityScore(p.title),
      contact: { name: p.name, title: p.title, linkedin_url: p.linkedin_url || null, email: p.email || null, status: p.email ? 'unverified' : undefined, source: p.source || 'linkedin' },
    });
    if (r === 'inserted') added += 1;
  }
  return added;
}

/** Look up one person's work email (Apollo by LinkedIn profile, then Hunter, Prospeo, the website) and save it. */
async function findEmailFor(userId, jobId, person) {
  const job = await one('SELECT * FROM jobs WHERE id = $1 AND user_id = $2', [jobId, userId]);
  if (!job || !person.contactId) return null;
  const { findPersonEmail } = await import('./contactFinder.js');
  const r = await findPersonEmail({ name: person.name, linkedin_url: isProfile(person.linkedin) ? person.linkedin : null }, job, { userId });
  const email = r.best?.email ? String(r.best.email).toLowerCase() : null;
  await run(
    `UPDATE job_contacts SET email = COALESCE($3, email), email_status = CASE WHEN $3::text IS NULL THEN email_status ELSE $4 END,
            email_lookup_at = NOW(), email_lookup_note = $5 WHERE id = $1 AND user_id = $2`,
    [person.contactId, userId, email, r.best?.status || 'unverified', email ? null : (r.reasons?.[0]?.message || 'No email found').slice(0, 200)],
  );
  return email;
}

/** Who works at an approved role's company: emails (when Gmail can send them) and LinkedIn profiles. */
export async function findPeopleFor(userId, item) {
  const jobId = await companyRow(userId, item.company_name, item.location);
  const out = { emails: 0, linkedin: 0 };
  try {
    if (await connectionFor(userId) && !(await hasEmailContact(userId, item.company_name))) {
      out.emails = await findEmailsAt(userId, jobId, item).catch(err => { console.warn('[referrals] email lookup failed', item.company_name, err.message); return 0; });
    }
    if (await linkedinPeopleAt(userId, item.company_name) < 3) {
      out.linkedin = await findLinkedInPeopleAt(userId, jobId).catch(err => { console.warn('[referrals] LinkedIn search failed', item.company_name, err.message); return 0; });
    }
  } finally {
    await run('UPDATE plan_items SET contacts_at = NOW(), contacts_lookup = true WHERE id = $1', [item.id]);
  }
  return out;
}

// Approved roles whose people search is running now (it can take a minute or two).
const peopleRunning = new Set();

/**
 * Find people for roles the user approved, right after they approve: one
 * company per call (the 5-minute tick), in the background, so the tick isn't
 * held up. The referral step waits for it. Lookups spend the user's monthly
 * allowance, so only approved roles get them.
 */
export async function prepareContacts(userId) {
  const item = await one(
    `SELECT * FROM plan_items
      WHERE user_id = $1 AND decision = 'approved' AND contacts_at IS NULL AND decided_at > NOW() - INTERVAL '3 days'
        AND stage IN ('tailoring', 'needs_you', 'asking_referral') AND id::text <> ALL($2::text[])
      ORDER BY decided_at LIMIT 1`,
    [userId, [...peopleRunning]],
  );
  if (!item) return null;
  peopleRunning.add(String(item.id));
  findPeopleFor(userId, item)
    .catch(err => console.warn('[referrals] people search failed', item.company_name, err.message))
    .finally(() => peopleRunning.delete(String(item.id)));
  return item.company_name;
}

/** Sort for asking: people the user knows, then recruiters, then engineers, then the rest (leaders last: they rarely refer). */
function askRank(p) {
  const t = String(p.title || '');
  if (p.knows) return 0;
  if (isRecruiterTitle(t)) return 1;
  if (/\b(vp|vice president|director|head of|chief|cto|ceo|founder|co-founder|president)\b/i.test(t)) return 3;
  if (/\b(engineer|engineering|developer|software|scientist|swe|sde)\b/i.test(t)) return 2;
  return 3;
}

// Not asked for a referral unless the user knows them: the top of the company, and people who've left.
const NOT_ASKED = /\b(ceo|chief|co-?founder|founder|president|owner|chairman)\b|\bex[- ]|\bformer(ly)?\b|\bprevious(ly)?\b/i;

/** People worth asking, best first. */
export function rankForAsk(pool) {
  return pool
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => p.knows || !NOT_ASKED.test(String(p.title || '')))
    .sort((a, b) => askRank(a.p) - askRank(b.p) || a.i - b.i)
    .map(x => x.p);
}

/** Who gets an email and who gets a LinkedIn note (different people), best first. */
export function pickTargets(pool, { canEmail = true, maxEmails = MAX_EMAILS_PER_ROLE, maxNotes = MAX_NOTES_PER_ROLE } = {}) {
  const ranked = rankForAsk(pool);
  const email = canEmail ? ranked.filter(p => p.email).slice(0, maxEmails) : [];
  const note = ranked.filter(p => !email.includes(p) && isProfile(p.linkedin)).slice(0, maxNotes);
  return { email, note };
}

/**
 * A referral email left draft: approved (scheduled), sent from Gmail, or
 * discarded. Once it goes, the wait restarts from then, so the person gets
 * the full wait to answer. The role's status line is rewritten either way.
 */
export async function referralEmailMoved(userId, row) {
  if (row?.purpose !== 'referral' || !['scheduled', 'sending', 'sent', 'cancelled'].includes(row.status)) return;
  const ask = await one('SELECT * FROM referral_asks WHERE outbox_id = $1 AND user_id = $2', [row.id, userId]);
  if (!ask) return;
  const goesOut = row.status !== 'cancelled';
  if (goesOut) await run("UPDATE referral_asks SET status = $2 WHERE id = $1 AND status = 'draft'", [ask.id, row.status === 'sent' ? 'sent' : 'scheduled']);
  const item = await one("SELECT * FROM plan_items WHERE id = $1 AND stage = 'waiting_referral'", [ask.plan_item_id]);
  if (!item) return;
  const { getSettings } = await import('./dailyPlan.js');
  const settings = await getSettings(userId);
  const tz = item.company_tz || settings.timezone;
  let applyAfter = item.apply_after ? new Date(item.apply_after) : new Date();
  if (goesOut) {
    const at = businessDaysLater(new Date(row.sent_at || row.send_after), settings.referralWaitDays, tz, { startHour: 6, endHour: 10 });
    if (at > applyAfter) applyAfter = at;
  }
  const asks = await liveAsks(item.id);
  const note = asks.length ? referralNote(asks, describeDay(applyAfter, tz)) : `No referral ask is out. Applying ${describeDay(applyAfter, tz)} unless you get a referral yourself.`;
  await run('UPDATE plan_items SET apply_after = $2, wait_until = $2, stage_note = $3 WHERE id = $1', [item.id, applyAfter, note]);
}

/** Step 1: ask. Moves the role to waiting_referral with its apply time set. */
export async function askForReferral(userId, item, settings) {
  // Never ask twice for one role: if asks exist, only (re)set the wait.
  const existing = await all('SELECT channel, person_name, status FROM referral_asks WHERE plan_item_id = $1', [item.id]);
  if (existing.length) {
    const tz0 = item.company_tz || settings.timezone;
    const at = item.apply_after ? new Date(item.apply_after) : businessDaysLater(new Date(), settings.referralWaitDays, tz0, { startHour: 6, endHour: 10 });
    await run("UPDATE plan_items SET stage = 'waiting_referral', referral_status = CASE WHEN referral_status = 'none' THEN 'asked' ELSE referral_status END, wait_until = $2, apply_after = $2, stage_note = $3 WHERE id = $1",
      [item.id, at, referralNote(await liveAsks(item.id), describeDay(at, tz0))]);
    return;
  }
  // People first: wait for a search that's running, or run it now.
  if (!item.contacts_at) {
    if (peopleRunning.has(String(item.id))) return;
    await findPeopleFor(userId, item);
  }
  const who = await me(userId);
  const jobId = await companyRow(userId, item.company_name, item.location);
  const latest = await one("SELECT report, file_id FROM resume_tailorings WHERE id = $1", [item.tailoring_id]);
  const why = str(item.reason) || str(latest?.report?.notes).slice(0, 200);
  // The role's tailored resume goes with the email.
  const attachmentFileId = latest?.file_id
    || (item.evaluation_id && (await one('SELECT resume_file_id FROM evaluations WHERE id = $1 AND user_id = $2', [item.evaluation_id, userId]))?.resume_file_id)
    || null;
  const gmail = await connectionFor(userId);

  // Everyone known at the company: connections, then contacts found there.
  const pool = [];
  for (const c of (await connectionsAt(userId, item.company_name)).slice(0, 6)) {
    const contact = await contactFor(userId, jobId, c);
    pool.push({ name: c.full_name, title: c.position, linkedin: c.profile_url, email: contact.email || c.email, contactId: contact.id, connectionId: c.id, knows: true });
  }
  const saved = await all(
    `SELECT c.* FROM job_contacts c JOIN jobs j ON j.id = c.job_id
      WHERE c.user_id = $1 AND lower(j.name) = lower($2) AND COALESCE(c.status, 'pending') NOT IN ('replied', 'closed')
      ORDER BY (c.email IS NOT NULL AND COALESCE(c.email_status, '') <> 'invalid') DESC, c.seniority_score DESC NULLS LAST LIMIT 20`,
    [userId, item.company_name],
  );
  for (const c of saved) {
    if (pool.some(p => String(p.contactId) === String(c.id))) continue;
    pool.push({ name: c.name, title: c.title, linkedin: c.linkedin_url, email: c.email_status === 'invalid' ? null : c.email, contactId: c.id, connectionId: null, knows: false });
  }
  let targets = pickTargets(pool, { canEmail: Boolean(gmail) });
  // Fewer than 2 recruiters/engineers (or people the user knows) have an email: look up theirs, at most 2 lookups.
  if (gmail) {
    const best = rankForAsk(pool).filter(p => askRank(p) <= 2);
    let tries = 0;
    for (const p of best) {
      if (tries >= 2 || best.filter(x => x.email).length >= MAX_EMAILS_PER_ROLE) break;
      if (p.email || !p.contactId) continue;
      tries += 1;
      p.email = await findEmailFor(userId, jobId, p).catch(err => { console.warn('[referrals] person email lookup failed', p.name, err.message); return null; });
    }
    targets = pickTargets(pool, { canEmail: true });
  }
  const people = [...targets.email.map(p => ({ ...p, via: 'email' })), ...targets.note.map(p => ({ ...p, via: 'linkedin' }))];

  const base = { me: who.name, school: who.school, title: item.title, company: item.company_name, jobUrl: item.apply_url, why, attached: Boolean(attachmentFileId) };
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
    if (p.via === 'email') {
      try {
        // A draft: nothing goes out until the user approves it.
        const o = await scheduleEmail(userId, { contactId: p.contactId, subject: d.subject, body: d.body, purpose: 'referral', draft: true, attachmentFileId });
        outboxId = o.id;
        status = 'draft';
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
  const asked = await all('SELECT channel, person_name, status FROM referral_asks WHERE plan_item_id = $1', [item.id]);
  const note = referralNote(asked, describeDay(applyAt, tz));
  await run(
    "UPDATE plan_items SET stage = 'waiting_referral', referral_status = 'asked', wait_until = $2, apply_after = $2, stage_note = $3 WHERE id = $1",
    [item.id, applyAt, note],
  );
}

const names = (xs) => xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;

/** The status line under a waiting role. */
export function referralNote(asks, when) {
  const drafts = asks.filter(a => a.channel === 'email' && a.status === 'draft').map(a => a.person_name);
  const emailed = asks.filter(a => a.channel === 'email' && a.status !== 'draft').map(a => a.person_name);
  const notes = asks.filter(a => a.channel === 'linkedin').map(a => a.person_name);
  if (!drafts.length && !emailed.length && !notes.length) return `Nobody you know there yet. Use the LinkedIn search below to find someone, send the note, and tell us what happens. Applying ${when} otherwise.`;
  const parts = [];
  if (drafts.length) parts.push(`your email${drafts.length > 1 ? 's' : ''} to ${names(drafts)} ${drafts.length > 1 ? 'are' : 'is'} waiting for your OK in People → Outbox`);
  if (emailed.length) parts.push(`emailing ${names(emailed)} at their next morning`);
  if (notes.length) parts.push(`notes for ${names(notes)} are ready for you to send on LinkedIn`);
  const line = parts.join('; ');
  return `${line[0].toUpperCase()}${line.slice(1)}. Applying ${when} unless a referral comes first.`;
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
    for (const a of await all("SELECT a.outbox_id FROM referral_asks a JOIN email_outbox o ON o.id = a.outbox_id WHERE a.plan_item_id = $1 AND o.step = 0 AND o.status IN ('draft', 'scheduled')", [item.id])) {
      await cancelScheduled(userId, a.outbox_id, 'Referred');
    }
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
  let url = item.referral_link && /^https?:\/\//i.test(item.referral_link) ? item.referral_link : item.apply_url;
  // A LinkedIn (or unknown-site) link: look for the same role on the company's own board.
  if (!AUTO_PLATFORMS.includes(detectPlatform(url))) {
    const { resolveToBoard } = await import('./boardResolver.js');
    const found = await resolveToBoard(item.company_name, item.title).catch(() => null);
    if (found) {
      url = found.url;
      await run('UPDATE plan_items SET stage_note = $2 WHERE id = $1', [item.id, `Found the same role on ${item.company_name}’s ${found.kind} page, applying there.`]);
    }
  }
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
  const drafts = await all("SELECT o.to_name, j.name AS company_name FROM email_outbox o LEFT JOIN job_contacts c ON c.id = o.contact_id LEFT JOIN jobs j ON j.id = c.job_id WHERE o.user_id = $1 AND o.status = 'draft'", [userId]);
  const mark = async () => {
    await run("INSERT INTO meta (user_id, key, value) VALUES ($1, $2, $3) ON CONFLICT (user_id, key) DO UPDATE SET value = EXCLUDED.value", [userId, key, date]);
    await run("INSERT INTO meta (user_id, key, value) VALUES ($1, 'daily_plan_summary_at', $2) ON CONFLICT (user_id, key) DO UPDATE SET value = EXCLUDED.value", [userId, now.toISOString()]);
  };
  if (!applied.length && !needsYou.length && !toSend.length && !drafts.length) { await mark(); return { skipped: 'nothing' }; }
  const lines = [];
  if (applied.length) lines.push(`Applied (${applied.length}):\n${applied.map(a => `  • ${a.company_name} · ${a.title}`).join('\n')}`);
  if (needsYou.length) lines.push(`Needs you (${needsYou.length}):\n${needsYou.map(a => `  • ${a.company_name} · ${a.title}: ${a.stage_note || ''}`).join('\n')}`);
  if (drafts.length) lines.push(`Emails waiting for your OK (${drafts.length}), in People → Outbox or your Gmail Drafts:\n${drafts.map(a => `  • ${a.to_name || 'Someone'}${a.company_name ? ` at ${a.company_name}` : ''}`).join('\n')}`);
  if (toSend.length) lines.push(`LinkedIn notes to send (${toSend.length}):\n${toSend.map(a => `  • ${a.person_name || 'Find someone'} at ${a.company_name}`).join('\n')}`);
  if (waiting.length) lines.push(`Waiting on a referral: ${waiting.length}`);
  const r = await sendToSelf(userId, {
    subject: `[Scout’n’Jobs] Today: ${applied.length} applied${needsYou.length ? ` · ${needsYou.length} need you` : ''}`,
    text: `${lines.join('\n\n')}\n\nOpen your plan: ${SITE}/applications/auto-apply`,
  }).catch(() => ({ skipped: true }));
  await whatsappNotify(userId, 'summary', {
    params: { body: [String(applied.length), String(needsYou.length), String(toSend.length)] },
    text: `*Today’s summary*\nHello,\n${lines.join('\n\n')}\n\nSee the details: ${SITE}/applications/auto-apply\n\nGood luck! ;)`,
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
