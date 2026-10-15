/**
 * dailyPlan.js — the evening list (opt-in).
 *
 *   ~1 hour before the list time: score the day's new roles in the user's
 *   market against their resume (Groq, cheap), after hard filters (role type,
 *   sponsorship, one company per 30 days)
 *   list time (default 10 PM America/Chicago): email the top roles (9+/10, at
 *   most 15) from the user's own Gmail
 *   user approves → evaluation row + tailored resume (resumeEngine); under-90
 *   ATS waits for them. Then the referral ask and the morning apply
 *   (referralFlow.js).
 *   Anything not approved by the next list expires. Nothing applies without approval.
 */

import { all, one, run } from '../db.js';
import { complete } from './llm.js';
import { marketFor, regionForMarket } from './markets.js';
import { classifySponsorship } from './sponsorship.js';
import { partsIn, timezoneFor, isValidTz, nextSendSlot } from './sendWindow.js';
import { connectionFor, sendToSelf } from './gmail.js';
import { start as startTailoring } from './resumeEngine.js';
import { advanceReferrals, asksFor, maybeSendSummary } from './referralFlow.js';
import { companyKey } from './linkedinConnections.js';
import { notify as whatsappNotify, sendPlanList } from './whatsapp.js';

const KEY = 'daily_plan_settings';
const SITE = process.env.FRONTEND_URL || 'https://outreach-jt.vercel.app';
const MAX_SCORED_PER_NIGHT = 40;
const FRESH_DAYS = 4;
const COMPANY_COOLDOWN_DAYS = 30;

export const DEFAULT_SETTINGS = {
  enabled: false,
  listHour: 22,
  timezone: 'America/Chicago',
  minScore: 9.0,
  maxPerDay: 15,
  referralFirst: true,
  referralWaitDays: 2,
};

const clamp = (n, lo, hi, d) => (Number.isFinite(Number(n)) ? Math.min(hi, Math.max(lo, Number(n))) : d);

export function normalizeSettings(s = {}) {
  const d = DEFAULT_SETTINGS;
  return {
    enabled: s.enabled === true,
    listHour: Math.round(clamp(s.listHour, 17, 23, d.listHour)),
    timezone: isValidTz(s.timezone) ? s.timezone : d.timezone,
    minScore: Math.round(clamp(s.minScore, 5, 10, d.minScore) * 10) / 10,
    maxPerDay: Math.round(clamp(s.maxPerDay, 1, 30, d.maxPerDay)),
    referralFirst: s.referralFirst !== false,
    referralWaitDays: Math.round(clamp(s.referralWaitDays, 0, 5, d.referralWaitDays)),
  };
}

export async function getSettings(userId) {
  const row = await one('SELECT value FROM meta WHERE user_id = $1 AND key = $2', [userId, KEY]);
  let parsed = {};
  try { parsed = row?.value ? JSON.parse(row.value) : {}; } catch { parsed = {}; }
  return normalizeSettings({ ...DEFAULT_SETTINGS, ...parsed });
}

export async function saveSettings(userId, patch) {
  const next = normalizeSettings({ ...(await getSettings(userId)), ...patch });
  // Turning the list on is the user's consent to apply to the roles they approve.
  if (next.enabled) {
    await run(
      `INSERT INTO user_profile (user_id, auto_apply_consent) VALUES ($1, 1)
       ON CONFLICT (user_id) WHERE user_id IS NOT NULL DO UPDATE SET auto_apply_consent = 1`,
      [userId],
    );
  }
  await run(
    `INSERT INTO meta (user_id, key, value) VALUES ($1, $2, $3)
     ON CONFLICT (user_id, key) DO UPDATE SET value = EXCLUDED.value`,
    [userId, KEY, JSON.stringify(next)],
  );
  return next;
}

/** "2026-10-15" in the zone. */
export function localDate(tz, now = new Date()) {
  const p = partsIn(now, tz);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

export const localHour = (tz, now = new Date()) => partsIn(now, tz).hour;

const lc = (s) => String(s ?? '').trim().toLowerCase();

/**
 * Scored rows → tiers. One role per company on the list (the best one); the
 * list is capped; the next-best go to "worth a look".
 */
export function assignTiers(scored, { minScore, maxPerDay }) {
  const out = scored.map(r => ({ ...r }));
  const ranked = out.filter(r => r.tier !== 'excluded' && r.score != null).sort((a, b) => b.score - a.score);
  const companies = new Set();
  let top = 0;
  for (const r of ranked) {
    if (r.score >= minScore && top < maxPerDay && !companies.has(lc(r.company_name))) {
      r.tier = 'top';
      companies.add(lc(r.company_name));
      top += 1;
    } else if (r.score >= 7) {
      r.tier = 'worth';
      if (r.score >= minScore && companies.has(lc(r.company_name))) r.reason = `${r.reason || ''} (another ${r.company_name} role is on the list)`.trim();
    } else {
      r.tier = 'low';
    }
  }
  for (const r of out) if (!r.tier) r.tier = 'low';
  return out;
}

async function profileFor(userId) {
  return (await one('SELECT * FROM user_profile WHERE user_id = $1', [userId])) || {};
}

export function roleTypesFor(profile) {
  const t = profile?.target_job_type;
  if (t === 'intern') return ['intern'];
  if (t === 'new_grad' || t === 'full_time') return ['new_grad'];
  return ['intern', 'new_grad'];
}

const needsSponsorship = (p) => p?.needs_sponsorship === true || p?.needs_sponsorship === 1 || p?.needs_sponsorship === '1' || lc(p?.needs_sponsorship) === 'yes';

/** What the scorer sees about the candidate: the parsed master if we have it, else the raw text. */
async function candidateSummary(userId) {
  const m = await one("SELECT parsed FROM resume_files WHERE user_id = $1 AND kind = 'master' AND is_current", [userId]);
  if (m?.parsed) {
    const p = m.parsed;
    const lines = [];
    for (const e of p.education || []) lines.push(`Education: ${[e.degree, e.field, e.school, e.end].filter(Boolean).join(', ')}${e.gpa ? ` (GPA ${e.gpa})` : ''}`);
    for (const e of p.experience || []) lines.push(`Experience: ${e.title} at ${e.company} (${[e.start, e.end].filter(Boolean).join('–')}): ${(e.bullets || []).join(' ')}`);
    for (const x of p.projects || []) lines.push(`Project: ${x.name} [${(x.tech || []).join(', ')}]: ${(x.bullets || []).join(' ')}`);
    for (const s of p.skills || []) lines.push(`${s.category}: ${(s.items || []).join(', ')}`);
    return lines.join('\n').slice(0, 6000);
  }
  return String((await one("SELECT value FROM meta WHERE user_id = $1 AND key = 'user_resume_text'", [userId]))?.value || '').slice(0, 6000);
}

const SCORE_SYSTEM = `You rate how well one candidate fits one job, for a student or new-grad job search.
Return JSON: {"score": 8.4, "why": "one plain sentence"}
- score 0–10, one decimal. 9+ = meets nearly all required qualifications and the level matches (internship / new grad); 7–8.9 = a real fit with clear gaps; under 7 = weak fit or wrong level (senior, PhD-only, unrelated field).
- Judge only from the resume given. Don't assume skills it doesn't show.
- why: under 140 characters, specific (name the matching skill or the main gap). No praise.`;

async function scoreOne({ userId, summary, profile, role, jd }) {
  const prefs = `Wants: ${profile.target_job_type || 'intern or new grad'} roles${profile.preferred_locations ? `, prefers ${profile.preferred_locations}` : ''}.`;
  const r = await complete({
    task: 'score',
    json: true,
    maxTokens: 600,
    userId,
    system: SCORE_SYSTEM,
    user: `CANDIDATE\n${summary}\n${prefs}\n\nJOB: ${role.title} at ${role.company_name} (${role.location || 'location not given'})\n${jd.slice(0, 6000)}`,
  });
  const parsed = JSON.parse(String(r.text).replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, ''));
  const score = Math.round(clamp(parsed.score, 0, 10, 0) * 10) / 10;
  return { score, why: String(parsed.why || '').slice(0, 200), cost: r.costUsd };
}

async function jobText(role) {
  if (String(role.description || '').length > 300) return role.description;
  const { fetchJobFromUrl } = await import('./jobEvaluator.js');
  const r = await fetchJobFromUrl(role.apply_url).catch(() => null);
  return String(r?.text || '').slice(0, 20000);
}

/**
 * Build tonight's plan for one user (idempotent per local date). Returns the plan row.
 */
export async function buildPlan(userId, { now = new Date(), force = false } = {}) {
  const settings = await getSettings(userId);
  const date = localDate(settings.timezone, now);
  let plan = await one('SELECT * FROM daily_plans WHERE user_id = $1 AND plan_date = $2', [userId, date]);
  // A build that died mid-way (restart) is retried after 30 minutes.
  const stale = plan?.status === 'building' && Date.now() - new Date(plan.created_at).getTime() > 30 * 60_000;
  if (plan && plan.status !== 'failed' && !stale && !force) return plan;
  if (!plan) plan = (await run("INSERT INTO daily_plans (user_id, plan_date) VALUES ($1, $2) RETURNING *", [userId, date])).rows[0];
  else await run("UPDATE daily_plans SET status = 'building', error = NULL WHERE id = $1", [plan.id]);

  try {
    // Yesterday's unanswered roles expire when a new list arrives.
    await run(
      "UPDATE plan_items SET decision = 'expired', decided_at = NOW() WHERE user_id = $1 AND decision = 'pending' AND plan_id <> $2 AND tier IN ('top','worth')",
      [userId, plan.id],
    );
    const profile = await profileFor(userId);
    const region = regionForMarket(await marketFor(userId));
    const types = roleTypesFor(profile);
    const candidates = await all(
      `SELECT sr.* FROM scraped_roles sr
        WHERE sr.is_active = 1 AND sr.region = $2 AND sr.role_type = ANY($3)
          AND COALESCE(sr.posted_at, sr.scraped_at) > NOW() - make_interval(days => $4)
          AND NOT EXISTS (SELECT 1 FROM plan_items pi WHERE pi.user_id = $1 AND pi.scraped_role_id = sr.id)
          AND NOT EXISTS (SELECT 1 FROM evaluations e WHERE e.user_id = $1 AND e.job_url = sr.apply_url)
        ORDER BY COALESCE(sr.posted_at, sr.scraped_at) DESC
        LIMIT 300`,
      [userId, region, types, FRESH_DAYS],
    );
    const recentCompanies = new Set((await all(
      `SELECT lower(company_name) AS c FROM evaluations WHERE user_id = $1 AND apply_status IN ('submitted','responded','interview','offer') AND NULLIF(applied_at, '')::timestamptz > NOW() - make_interval(days => $2)
       UNION SELECT lower(company_name) FROM plan_items WHERE user_id = $1 AND decision = 'approved' AND decided_at > NOW() - make_interval(days => $2)`,
      [userId, COMPANY_COOLDOWN_DAYS],
    )).map(r => r.c));

    const summary = await candidateSummary(userId);
    const sponsor = needsSponsorship(profile);
    const rows = [];
    let scoredCount = 0;
    let cost = 0;
    for (const role of candidates) {
      const base = { role, company_tz: timezoneFor(role.location) || null };
      if (recentCompanies.has(lc(role.company_name))) { rows.push({ ...base, tier: 'excluded', reason: `You applied to ${role.company_name} in the last ${COMPANY_COOLDOWN_DAYS} days` }); continue; }
      if (sponsor && ['citizens_only', 'no_sponsorship'].includes(role.sponsorship)) {
        rows.push({ ...base, tier: 'excluded', reason: role.sponsorship === 'citizens_only' ? 'Needs US citizens' : 'Won’t sponsor a visa' });
        continue;
      }
      if (scoredCount >= MAX_SCORED_PER_NIGHT) continue; // left for tomorrow, still fresh
      const jd = await jobText(role);
      if (sponsor && jd) {
        const s = classifySponsorship(jd);
        if (['citizens_only', 'no_sponsorship'].includes(s.status)) {
          rows.push({ ...base, jd, tier: 'excluded', reason: s.status === 'citizens_only' ? 'Needs US citizens' : 'Won’t sponsor a visa' });
          continue;
        }
      }
      if (jd.length < 200) { rows.push({ ...base, tier: 'low', reason: 'Couldn’t read the posting', score: null }); continue; }
      scoredCount += 1;
      try {
        const s = await scoreOne({ userId, summary, profile, role, jd });
        cost += s.cost;
        rows.push({ ...base, jd, score: s.score, reason: s.why });
      } catch (err) {
        if (err.status === 402) throw err; // budget: stop, don't half-build silently
        rows.push({ ...base, jd, tier: 'low', reason: `Couldn’t score it (${String(err.message).slice(0, 80)})`, score: null });
      }
    }

    const tiered = assignTiers(rows.map(r => ({ ...r, company_name: r.role.company_name })), settings);
    for (const r of tiered) {
      await run(
        `INSERT INTO plan_items (plan_id, user_id, scraped_role_id, company_name, title, apply_url, location, pay, sponsorship, tier, score, reason, company_tz, job_description)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
         ON CONFLICT (user_id, scraped_role_id) DO NOTHING`,
        [plan.id, userId, r.role.id, r.role.company_name, r.role.title, r.role.apply_url, r.role.location, r.role.salary_range, r.role.sponsorship,
          r.tier, r.score ?? null, r.reason ?? null, r.company_tz, r.jd ? String(r.jd).slice(0, 20000) : null],
      );
    }
    const count = (t) => tiered.filter(r => r.tier === t).length;
    const stats = { considered: candidates.length, scored: scoredCount, top: count('top'), worth: count('worth'), low: count('low'), excluded: count('excluded'), costUsd: Number(cost.toFixed(5)) };
    await run("UPDATE daily_plans SET status = 'ready', stats = $2, built_at = NOW() WHERE id = $1", [plan.id, JSON.stringify(stats)]);
  } catch (err) {
    await run("UPDATE daily_plans SET status = 'failed', error = $2 WHERE id = $1", [plan.id, String(err.message).slice(0, 300)]);
    throw err;
  }
  return one('SELECT * FROM daily_plans WHERE id = $1', [plan.id]);
}

// ── The evening email ───────────────────────────────────────────────────────

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const SPONSOR_LABEL = { sponsors: 'Sponsors visas', no_sponsorship: 'No sponsorship', citizens_only: 'US citizens only' };

export function planEmail({ items, stats, settings, date, firstName }) {
  const top = items.filter(i => i.tier === 'top');
  const worth = items.filter(i => i.tier === 'worth');
  const day = new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
  const link = `${SITE}/applications/auto-apply`;
  const subject = top.length
    ? `${top.length} role${top.length === 1 ? '' : 's'} to approve tonight · ${day}`
    : `No ${settings.minScore}+ roles tonight · ${worth.length} worth a look · ${day}`;
  const when = settings.referralFirst
    ? `For each one you approve, I'll write a tailored resume tonight, ask someone at the company for a referral tomorrow morning, and apply ${settings.referralWaitDays} business days later in the company's morning if no referral comes through.`
    : 'For each one you approve, I’ll write a tailored resume tonight and apply tomorrow between 6 and 10 AM in the company’s time zone.';
  const line = (i) => `${i.score?.toFixed(1) ?? '–'}  ${i.company_name} · ${i.title}${i.location ? ` · ${i.location}` : ''}${i.pay ? ` · ${i.pay}` : ''}${SPONSOR_LABEL[i.sponsorship] ? ` · ${SPONSOR_LABEL[i.sponsorship]}` : ''}\n      ${i.reason || ''}`;
  const text = [
    `Good evening${firstName ? `, ${firstName}` : ''}. ${top.length ? `${top.length} new role${top.length === 1 ? '' : 's'} scored ${settings.minScore} or higher today.` : `Nothing scored ${settings.minScore} or higher today.`}`,
    top.length ? `Approve the ones you want before bed: ${link}\n\n${when}` : '',
    top.map(line).join('\n\n'),
    worth.length ? `Also worth a look: ${worth.length} role${worth.length === 1 ? '' : 's'} scored 7.0–${(settings.minScore - 0.1).toFixed(1)}. They're on the site.` : '',
    stats.excluded ? `Left out: ${stats.excluded} (sponsorship, or a company you applied to recently).` : '',
    'Nothing is applied without your approval. Change the time or turn this off on the Auto-apply page.',
  ].filter(Boolean).join('\n\n');
  const rows = top.map(i => `
    <tr><td style="padding:14px 0;border-bottom:1px solid #dcd7cb;vertical-align:top;width:48px;font-family:monospace;font-size:17px;color:#1e6b52">${esc(i.score?.toFixed(1) ?? '–')}</td>
    <td style="padding:14px 0;border-bottom:1px solid #dcd7cb"><b>${esc(i.company_name)}</b> · ${esc(i.title)}<br>
    <span style="font-size:13px;color:#5b5e66">${esc([i.location, i.pay, SPONSOR_LABEL[i.sponsorship]].filter(Boolean).join(' · '))}${i.reason ? ` · ${esc(i.reason)}` : ''}</span></td></tr>`).join('');
  const html = `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#17181a;max-width:640px;margin:0 auto;padding:24px">
    <p style="font-size:20px;font-weight:600;margin:0 0 16px">Scout’n’Jobs</p>
    <h1 style="font-size:24px;font-weight:500;margin:0 0 10px">${esc(text.split('\n')[0])}</h1>
    ${top.length ? `<p style="font-size:15px;line-height:1.6;color:#4f525a">${esc(when)} Anything you don't approve isn't sent.</p>
    <p style="margin:18px 0"><a href="${link}" style="background:#1f3bc4;color:#fff;padding:11px 18px;border-radius:4px;text-decoration:none;font-weight:600">Review and approve</a></p>
    <table style="width:100%;border-collapse:collapse;border-top:1px solid #17181a">${rows}</table>` : ''}
    ${worth.length ? `<p style="font-size:14px;color:#4f525a;margin-top:20px"><b>Also worth a look:</b> ${worth.length} role${worth.length === 1 ? '' : 's'} scored 7.0–${(settings.minScore - 0.1).toFixed(1)}. They're on the site.</p>` : ''}
    ${stats.excluded ? `<p style="font-size:14px;color:#4f525a"><b>Left out:</b> ${stats.excluded} (sponsorship, or a company you applied to recently).</p>` : ''}
    <p style="font-size:12px;color:#6a6d75;margin-top:24px">Nothing is applied without your approval. Sent from your own Gmail by Scout’n’Jobs. Change the time or turn this off on the Auto-apply page.</p></div>`;
  return { subject: `[Scout’n’Jobs] ${subject}`, text, html };
}

export async function emailPlan(userId, planId) {
  const plan = await one('SELECT * FROM daily_plans WHERE id = $1 AND user_id = $2', [planId, userId]);
  if (!plan || plan.status !== 'ready') return { skipped: 'not_ready' };
  if (plan.emailed_at) return { skipped: 'already_sent' };
  const items = await all("SELECT * FROM plan_items WHERE plan_id = $1 AND tier IN ('top','worth') ORDER BY score DESC NULLS LAST", [planId]);
  // Nothing to look at: no email (the page still shows the night's numbers).
  if (!items.length) { await run('UPDATE daily_plans SET emailed_at = NOW() WHERE id = $1', [planId]); return { skipped: 'empty' }; }
  if (!(await connectionFor(userId))) return { skipped: 'gmail_not_connected' };
  const settings = await getSettings(userId);
  const p = await one('SELECT first_name FROM user_profile WHERE user_id = $1', [userId]);
  const mail = planEmail({ items: items.map(i => ({ ...i, score: i.score == null ? null : Number(i.score) })), stats: plan.stats || {}, settings, date: String(plan.plan_date instanceof Date ? plan.plan_date.toISOString().slice(0, 10) : plan.plan_date).slice(0, 10), firstName: p?.first_name });
  const r = await sendToSelf(userId, mail);
  if (r.ok) await run('UPDATE daily_plans SET emailed_at = NOW() WHERE id = $1', [planId]);
  return r;
}

// ── Decisions ───────────────────────────────────────────────────────────────

/** Approve / skip / undo one role. Approving creates its evaluation; the tick starts the resume. */
export async function decide(userId, itemId, decision) {
  if (!['approved', 'skipped', 'pending'].includes(decision)) throw Object.assign(new Error('Bad decision'), { status: 400 });
  const item = await one('SELECT * FROM plan_items WHERE id = $1 AND user_id = $2', [itemId, userId]);
  if (!item) throw Object.assign(new Error('Not found'), { status: 404 });
  if (item.decision === 'expired') throw Object.assign(new Error('This role’s list has expired. Find it in Jobs if you still want it.'), { status: 409 });
  if (item.decision === 'approved' && decision !== 'approved' && !['proposed', 'tailoring', 'needs_you'].includes(item.stage)) {
    throw Object.assign(new Error('This role is already past the resume step.'), { status: 409 });
  }
  if (decision === 'approved' && item.decision !== 'approved') {
    let evalId = item.evaluation_id;
    if (!evalId) {
      evalId = (await run(
        `INSERT INTO evaluations (user_id, job_url, job_title, company_name, job_description, score, source, apply_mode, apply_status)
         VALUES ($1, $2, $3, $4, $5, $6, 'daily_plan', 'auto', 'not_started') RETURNING id`,
        [userId, item.apply_url, item.title, item.company_name, item.job_description, item.score == null ? null : Math.round(Number(item.score) * 10)],
      )).rows[0].id;
    }
    await run("UPDATE plan_items SET decision = 'approved', decided_at = NOW(), evaluation_id = $2, stage = 'tailoring', stage_note = 'Writing your tailored resume' WHERE id = $1", [item.id, evalId]);
    // Start the resume now rather than at the next cron pass.
    advanceUser(userId).catch(err => console.warn('[daily-plan] advance failed:', err.message));
  } else if (decision !== 'approved') {
    await run("UPDATE plan_items SET decision = $2, decided_at = NOW(), stage = 'proposed', stage_note = NULL, needs_reason = NULL WHERE id = $1", [item.id, decision]);
  }
  return one('SELECT * FROM plan_items WHERE id = $1', [item.id]);
}

export async function approveAllTop(userId, planId) {
  const items = await all("SELECT id FROM plan_items WHERE plan_id = $1 AND user_id = $2 AND tier = 'top' AND decision = 'pending'", [planId, userId]);
  for (const i of items) await decide(userId, i.id, 'approved');
  return items.length;
}

// ── Moving approved roles along (cron) ──────────────────────────────────────

const MAX_TAILORING_AT_ONCE = 2;

/** Start resumes for approved roles and act on finished ones. */
export async function advanceUser(userId) {
  const settings = await getSettings(userId);
  const items = await all(
    `SELECT pi.*, t.status AS t_status, t.ats_score AS t_score, t.approved_at AS t_approved, t.error AS t_error
       FROM plan_items pi LEFT JOIN resume_tailorings t ON t.id = pi.tailoring_id
      WHERE pi.user_id = $1 AND pi.decision = 'approved'
        AND (pi.stage = 'tailoring' OR (pi.stage = 'needs_you' AND pi.needs_reason = 'resume'))
      ORDER BY pi.decided_at`,
    [userId],
  );
  let runningNow = items.filter(i => i.tailoring_id && i.t_status === 'running').length;
  for (const i of items) {
    if (i.stage === 'tailoring' && !i.tailoring_id) {
      if (runningNow >= MAX_TAILORING_AT_ONCE) continue;
      try {
        const t = await startTailoring(userId, i.evaluation_id, 'resume');
        await run('UPDATE plan_items SET tailoring_id = $2 WHERE id = $1', [i.id, t.id]);
        runningNow += 1;
      } catch (err) {
        await run("UPDATE plan_items SET stage = 'needs_you', needs_reason = 'resume', stage_note = $2 WHERE id = $1", [i.id, String(err.message).slice(0, 300)]);
      }
      continue;
    }
    if (!i.tailoring_id || i.t_status === 'running') continue;
    const passed = i.t_status === 'ready' || (i.t_status === 'needs_review' && i.t_approved);
    if (passed) {
      if (settings.referralFirst) {
        await run("UPDATE plan_items SET stage = 'asking_referral', needs_reason = NULL, stage_note = 'Resume ready. Next: asking for a referral' WHERE id = $1", [i.id]);
      } else {
        const tz = i.company_tz || settings.timezone;
        await run("UPDATE plan_items SET stage = 'ready_to_apply', needs_reason = NULL, apply_after = $2, stage_note = 'Resume ready. Applying in the company’s morning' WHERE id = $1",
          [i.id, nextSendSlot(tz, { startHour: 6, endHour: 10 })]);
      }
    } else if (i.t_status === 'needs_review' && i.stage !== 'needs_you') {
      await run("UPDATE plan_items SET stage = 'needs_you', needs_reason = 'resume', stage_note = $2 WHERE id = $1",
        [i.id, `Tailored resume scored ${i.t_score}% on the ATS check (target 90%). Open it to send anyway or skip the role.`]);
    } else if (i.t_status === 'failed' && i.stage !== 'needs_you') {
      await run("UPDATE plan_items SET stage = 'needs_you', needs_reason = 'resume', stage_note = $2 WHERE id = $1", [i.id, `Resume writing failed: ${i.t_error || 'unknown error'}. Open the role to try again.`]);
    }
  }
}

/** One WhatsApp message for roles that newly need the user. */
export async function notifyNeedsYou(userId) {
  const fresh = await all(
    "SELECT id, company_name, stage_note FROM plan_items WHERE user_id = $1 AND decision = 'approved' AND stage = 'needs_you' AND whatsapp_needs_at IS NULL ORDER BY decided_at",
    [userId],
  );
  if (!fresh.length) return { skipped: 'none' };
  await run('UPDATE plan_items SET whatsapp_needs_at = NOW() WHERE id = ANY($1)', [fresh.map(f => f.id)]);
  const short = fresh.map(f => `${f.company_name}: ${String(f.stage_note || 'needs you').split('.')[0]}`).join(' · ');
  const link = `${SITE}/applications/auto-apply`;
  return whatsappNotify(userId, 'needs', {
    params: [String(fresh.length), short, link],
    text: `${fresh.length} of your approved roles need you:\n\n${fresh.map(f => `• ${f.company_name}: ${f.stage_note || 'needs you'}`).join('\n')}\n\n${link}`,
  });
}

// ── Cron entry point ────────────────────────────────────────────────────────

let ticking = false;
/** Every few minutes: build lists an hour before list time, email them at list time, advance approved roles. */
export async function tick(now = new Date()) {
  if (ticking) return { skipped: true };
  ticking = true;
  const done = { built: 0, emailed: 0, advanced: 0 };
  try {
    // Users with the list on, plus anyone with approved roles still moving (settings never saved = defaults).
    const users = await all(
      `SELECT u.user_id, m.value FROM (
         SELECT user_id FROM meta WHERE key = $1
         UNION SELECT DISTINCT user_id FROM plan_items WHERE decision = 'approved' AND stage IN ('tailoring','needs_you','asking_referral','waiting_referral','ready_to_apply')
       ) u LEFT JOIN meta m ON m.user_id = u.user_id AND m.key = $1`,
      [KEY],
    );
    for (const u of users) {
      let s;
      try { s = normalizeSettings(u.value ? JSON.parse(u.value) : {}); } catch { s = normalizeSettings({}); }
      try {
        if (s.enabled) {
          const hour = localHour(s.timezone, now);
          const date = localDate(s.timezone, now);
          let plan = await one('SELECT * FROM daily_plans WHERE user_id = $1 AND plan_date = $2', [u.user_id, date]);
          if (!plan && hour >= s.listHour - 1) { plan = await buildPlan(u.user_id, { now }); done.built += 1; }
          if (plan?.status === 'ready' && !plan.emailed_at && hour >= s.listHour) {
            const r = await emailPlan(u.user_id, plan.id);
            if (r.ok) done.emailed += 1;
          }
          if (plan?.status === 'ready' && !plan.whatsapp_at && hour >= s.listHour) {
            await run('UPDATE daily_plans SET whatsapp_at = NOW() WHERE id = $1', [plan.id]);
            await sendPlanList(u.user_id).catch(err => console.warn('[daily-plan] whatsapp list:', err.message));
          }
        }
        await advanceUser(u.user_id);
        await advanceReferrals(u.user_id, s);
        await notifyNeedsYou(u.user_id).catch(err => console.warn('[daily-plan] whatsapp needs:', err.message));
        if (s.enabled) await maybeSendSummary(u.user_id, s, now);
        done.advanced += 1;
      } catch (err) {
        console.warn(`[daily-plan] ${String(u.user_id).slice(0, 8)}: ${err.message}`);
      }
    }
  } finally {
    ticking = false;
  }
  return done;
}

/** What the Auto-apply page shows. */
export async function overview(userId) {
  const settings = await getSettings(userId);
  const plan = await one('SELECT * FROM daily_plans WHERE user_id = $1 ORDER BY plan_date DESC LIMIT 1', [userId]);
  const items = plan ? await all(
    `SELECT id, scraped_role_id, evaluation_id, company_name, title, apply_url, location, pay, sponsorship, tier, score, reason, decision, decided_at, stage, stage_note
       FROM plan_items WHERE plan_id = $1 AND tier IN ('top','worth') ORDER BY tier = 'top' DESC, score DESC NULLS LAST`,
    [plan.id],
  ) : [];
  const active = await all(
    `SELECT pi.id, pi.evaluation_id, pi.company_name, pi.title, pi.apply_url, pi.location, pi.score, pi.stage, pi.stage_note, pi.referral_status,
            pi.referral_link, pi.company_tz, pi.wait_until, pi.apply_after, pi.applied_at, pi.decided_at, t.ats_score
       FROM plan_items pi LEFT JOIN resume_tailorings t ON t.id = pi.tailoring_id
      WHERE pi.user_id = $1 AND pi.decision = 'approved' AND pi.stage NOT IN ('done')
      ORDER BY pi.decided_at DESC LIMIT 100`,
    [userId],
  );
  // People the user knows at each company (LinkedIn connections export).
  const keys = [...new Set([...items, ...active].map(i => companyKey(i.company_name)).filter(Boolean))];
  const known = keys.length ? await all(
    'SELECT company_key, COUNT(*)::int AS n FROM linkedin_connections WHERE user_id = $1 AND company_key = ANY($2) GROUP BY company_key', [userId, keys],
  ) : [];
  const knownBy = Object.fromEntries(known.map(k => [k.company_key, k.n]));
  const withKnown = (i) => ({ ...i, connections: knownBy[companyKey(i.company_name)] || 0 });
  const asks = await asksFor(userId, active.map(a => a.id));
  return {
    settings,
    plan,
    items: items.map(withKnown),
    active: active.map(a => ({ ...withKnown(a), asks: asks.filter(x => String(x.plan_item_id) === String(a.id)) })),
    gmailConnected: Boolean(await connectionFor(userId)),
  };
}
