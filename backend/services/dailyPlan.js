/**
 * dailyPlan.js — the day's roles, picked by the user (opt-in).
 *
 *   morning (default 9 AM): score the day's new roles in the user's market
 *   against their resume (Groq, cheap), after hard filters (role type,
 *   sponsorship, one company per 30 days), and send every match (7+/10) by
 *   email and WhatsApp to be picked
 *   afternoon (default 2 PM): roles found since join the list; only those are announced
 *   the user picks each role: 'app' drafts its resume right away (batched),
 *   'self' is theirs to write, or skip. Unpicked roles cost nothing.
 *   list time (default 9 PM): the app's drafts wait for Approve; their own
 *   resumes get a reminder (upload it for the app to apply, or mark it applied)
 *   approve → the referral ask and the morning apply (referralFlow.js)
 *   Unpicked roles expire with the next list. Nothing applies without approval.
 */

import { all, one, run } from '../db.js';
import { complete } from './llm.js';
import { marketFor, regionForMarket } from './markets.js';
import { classifySponsorship } from './sponsorship.js';
import { looksLikeAgency } from './staffing.js';
import { partsIn, timezoneFor, isValidTz, nextSendSlot } from './sendWindow.js';
import { connectionFor, sendToSelf } from './gmail.js';
import { start as startTailoring, reviewReason } from './resumeEngine.js';
import { advanceReferrals, asksFor, maybeSendSummary, prepareContacts } from './referralFlow.js';
import { companyKey } from './linkedinConnections.js';
import { notify as whatsappNotify, sendPickList, eveningMessage, pickListMessage, numberedTop } from './whatsapp.js';

const KEY = 'daily_plan_settings';
const SITE = (process.env.FRONTEND_URL || process.env.FRONTEND_ORIGIN || 'https://scoutnjobs.vercel.app').replace(/\/+$/, '');
// Groq scoring is ~$0.0003 a role; 150 a night is ~5 cents and ~10 minutes.
const MAX_SCORED_PER_NIGHT = Number(process.env.DAILY_PLAN_MAX_SCORED || 150);
const SCORE_CONCURRENCY = 3;
// Filling up to the minimum never goes below this score.
const CLOSE_MATCH_FLOOR = 8.0;
const FRESH_DAYS = 4;
const COMPANY_COOLDOWN_DAYS = 30;

export const DEFAULT_SETTINGS = {
  enabled: false,
  morningHour: 9,
  updateHour: 14,
  listHour: 22,
  timezone: 'America/Chicago',
  minScore: 9.0,
  maxPerDay: 15,
  minPerDay: 10,
  referralFirst: true,
  referralWaitDays: 2,
};

const clamp = (n, lo, hi, d) => (Number.isFinite(Number(n)) ? Math.min(hi, Math.max(lo, Number(n))) : d);

export function normalizeSettings(s = {}) {
  const d = DEFAULT_SETTINGS;
  return {
    enabled: s.enabled === true,
    morningHour: Math.round(clamp(s.morningHour, 5, 12, d.morningHour)),
    updateHour: Math.round(clamp(s.updateHour, 11, 18, d.updateHour)),
    listHour: Math.round(clamp(s.listHour, 17, 23, d.listHour)),
    timezone: isValidTz(s.timezone) ? s.timezone : d.timezone,
    minScore: Math.round(clamp(s.minScore, 5, 10, d.minScore) * 10) / 10,
    maxPerDay: Math.round(clamp(s.maxPerDay, 1, 30, d.maxPerDay)),
    minPerDay: Math.round(clamp(s.minPerDay, 0, 30, d.minPerDay)),
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
const str = (v) => String(v ?? '').trim();

export const CLOSE_MATCH = 'Close match · ';

/**
 * Scored rows → tiers. One role per company on the list (the best one); the
 * list is capped at maxPerDay. When fewer than minPerDay clear the bar, the
 * best remaining roles scoring CLOSE_MATCH_FLOOR+ fill it up, marked "Close
 * match". Everything else 7+ is "worth a look".
 */
export function assignTiers(scored, { minScore, maxPerDay, minPerDay = 0 }) {
  const out = scored.map(r => ({ ...r, reason: r.reason == null ? r.reason : String(r.reason).split(CLOSE_MATCH).join('') }));
  const ranked = out.filter(r => r.tier !== 'excluded' && r.score != null).sort((a, b) => b.score - a.score);
  for (const r of ranked) r.tier = undefined;
  const companies = new Set();
  let top = 0;
  for (const r of ranked) {
    if (r.score >= minScore && top < maxPerDay && !companies.has(lc(r.company_name))) {
      r.tier = 'top';
      companies.add(lc(r.company_name));
      top += 1;
    }
  }
  const floor = Math.min(CLOSE_MATCH_FLOOR, minScore);
  for (const r of ranked) {
    if (top >= Math.min(minPerDay, maxPerDay)) break;
    if (!r.tier && r.score >= floor && !companies.has(lc(r.company_name))) {
      r.tier = 'top';
      r.reason = `${CLOSE_MATCH}${r.reason || ''}`;
      companies.add(lc(r.company_name));
      top += 1;
    }
  }
  for (const r of ranked) {
    if (r.tier) continue;
    if (r.score >= 7) {
      r.tier = 'worth';
      if (r.score >= minScore && companies.has(lc(r.company_name))) r.reason = `${r.reason || ''} (another ${r.company_name} role is on the list)`.trim();
    } else r.tier = 'low';
  }
  for (const r of out) if (!r.tier) r.tier = 'low';
  return out;
}

/** Words from the candidate's resume that make a job title worth scoring first. */
export function relevanceWords(parsed) {
  const words = new Set(['software', 'engineer', 'developer', 'swe', 'backend', 'frontend', 'full stack', 'fullstack', 'data', 'machine learning', 'ml', 'ai', 'platform', 'cloud', 'infrastructure']);
  for (const e of parsed?.experience || []) for (const w of String(e.title || '').toLowerCase().split(/[^a-z+#]+/)) if (w.length > 2) words.add(w);
  for (const s of parsed?.skills || []) for (const it of s.items || []) { const w = String(it).toLowerCase().trim(); if (w.length > 1 && w.length < 25) words.add(w); }
  for (const w of ['intern', 'internship', 'new', 'grad', 'graduate', 'junior', 'associate', 'entry']) words.delete(w);
  return [...words];
}

export function titleRelevance(title, words) {
  const t = ` ${String(title || '').toLowerCase()} `;
  let n = 0;
  for (const w of words) if (t.includes(w.includes(' ') ? w : ` ${w} `) || t.includes(` ${w},`) || t.includes(` ${w}/`)) n += 1;
  return n;
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
First list the job's qualifications, then judge each one only from the resume given (don't assume skills it doesn't show).
Return JSON: {"required_total": 6, "required_met": 5, "preferred_total": 4, "preferred_met": 2, "level": "match", "score": 8.6, "why": "one plain sentence"}
- required = must-haves / minimum qualifications; preferred = nice-to-haves / bonus points. Count each listed item once.
- level: "match" (internship or new-grad / entry level), "stretch" (asks 1–2 years), "wrong" (senior, staff, manager, PhD-only, or an unrelated field).
- score 0–10 with one decimal, and use the whole range: 9.5+ only when every required and most preferred items are met at the right level; 9.0–9.4 every required met; 8.0–8.9 one required gap; 7.0–7.9 two gaps; under 7 weak or wrong level. Two different jobs should rarely get the same score.
- why: under 140 characters, specific (the strongest match or the main gap). No praise.`;

/** The final score blends the model's judgment with the qualification counts, so scores spread out. */
export function blendScore(p) {
  const clampNum = (v, lo, hi) => Math.min(hi, Math.max(lo, Number(v) || 0));
  const model = clampNum(p.score, 0, 10);
  const reqT = clampNum(p.required_total, 0, 50), reqM = clampNum(p.required_met, 0, reqT);
  const prefT = clampNum(p.preferred_total, 0, 50), prefM = clampNum(p.preferred_met, 0, prefT);
  const req = reqT ? reqM / reqT : model / 10;
  const pref = prefT ? prefM / prefT : req;
  const level = { match: 1, stretch: 0.6, wrong: 0 }[String(p.level || '').toLowerCase()] ?? 0.8;
  const counted = 10 * (0.65 * req + 0.2 * pref + 0.15 * level);
  const blended = 0.5 * model + 0.5 * counted;
  // A wrong-level job can't score as a fit however many skills match.
  return Math.round(Math.min(blended, level === 0 ? 6.5 : 10) * 10) / 10;
}

async function scoreOne({ userId, summary, profile, role, jd }) {
  const prefs = `Wants: ${profile.target_job_type || 'intern or new grad'} roles${profile.preferred_locations ? `, prefers ${profile.preferred_locations}` : ''}.`;
  const r = await complete({
    task: 'score',
    json: true,
    maxTokens: 900,
    userId,
    system: SCORE_SYSTEM,
    user: `CANDIDATE\n${summary}\n${prefs}\n\nJOB: ${role.title} at ${role.company_name} (${role.location || 'location not given'})\n${jd.slice(0, 6000)}`,
  });
  const parsed = JSON.parse(String(r.text).replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, ''));
  return { score: blendScore(parsed), why: String(parsed.why || '').slice(0, 200), cost: r.costUsd };
}

/** The posting's job description: the listing's own if it is one, else read from the page. { text, closed } */
async function jobText(role) {
  const { fetchJobFromUrl, looksLikeJobDescription } = await import('./jobEvaluator.js');
  if (looksLikeJobDescription(role.description)) return { text: role.description, closed: false };
  const r = await fetchJobFromUrl(role.apply_url, { company: role.company_name }).catch(() => null);
  return { text: looksLikeJobDescription(r?.text) ? String(r.text).slice(0, 20000) : '', closed: Boolean(r?.closed) };
}

const unreadable = (closed) => (closed ? 'The posting looks closed' : 'Couldn’t read the posting');

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
    // Yesterday's unpicked roles expire when a new list arrives; picked ones stay until they're done.
    await run(
      "UPDATE plan_items SET decision = 'expired', decided_at = NOW() WHERE user_id = $1 AND decision = 'pending' AND pick IS NULL AND plan_id <> $2 AND tier IN ('top','worth')",
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
        LIMIT 800`,
      [userId, region, types, FRESH_DAYS],
    );
    // Score the titles closest to the resume first (newest first among equals).
    const master = await one("SELECT parsed FROM resume_files WHERE user_id = $1 AND kind = 'master' AND is_current", [userId]);
    const words = relevanceWords(master?.parsed);
    candidates.sort((a, b) => titleRelevance(b.title, words) - titleRelevance(a.title, words));
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
    const toScore = [];
    for (const role of candidates) {
      const base = { role, company_tz: timezoneFor(role.location) || null };
      if (recentCompanies.has(lc(role.company_name))) { rows.push({ ...base, tier: 'excluded', reason: `You applied to ${role.company_name} in the last ${COMPANY_COOLDOWN_DAYS} days` }); continue; }
      if (sponsor && ['citizens_only', 'no_sponsorship'].includes(role.sponsorship)) {
        rows.push({ ...base, tier: 'excluded', reason: role.sponsorship === 'citizens_only' ? 'Needs US citizens' : 'Won’t sponsor a visa' });
        continue;
      }
      const byName = looksLikeAgency(role.company_name);
      if (byName.agency) { rows.push({ ...base, tier: 'excluded', reason: byName.why }); continue; }
      if (toScore.length < MAX_SCORED_PER_NIGHT) toScore.push(base); // the rest wait for tomorrow, still fresh
    }
    let budgetErr = null;
    const scoreRole = async (base) => {
      const got = await jobText(base.role);
      const jd = got.text;
      if (sponsor && jd) {
        const s = classifySponsorship(jd);
        if (['citizens_only', 'no_sponsorship'].includes(s.status)) {
          rows.push({ ...base, jd, tier: 'excluded', reason: s.status === 'citizens_only' ? 'Needs US citizens' : 'Won’t sponsor a visa' });
          return;
        }
      }
      if (!jd) { rows.push({ ...base, tier: 'low', reason: unreadable(got.closed), score: null }); return; }
      const byText = looksLikeAgency(base.role.company_name, jd);
      if (byText.agency) { rows.push({ ...base, jd, tier: 'excluded', reason: byText.why }); return; }
      scoredCount += 1;
      try {
        const s = await scoreOne({ userId, summary, profile, role: base.role, jd });
        cost += s.cost;
        rows.push({ ...base, jd, score: s.score, reason: s.why });
      } catch (err) {
        if (err.status === 402) { budgetErr = err; return; }
        rows.push({ ...base, jd, tier: 'low', reason: `Couldn’t score it (${String(err.message).slice(0, 80)})`, score: null });
      }
    };
    for (let i = 0; i < toScore.length && !budgetErr; i += SCORE_CONCURRENCY) {
      await Promise.all(toScore.slice(i, i + SCORE_CONCURRENCY).map(scoreRole));
    }
    if (budgetErr && !rows.some(r => r.score != null)) throw budgetErr; // nothing scored: fail loudly

    for (const r of rows) {
      await run(
        `INSERT INTO plan_items (plan_id, user_id, scraped_role_id, company_name, title, apply_url, location, pay, sponsorship, tier, score, reason, company_tz, job_description)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
         ON CONFLICT (user_id, scraped_role_id) DO NOTHING`,
        [plan.id, userId, r.role.id, r.role.company_name, r.role.title, r.role.apply_url, r.role.location, r.role.salary_range, r.role.sponsorship,
          r.tier || 'low', r.score ?? null, r.reason ?? null, r.company_tz, r.jd ? String(r.jd).slice(0, 20000) : null],
      );
    }
    // Tier the whole plan together, so a rebuild adds to tonight's list instead of starting a second one.
    const all_ = await all("SELECT id, company_name, score, reason, tier, decision FROM plan_items WHERE plan_id = $1", [plan.id]);
    const tiered = assignTiers(all_.map(r => ({ ...r, score: r.score == null ? null : Number(r.score) })), settings);
    for (const r of tiered) {
      const was = all_.find(x => x.id === r.id);
      if (was.decision !== 'pending' || (was.tier === r.tier && was.reason === r.reason)) continue;
      await run('UPDATE plan_items SET tier = $2, reason = $3 WHERE id = $1', [r.id, r.tier, r.reason ?? null]);
    }
    const count = (t) => tiered.filter(r => r.tier === t).length;
    const prev = plan.stats || {};
    const stats = {
      considered: (prev.considered || 0) + candidates.length, scored: (prev.scored || 0) + scoredCount,
      top: count('top'), worth: count('worth'), low: count('low'), excluded: count('excluded'),
      costUsd: Number(((prev.costUsd || 0) + cost).toFixed(5)), ...(budgetErr ? { stoppedEarly: 'AI budget reached' } : {}),
    };
    await run("UPDATE daily_plans SET status = 'ready', stats = $2, built_at = NOW() WHERE id = $1", [plan.id, JSON.stringify(stats)]);
  } catch (err) {
    await run("UPDATE daily_plans SET status = 'failed', error = $2 WHERE id = $1", [plan.id, String(err.message).slice(0, 300)]);
    throw err;
  }
  return one('SELECT * FROM daily_plans WHERE id = $1', [plan.id]);
}

/**
 * Re-check a plan already built: drop agencies and re-score the roles still
 * waiting for a decision with the current scoring, then re-tier. Uses the
 * posting text saved on each item; a saved text that isn't a real job
 * description (a pay box, page shell) is read again from the posting.
 */
export async function refreshPlan(userId, planId) {
  const settings = await getSettings(userId);
  const profile = await profileFor(userId);
  const summary = await candidateSummary(userId);
  const items = await all("SELECT * FROM plan_items WHERE plan_id = $1 AND user_id = $2 AND decision = 'pending' AND tier IN ('top','worth')", [planId, userId]);
  let removed = 0, rescored = 0, reread = 0, cost = 0;
  for (let i = 0; i < items.length; i += SCORE_CONCURRENCY) {
    await Promise.all(items.slice(i, i + SCORE_CONCURRENCY).map(async (it) => {
      const a = looksLikeAgency(it.company_name, it.job_description || '');
      if (a.agency) { await run("UPDATE plan_items SET tier = 'excluded', reason = $2 WHERE id = $1", [it.id, a.why]); removed += 1; return; }
      const { looksLikeJobDescription } = await import('./jobEvaluator.js');
      let jd = it.job_description || '';
      if (!looksLikeJobDescription(jd)) {
        const got = await jobText({ description: '', apply_url: it.apply_url, company_name: it.company_name });
        if (!got.text) { await run("UPDATE plan_items SET tier = 'low', score = NULL, reason = $2 WHERE id = $1", [it.id, unreadable(got.closed)]); reread += 1; return; }
        jd = got.text;
        await run('UPDATE plan_items SET job_description = $2 WHERE id = $1', [it.id, jd]);
        reread += 1;
      }
      try {
        const s = await scoreOne({ userId, summary, profile, role: { title: it.title, company_name: it.company_name, location: it.location }, jd });
        cost += s.cost; rescored += 1;
        await run('UPDATE plan_items SET score = $2, reason = $3 WHERE id = $1', [it.id, s.score, s.why]);
      } catch (err) { if (err.status === 402) throw err; }
    }));
  }
  const all_ = await all("SELECT id, company_name, score, reason, tier, decision FROM plan_items WHERE plan_id = $1", [planId]);
  const tiered = assignTiers(all_.map(r => ({ ...r, score: r.score == null ? null : Number(r.score) })), settings);
  for (const r of tiered) {
    const was = all_.find(x => x.id === r.id);
    if (was.decision !== 'pending' || (was.tier === r.tier && was.reason === r.reason)) continue;
    await run('UPDATE plan_items SET tier = $2, reason = $3 WHERE id = $1', [r.id, r.tier, r.reason ?? null]);
  }
  const plan = await one('SELECT stats FROM daily_plans WHERE id = $1', [planId]);
  const count = (t) => tiered.filter(r => r.tier === t).length;
  const stats = { ...(plan?.stats || {}), top: count('top'), worth: count('worth'), low: count('low'), excluded: count('excluded'), costUsd: Number((((plan?.stats || {}).costUsd || 0) + cost).toFixed(5)) };
  await run('UPDATE daily_plans SET stats = $2 WHERE id = $1', [planId, JSON.stringify(stats)]);
  return { removed, rescored, reread, cost: Number(cost.toFixed(5)), stats };
}

// ── The evening email ───────────────────────────────────────────────────────

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const SPONSOR_LABEL = { sponsors: 'Sponsors visas', no_sponsorship: 'No sponsorship', citizens_only: 'US citizens only' };

const PICK_HOW = 'For each one, pick on the site: App drafts (I write the resume now; it waits for your approval tonight and nothing goes out before), I’ll draft my own (I remind you tonight; then upload it for me to apply, or mark it applied), or Skip. Roles you don’t pick cost nothing.';

/** The morning list (or the afternoon's new roles): every match, best first, to be picked. */
export function planEmail({ items, stats, settings, date, firstName, fresh = false }) {
  const roles = items.filter(i => i.tier === 'top' || i.tier === 'worth');
  const day = new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
  const link = `${SITE}/jobs/auto-apply`;
  const n = roles.length;
  const subject = n
    ? `${n} ${fresh ? 'new ' : ''}role${n === 1 ? '' : 's'} to pick${fresh ? ' since this morning' : ''} · ${day}`
    : `No matching roles${fresh ? ' since this morning' : ' today'} · ${day}`;
  // Only http(s) links go into the email.
  const posting = (i) => (/^https?:\/\//i.test(String(i.apply_url || '')) ? i.apply_url : null);
  const line = (i) => `${i.score?.toFixed(1) ?? '–'}  ${i.company_name} · ${i.title}${i.location ? ` · ${i.location}` : ''}${i.pay ? ` · ${i.pay}` : ''}${SPONSOR_LABEL[i.sponsorship] ? ` · ${SPONSOR_LABEL[i.sponsorship]}` : ''}\n      ${i.reason || ''}${posting(i) ? `\n      ${posting(i)}` : ''}`;
  const greet = fresh ? 'Good afternoon' : 'Good morning';
  const text = [
    `${greet}${firstName ? `, ${firstName}` : ''}. ${n ? `${n} ${fresh ? 'new ' : ''}role${n === 1 ? '' : 's'} match${n === 1 ? 'es' : ''} you${fresh ? ' since this morning' : ' today'}.` : `Nothing new matches you${fresh ? ' since this morning' : ' today'}.`}`,
    n ? `Pick them here: ${link}\n\n${PICK_HOW}` : '',
    roles.map(line).join('\n\n'),
    !fresh && stats.excluded ? `Left out: ${stats.excluded} (sponsorship, or a company you applied to recently).` : '',
    `Your drafts are ready by ${hourText(settings.listHour)}. Change these times or turn this off on the Auto-apply page.`,
  ].filter(Boolean).join('\n\n');
  const rows = roles.map(i => `
    <tr><td style="padding:14px 0;border-bottom:1px solid #d6e2ef;vertical-align:top;width:48px;font-family:monospace;font-size:17px;color:#0b6bcb">${esc(i.score?.toFixed(1) ?? '–')}</td>
    <td style="padding:14px 0;border-bottom:1px solid #d6e2ef"><b>${esc(i.company_name)}</b> · ${posting(i) ? `<a href="${esc(posting(i))}" style="color:#0b6bcb">${esc(i.title)}</a>` : esc(i.title)}<br>
    <span style="font-size:13px;color:#5b5e66">${esc([i.location, i.pay, SPONSOR_LABEL[i.sponsorship]].filter(Boolean).join(' · '))}${i.reason ? ` · ${esc(i.reason)}` : ''}</span></td></tr>`).join('');
  const html = `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#17181a;max-width:640px;margin:0 auto;padding:24px">
    <p style="font-size:20px;font-weight:600;margin:0 0 16px">Scout’n’Jobs</p>
    <h1 style="font-size:24px;font-weight:500;margin:0 0 10px">${esc(text.split('\n')[0])}</h1>
    ${n ? `<p style="font-size:15px;line-height:1.6;color:#4f525a">${esc(PICK_HOW)}</p>
    <p style="margin:18px 0"><a href="${link}" style="background:#0b6bcb;color:#fff;padding:11px 18px;border-radius:4px;text-decoration:none;font-weight:600">Pick today’s roles</a></p>
    <table style="width:100%;border-collapse:collapse;border-top:1px solid #9fb6cf">${rows}</table>` : ''}
    ${!fresh && stats.excluded ? `<p style="font-size:14px;color:#4f525a"><b>Left out:</b> ${stats.excluded} (sponsorship, or a company you applied to recently).</p>` : ''}
    <p style="font-size:12px;color:#6a6d75;margin-top:24px">Nothing is applied without your approval. Sent from your own Gmail by Scout’n’Jobs. Change these times or turn this off on the Auto-apply page.</p></div>`;
  return { subject: `[Scout’n’Jobs] ${subject}`, text, html };
}

const hourText = (h) => `${h % 12 || 12} ${h < 12 ? 'AM' : 'PM'}`;

export async function emailPlan(userId, planId) {
  const plan = await one('SELECT * FROM daily_plans WHERE id = $1 AND user_id = $2', [planId, userId]);
  if (!plan || plan.status !== 'ready') return { skipped: 'not_ready' };
  if (plan.emailed_at) return { skipped: 'already_sent' };
  const items = await all(
    `SELECT pi.*, t.status AS t_status, t.ats_score AS t_ats, (t.report->'callback'->>'after')::int AS t_callback
       FROM plan_items pi LEFT JOIN resume_tailorings t ON t.id = pi.tailoring_id
      WHERE pi.plan_id = $1 AND pi.tier IN ('top','worth') ORDER BY pi.score DESC NULLS LAST`,
    [planId],
  );
  // Nothing to look at: no email (the page still shows the day's numbers).
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

/** How long a top role from an earlier list can still be approved. */
export const MISSED_DAYS = 14;

/**
 * Approve / skip / undo one role. Approving creates its evaluation; the tick starts the resume.
 * mode: 'auto' (the app goes on to apply) or 'review' (it stops once the resume is written).
 */
export async function decide(userId, itemId, decision, mode = 'auto') {
  const applyMode = mode === 'review' ? 'review' : 'auto';
  // Never approve a "review" role as automatic: without the column (migration 036) it would be applied unseen.
  if (decision === 'approved' && applyMode === 'review' && !(await hasApplyMode())) {
    throw Object.assign(new Error('Review mode needs a one-time database update first (migration 036). Use Approve for now, or apply yourself.'), { status: 503 });
  }
  if (!['approved', 'skipped', 'pending'].includes(decision)) throw Object.assign(new Error('Bad decision'), { status: 400 });
  const item = await one('SELECT * FROM plan_items WHERE id = $1 AND user_id = $2', [itemId, userId]);
  if (!item) throw Object.assign(new Error('Not found'), { status: 404 });
  if (item.decision === 'expired') {
    // A role from an earlier list can still be approved or skipped for MISSED_DAYS.
    if (Date.now() - new Date(item.created_at).getTime() > MISSED_DAYS * 86400_000) throw Object.assign(new Error('This role’s list is too old. Find it in Jobs if you still want it.'), { status: 409 });
    if (decision === 'pending') return item;
  }
  if (item.decision === 'approved' && decision !== 'approved' && !['proposed', 'tailoring', 'needs_you'].includes(item.stage)) {
    throw Object.assign(new Error('This role is already past the resume step.'), { status: 409 });
  }
  if (decision === 'approved' && item.decision !== 'approved') {
    // The draft written with the evening list (if any) is the one that goes ahead.
    const evalId = item.evaluation_id || await evaluationFor(userId, item);
    if (await hasApplyMode()) {
      await run("UPDATE plan_items SET decision = 'approved', decided_at = NOW(), evaluation_id = $2, apply_mode = $3, stage = 'tailoring', stage_note = 'Writing your tailored resume' WHERE id = $1", [item.id, evalId, applyMode]);
    } else {
      await run("UPDATE plan_items SET decision = 'approved', decided_at = NOW(), evaluation_id = $2, stage = 'tailoring', stage_note = 'Writing your tailored resume' WHERE id = $1", [item.id, evalId]);
    }
    // Start the resume now rather than at the next cron pass.
    advanceUser(userId).catch(err => console.warn('[daily-plan] advance failed:', err.message));
    // A draft that's already written: now's the time to ask about missing skills.
    if (item.tailoring_id) import('./resumeEngine.js').then(m => m.askAboutSkills(userId, item.tailoring_id)).catch(() => {});
  } else if (decision !== 'approved') {
    // Undo on a role from an earlier list puts it back with the missed ones, not on tonight's list.
    const latest = await one('SELECT id FROM daily_plans WHERE user_id = $1 ORDER BY plan_date DESC LIMIT 1', [userId]);
    if (decision === 'pending' && String(latest?.id) !== String(item.plan_id)) decision = 'expired';
    await run("UPDATE plan_items SET decision = $2, decided_at = NOW(), stage = 'proposed', stage_note = NULL, needs_reason = NULL WHERE id = $1", [item.id, decision]);
  }
  return one('SELECT * FROM plan_items WHERE id = $1', [item.id]);
}

// plan_items.apply_mode arrives with migration 036; until it's applied, every role is automatic.
let applyModeColumn = null;
export async function hasApplyMode() {
  if (applyModeColumn === true) return true;
  const r = await one("SELECT 1 AS ok FROM information_schema.columns WHERE table_name = 'plan_items' AND column_name = 'apply_mode'").catch(() => null);
  applyModeColumn = Boolean(r);
  return applyModeColumn;
}

/**
 * Review mode, after reading the resume: "Send it". Marks the resume approved and
 * moves the role on (referral first, then the app applies) right away.
 */
export async function sendReviewed(userId, itemId) {
  const item = await one('SELECT * FROM plan_items WHERE id = $1 AND user_id = $2', [itemId, userId]);
  if (!item) throw Object.assign(new Error('Not found'), { status: 404 });
  if (item.decision !== 'approved' || item.stage !== 'needs_you' || item.needs_reason !== 'resume' || !item.tailoring_id) {
    throw Object.assign(new Error('This role isn’t waiting on its resume.'), { status: 409 });
  }
  const t = await one(
    "UPDATE resume_tailorings SET approved_at = COALESCE(approved_at, NOW()) WHERE id = $1 AND user_id = $2 AND status IN ('ready', 'needs_review') RETURNING id",
    [item.tailoring_id, userId]);
  if (!t) throw Object.assign(new Error('The resume isn’t finished yet.'), { status: 409 });
  await advanceUser(userId);
  return one('SELECT * FROM plan_items WHERE id = $1', [item.id]);
}

/**
 * A job the user brings: its link, the company, and (optionally) their own
 * resume. It joins the latest list approved as Apply for me and goes the way
 * the list's roles go: people found at the company, a referral asked for,
 * then the application in the company's morning. With their PDF it skips the
 * resume step and that PDF goes out as it is; without one, the app writes the
 * tailored resume first.
 */
export async function addOwnJob(userId, { url, company, title, jobDescription, resume }) {
  const link = str(url);
  if (!/^https?:\/\/\S+$/i.test(link)) throw Object.assign(new Error('Paste the job’s link (https://…)'), { status: 400 });
  const { fetchJobFromUrl, looksLikeJobDescription } = await import('./jobEvaluator.js');
  const pasted = str(jobDescription);
  const fetched = await fetchJobFromUrl(link, { company: str(company) || undefined }).catch(() => null);
  const text = looksLikeJobDescription(pasted) ? pasted : looksLikeJobDescription(fetched?.text) ? String(fetched.text) : '';
  if (!text) {
    throw Object.assign(new Error(fetched?.closed ? 'That posting looks closed.' : `Couldn’t read the job from that link${fetched?.error ? ` (${fetched.error.split(' — ')[0]})` : ''}. Paste the job description too.`), { status: 400 });
  }
  const name = str(company) || str(fetched?.company);
  if (!name) throw Object.assign(new Error('Add the company name'), { status: 400 });
  // Boards in front of an ATS (CareerPuck → Greenhouse) apply on the ATS form.
  const applyUrl = fetched?.atsUrl || link;
  const firstLine = text.split('\n').map(x => x.trim()).find(Boolean) || '';
  const role = str(title) || (firstLine.length <= 100 ? firstLine : '') || 'Role';
  const dup = await one(
    `SELECT pi.id FROM plan_items pi WHERE pi.user_id = $1 AND pi.decision = 'approved' AND pi.apply_url IN ($2, $3)`,
    [userId, link, applyUrl],
  );
  if (dup) throw Object.assign(new Error('That job is already on To apply.'), { status: 409 });

  const settings = await getSettings(userId);
  let plan = await one('SELECT id FROM daily_plans WHERE user_id = $1 ORDER BY plan_date DESC LIMIT 1', [userId]);
  if (!plan) {
    // No list yet: yesterday's, so tonight's list still builds.
    const yesterday = localDate(settings.timezone, new Date(Date.now() - 86400_000));
    plan = (await run("INSERT INTO daily_plans (user_id, plan_date, status, built_at) VALUES ($1, $2, 'ready', NOW()) RETURNING id", [userId, yesterday])).rows[0];
  }
  const evalId = (await run(
    `INSERT INTO evaluations (user_id, job_url, job_title, company_name, job_description, source, apply_mode, apply_status)
     VALUES ($1, $2, $3, $4, $5, 'daily_plan', 'auto', 'not_started') RETURNING id`,
    [userId, applyUrl, role, name, text.slice(0, 20000)],
  )).rows[0].id;
  if (resume?.buffer?.length) {
    const { saveForEvaluation } = await import('./resumeFiles.js');
    await saveForEvaluation(userId, evalId, resume.buffer, resume.filename || `${name}-resume.pdf`, 'uploaded');
  }
  const own = Boolean(resume?.buffer?.length);
  const stage = !own ? 'tailoring' : settings.referralFirst ? 'asking_referral' : 'ready_to_apply';
  const note = !own ? 'Writing your tailored resume'
    : settings.referralFirst ? 'Your resume. Next: finding people and asking for a referral'
    : 'Your resume. Applying in the company’s morning';
  const applyAfter = stage === 'ready_to_apply' ? nextSendSlot(settings.timezone, { startHour: 6, endHour: 10 }) : null;
  const cols = ['plan_id', 'user_id', 'evaluation_id', 'company_name', 'title', 'apply_url', 'tier', 'reason', 'decision', 'decided_at', 'stage', 'stage_note', 'apply_after', 'job_description'];
  const vals = [plan.id, userId, evalId, name, role, applyUrl, 'worth', 'Added by you', 'approved', new Date(), stage, note, applyAfter, text.slice(0, 20000)];
  if (await hasApplyMode()) { cols.push('apply_mode'); vals.push('auto'); }
  const item = (await run(`INSERT INTO plan_items (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING *`, vals)).rows[0];
  // Start now rather than at the next cron pass: the resume (if the app writes it) and the people search.
  advanceUser(userId).catch(err => console.warn('[daily-plan] advance failed:', err.message));
  prepareContacts(userId).catch(err => console.warn('[daily-plan] contacts:', err.message));
  return { item, evaluationId: Number(evalId), ownResume: own };
}

/** The evaluation (application row) a plan item's resume and application hang off. */
async function evaluationFor(userId, item) {
  return (await run(
    `INSERT INTO evaluations (user_id, job_url, job_title, company_name, job_description, score, source, apply_mode, apply_status)
     VALUES ($1, $2, $3, $4, $5, $6, 'daily_plan', 'auto', 'not_started') RETURNING id`,
    [userId, item.apply_url, item.title, item.company_name, item.job_description, item.score == null ? null : Math.round(Number(item.score) * 10)],
  )).rows[0].id;
}

/** Start a (batched) resume for every role picked for the app that has none yet. Idempotent. */
export async function draftPicked(userId) {
  const items = await all("SELECT * FROM plan_items WHERE user_id = $1 AND pick = 'app' AND decision IN ('pending', 'approved') AND tailoring_id IS NULL ORDER BY picked_at", [userId]);
  let started = 0;
  for (const it of items) {
    try {
      const evalId = it.evaluation_id || await evaluationFor(userId, it);
      const t = await startTailoring(userId, evalId, 'resume', { batch: batched() });
      await run('UPDATE plan_items SET evaluation_id = $2, tailoring_id = $3 WHERE id = $1', [it.id, evalId, t.id]);
      started += 1;
    } catch (err) {
      console.warn(`[daily-plan] draft for ${it.company_name}:`, err.message);
      if (err.status === 402) break; // AI budget reached
    }
  }
  return started;
}

const PICKS = ['app', 'self', 'skip', 'none'];

/**
 * The user's call on one listed role: 'app' (the app drafts it now and waits
 * for Approve), 'self' (they write the resume; reminded at list time), 'skip',
 * or 'none' (undecided again). Only 'app' spends anything, on its draft.
 */
export async function pickItem(userId, itemId, choice) {
  if (!PICKS.includes(choice)) throw Object.assign(new Error('Pick App drafts, I’ll draft my own, or Skip'), { status: 400 });
  const item = await one('SELECT * FROM plan_items WHERE id = $1 AND user_id = $2', [itemId, userId]);
  if (!item) throw Object.assign(new Error('Not found'), { status: 404 });
  if (item.decision === 'approved') throw Object.assign(new Error('This role is already approved.'), { status: 409 });
  if (item.decision === 'expired' && Date.now() - new Date(item.created_at).getTime() > MISSED_DAYS * 86400_000) {
    throw Object.assign(new Error('This role’s list is too old. Find it in Jobs if you still want it.'), { status: 409 });
  }
  if (choice === 'skip') {
    await run("UPDATE plan_items SET decision = 'skipped', decided_at = NOW(), pick = NULL, picked_at = NULL WHERE id = $1", [item.id]);
    return one('SELECT * FROM plan_items WHERE id = $1', [item.id]);
  }
  const pick = choice === 'none' ? null : choice;
  // A picked role gets its application row now (no AI), so uploads and "I applied" have somewhere to land.
  const evalId = item.evaluation_id || (pick ? await evaluationFor(userId, item) : null);
  await run(
    "UPDATE plan_items SET pick = $2, picked_at = CASE WHEN $2::text IS NULL THEN NULL ELSE NOW() END, evaluation_id = $3, decision = 'pending', decided_at = NULL WHERE id = $1",
    [item.id, pick, evalId],
  );
  // A draft from an earlier night (an older master resume and rules) is written again.
  const old = item.tailoring_id
    ? await one("SELECT 1 FROM resume_tailorings WHERE id = $1 AND created_at < NOW() - INTERVAL '1 day'", [item.tailoring_id])
    : null;
  if (pick === 'app' && (!item.tailoring_id || old)) {
    // Drafting starts now (batched); the tick retries if it can't.
    try {
      const t = await startTailoring(userId, evalId, 'resume', { batch: batched() });
      await run('UPDATE plan_items SET tailoring_id = $2 WHERE id = $1', [item.id, t.id]);
    } catch (err) {
      console.warn(`[daily-plan] draft for ${item.company_name}:`, err.message);
    }
  }
  return one('SELECT * FROM plan_items WHERE id = $1', [item.id]);
}

/** "I'll draft my own", finished: their PDF goes out for this role, the way addOwnJob's does. */
export async function ownResumeForItem(userId, itemId, resume) {
  if (!resume?.buffer?.length) throw Object.assign(new Error('Upload your resume as a PDF'), { status: 400 });
  const item = await one('SELECT * FROM plan_items WHERE id = $1 AND user_id = $2', [itemId, userId]);
  if (!item) throw Object.assign(new Error('Not found'), { status: 404 });
  if (item.decision === 'approved' && !['proposed', 'tailoring', 'needs_you'].includes(item.stage)) {
    throw Object.assign(new Error('This role is already past the resume step.'), { status: 409 });
  }
  const evalId = item.evaluation_id || await evaluationFor(userId, item);
  const { saveForEvaluation } = await import('./resumeFiles.js');
  await saveForEvaluation(userId, evalId, resume.buffer, resume.filename || 'Resume.pdf', 'uploaded');
  const settings = await getSettings(userId);
  const stage = settings.referralFirst ? 'asking_referral' : 'ready_to_apply';
  const note = settings.referralFirst ? 'Your resume. Next: finding people and asking for a referral' : 'Your resume. Applying in the company’s morning';
  const applyAfter = stage === 'ready_to_apply' ? nextSendSlot(item.company_tz || settings.timezone, { startHour: 6, endHour: 10 }) : null;
  await run(
    `UPDATE plan_items SET pick = 'self', picked_at = COALESCE(picked_at, NOW()), evaluation_id = $2, decision = 'approved', decided_at = NOW(),
            stage = $3, stage_note = $4, needs_reason = NULL, apply_after = $5${(await hasApplyMode()) ? ", apply_mode = 'auto'" : ''} WHERE id = $1`,
    [item.id, evalId, stage, note, applyAfter],
  );
  prepareContacts(userId).catch(err => console.warn('[daily-plan] contacts:', err.message));
  return one('SELECT * FROM plan_items WHERE id = $1', [item.id]);
}

/** Approve every role picked for the app that's still waiting (its draft goes ahead). */
export async function approveAllTop(userId, planId) {
  const items = await all("SELECT id FROM plan_items WHERE plan_id = $1 AND user_id = $2 AND pick = 'app' AND decision = 'pending'", [planId, userId]);
  for (const i of items) await decide(userId, i.id, 'approved');
  return items.length;
}

// ── Moving approved roles along (cron) ──────────────────────────────────────

// Resumes for approved roles go through Anthropic's batch API (half price,
// usually back within an hour), so they don't hold the server and need no cap.
// RESUME_BATCH=off runs them straight through, two at a time.
const MAX_TAILORING_AT_ONCE = 2;
const batched = () => process.env.RESUME_BATCH !== 'off';

/** Start resumes for approved roles and act on finished ones. */
export async function advanceUser(userId) {
  const settings = await getSettings(userId);
  const items = await all(
    `SELECT pi.*, t.status AS t_status, t.ats_score AS t_score, t.approved_at AS t_approved, t.error AS t_error,
            t.report->>'verdict' AS t_verdict, t.report->>'verdictWhy' AS t_verdict_why,
            t.report->'proposedProject'->>'name' AS t_project, t.report->'proposedProject'->>'status' AS t_project_status
       FROM plan_items pi LEFT JOIN resume_tailorings t ON t.id = pi.tailoring_id
      WHERE pi.user_id = $1 AND pi.decision = 'approved'
        AND (pi.stage = 'tailoring' OR (pi.stage = 'needs_you' AND pi.needs_reason = 'resume'))
      ORDER BY pi.decided_at`,
    [userId],
  );
  let runningNow = items.filter(i => i.tailoring_id && i.t_status === 'running').length;
  for (const i of items) {
    if (i.stage === 'tailoring' && !i.tailoring_id) {
      if (!batched() && runningNow >= MAX_TAILORING_AT_ONCE) continue;
      try {
        const t = await startTailoring(userId, i.evaluation_id, 'resume', { batch: batched() });
        await run('UPDATE plan_items SET tailoring_id = $2 WHERE id = $1', [i.id, t.id]);
        runningNow += 1;
      } catch (err) {
        await run("UPDATE plan_items SET stage = 'needs_you', needs_reason = 'resume', stage_note = $2 WHERE id = $1", [i.id, String(err.message).slice(0, 300)]);
      }
      continue;
    }
    if (!i.tailoring_id || i.t_status === 'running') continue;
    // Review mode: even a good resume waits until the user has read it and pressed Send it.
    const waitsForReview = i.apply_mode === 'review' && !i.t_approved;
    const passed = (i.t_status === 'ready' && !waitsForReview) || (i.t_status === 'needs_review' && i.t_approved);
    if (i.t_status === 'ready' && waitsForReview) {
      if (i.stage !== 'needs_you') {
        await run("UPDATE plan_items SET stage = 'needs_you', needs_reason = 'resume', stage_note = $2 WHERE id = $1",
          [i.id, `Resume ready for your review${i.t_score != null ? ` (ATS ${i.t_score}%)` : ''}. Read it, then Send it, or apply yourself.`]);
      }
      continue;
    }
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
        [i.id, reviewReason({ ats_score: i.t_score, verdict: i.t_verdict, verdict_why: i.t_verdict_why, project_name: i.t_project, project_status: i.t_project_status })]);
    } else if (i.t_status === 'failed' && i.stage !== 'needs_you') {
      await run("UPDATE plan_items SET stage = 'needs_you', needs_reason = 'resume', stage_note = $2 WHERE id = $1", [i.id, `Resume writing failed: ${i.t_error || 'unknown error'}. Open the role to try again.`]);
    }
  }
}

/** One WhatsApp message for roles that newly need the user. */
export async function notifyNeedsYou(userId) {
  const fresh = await all(
    "SELECT id, company_name, title, stage_note, needs_reason, apply_url, evaluation_id FROM plan_items WHERE user_id = $1 AND decision = 'approved' AND stage = 'needs_you' AND whatsapp_needs_at IS NULL ORDER BY decided_at",
    [userId],
  );
  if (!fresh.length) return { skipped: 'none' };
  await run('UPDATE plan_items SET whatsapp_needs_at = NOW() WHERE id = ANY($1)', [fresh.map(f => f.id)]);
  // Remember the numbering, so "APPLIED 1 3" on WhatsApp knows which roles.
  await run("INSERT INTO meta (user_id, key, value) VALUES ($1, 'needs_ask', $2) ON CONFLICT (user_id, key) DO UPDATE SET value = EXCLUDED.value", [userId, JSON.stringify({ items: fresh.map(f => Number(f.id)), at: new Date().toISOString() })]);
  const applyNums = fresh.map((f, n) => (f.needs_reason === 'apply' ? n + 1 : null)).filter(Boolean);
  const lines = fresh.map((f, n) => [
    `*${n + 1}) ${f.company_name}* · ${f.title}`,
    `   ${f.stage_note || 'needs you'}`,
    ...(f.needs_reason === 'apply' && /^https?:\/\//i.test(f.apply_url || '') ? [`   Apply: ${f.apply_url}`] : []),
    ...(f.evaluation_id ? [`   Resume: ${SITE}/resumes/job/${f.evaluation_id}`] : []),
  ].join('\n'));
  const short = fresh.map(f => `${f.company_name}: ${String(f.stage_note || 'needs you').split('.')[0]}`).join(' · ');
  const link = `${SITE}/applications/auto-apply`;
  return whatsappNotify(userId, 'needs', {
    params: { header: `${fresh.length} role${fresh.length === 1 ? '' : 's'}`, body: [short] },
    text: `*Needs you · ${fresh.length} role${fresh.length === 1 ? '' : 's'}*\nHello,\nThese approved roles are waiting on you:\n\n${lines.join('\n\n')}\n\n${applyNums.length ? `Applied yourself? Reply *APPLIED ${applyNums.join(' ')}* (or the ones you did) and they're marked applied.\n` : ''}All of them: ${link}\n\nGood luck! ;)`,
  });
}

// ── The afternoon update and the list-time message ───────────────────────────

const dayLabel = (date) => new Date(`${String(date instanceof Date ? date.toISOString() : date).slice(0, 10)}T12:00:00Z`)
  .toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });

/** Score the roles found since the morning into today's list, and announce only those. */
export async function sendUpdate(userId, planId) {
  const before = new Set((await all('SELECT id FROM plan_items WHERE plan_id = $1', [planId])).map(r => String(r.id)));
  const plan = await buildPlan(userId, { force: true });
  // Numbered on today's whole list, so "APP 12" means the same role everywhere.
  const fresh = (await numberedTop(userId)).items
    .filter(i => !before.has(String(i.id)) && i.decision === 'pending' && !i.pick)
    .map(i => ({ ...i, score: i.score == null ? null : Number(i.score) }));
  if (!fresh.length) return { skipped: 'nothing_new' };
  const settings = await getSettings(userId);
  if (await connectionFor(userId)) {
    const p = await one('SELECT first_name FROM user_profile WHERE user_id = $1', [userId]);
    await sendToSelf(userId, planEmail({ items: fresh, stats: plan?.stats || {}, settings, date: localDate(settings.timezone), firstName: p?.first_name, fresh: true }));
  }
  await whatsappNotify(userId, 'picks', pickListMessage(fresh, `${fresh.length} new`, { fresh: true }));
  return { fresh: fresh.length };
}

/** What's waiting at list time: the app's drafts to approve and the user's own resumes. */
export async function eveningItems(userId) {
  return all(
    `SELECT pi.id, pi.company_name, pi.title, pi.pick, pi.evaluation_id, t.status AS t_status, t.ats_score AS t_ats
       FROM plan_items pi LEFT JOIN resume_tailorings t ON t.id = pi.tailoring_id
      WHERE pi.user_id = $1 AND pi.decision = 'pending' AND pi.pick IS NOT NULL
      ORDER BY pi.pick, pi.picked_at`,
    [userId],
  );
}

/** List time: one email and one WhatsApp with the drafts to approve and the user's own resumes to finish. */
export async function sendEvening(userId, plan) {
  const items = await eveningItems(userId);
  const ready = items.filter(i => i.pick === 'app' && ['ready', 'needs_review'].includes(i.t_status));
  const drafting = items.filter(i => i.pick === 'app' && !['ready', 'needs_review'].includes(i.t_status));
  const own = items.filter(i => i.pick === 'self');
  if (!items.length) return { skipped: 'nothing_picked' };
  const m = eveningMessage({ ready, drafting, own, label: dayLabel(plan.plan_date) });
  if (await connectionFor(userId)) {
    const html = `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#17181a;max-width:640px;margin:0 auto;padding:24px;white-space:pre-wrap;font-size:15px;line-height:1.6">${esc(m.plain)}</div>`;
    await sendToSelf(userId, { subject: `[Scout’n’Jobs] ${m.subject}`, text: m.plain, html });
  }
  await whatsappNotify(userId, 'evening', m);
  return { ready: ready.length, drafting: drafting.length, own: own.length };
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
          // Morning: score the day's roles and send them to be picked.
          if (!plan && hour >= s.morningHour) { plan = await buildPlan(u.user_id, { now }); done.built += 1; }
          if (plan?.status === 'ready' && !plan.emailed_at && hour >= s.morningHour) {
            const r = await emailPlan(u.user_id, plan.id);
            if (r.ok) done.emailed += 1;
          }
          if (plan?.status === 'ready' && !plan.whatsapp_at && hour >= s.morningHour) {
            await run('UPDATE daily_plans SET whatsapp_at = NOW() WHERE id = $1', [plan.id]);
            await sendPickList(u.user_id).catch(err => console.warn('[daily-plan] whatsapp list:', err.message));
          }
          // Afternoon: roles found since the morning join today's list; only those are announced.
          if (plan?.status === 'ready' && !plan.update_at && hour >= s.updateHour) {
            await run('UPDATE daily_plans SET update_at = NOW() WHERE id = $1', [plan.id]);
            await sendUpdate(u.user_id, plan.id).catch(err => console.warn('[daily-plan] update:', err.message));
          }
          // List time: the app's drafts to approve, and a reminder for the resumes the user writes.
          if (plan?.status === 'ready' && !plan.evening_at && hour >= s.listHour) {
            await run('UPDATE daily_plans SET evening_at = NOW() WHERE id = $1', [plan.id]);
            await sendEvening(u.user_id, plan).catch(err => console.warn('[daily-plan] evening:', err.message));
          }
        }
        // Picked for the app: the draft starts right away (and is retried here).
        await draftPicked(u.user_id).catch(err => console.warn('[daily-plan] drafts:', err.message));
        // People at the companies of roles just approved (runs in the background).
        await prepareContacts(u.user_id).catch(err => console.warn('[daily-plan] contacts:', err.message));
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
    `SELECT pi.id, pi.scraped_role_id, pi.evaluation_id, pi.company_name, pi.title, pi.apply_url, pi.location, pi.pay, pi.sponsorship, pi.tier, pi.score, pi.reason,
            pi.decision, pi.decided_at, pi.stage, pi.stage_note, pi.pick, pi.picked_at, pi.tailoring_id, t.status AS t_status, t.ats_score AS t_ats
       FROM plan_items pi LEFT JOIN resume_tailorings t ON t.id = pi.tailoring_id
      WHERE pi.plan_id = $1 AND pi.tier IN ('top','worth') ORDER BY pi.score DESC NULLS LAST, pi.id`,
    [plan.id],
  ) : [];
  // Picked on an earlier day and still open (a draft not approved yet, a resume of their own not done).
  const picked = await all(
    `SELECT pi.id, pi.scraped_role_id, pi.evaluation_id, pi.company_name, pi.title, pi.apply_url, pi.location, pi.pay, pi.sponsorship, pi.tier, pi.score, pi.reason,
            pi.decision, pi.decided_at, pi.stage, pi.stage_note, pi.pick, pi.picked_at, pi.tailoring_id, t.status AS t_status, t.ats_score AS t_ats, p.plan_date::text AS plan_date
       FROM plan_items pi JOIN daily_plans p ON p.id = pi.plan_id LEFT JOIN resume_tailorings t ON t.id = pi.tailoring_id
      WHERE pi.user_id = $1 AND pi.decision = 'pending' AND pi.pick IS NOT NULL AND ($2::bigint IS NULL OR pi.plan_id <> $2)
      ORDER BY pi.picked_at DESC LIMIT 100`,
    [userId, plan?.id ?? null],
  );
  const active = await all(
    `SELECT pi.id, pi.evaluation_id, pi.company_name, pi.title, pi.apply_url, pi.location, pi.score, pi.stage, pi.stage_note, pi.referral_status,
            pi.referral_link, pi.company_tz, pi.wait_until, pi.apply_after, pi.applied_at, pi.decided_at, t.ats_score
       FROM plan_items pi LEFT JOIN resume_tailorings t ON t.id = pi.tailoring_id
      WHERE pi.user_id = $1 AND pi.decision = 'approved' AND pi.stage NOT IN ('done')
      ORDER BY pi.decided_at DESC LIMIT 100`,
    [userId],
  );
  // Top roles from earlier lists that were never answered. Still approvable for MISSED_DAYS.
  const missed = await all(
    `SELECT pi.id, pi.scraped_role_id, pi.evaluation_id, pi.company_name, pi.title, pi.apply_url, pi.location, pi.pay, pi.sponsorship, pi.tier, pi.score,
            pi.reason, pi.decision, pi.decided_at, pi.stage, pi.stage_note, p.plan_date::text AS plan_date, t.ats_score
       FROM plan_items pi JOIN daily_plans p ON p.id = pi.plan_id LEFT JOIN resume_tailorings t ON t.id = pi.tailoring_id
      WHERE pi.user_id = $1 AND pi.decision = 'expired' AND pi.tier = 'top' AND pi.created_at > NOW() - make_interval(days => $2)
        AND ($3::bigint IS NULL OR pi.plan_id <> $3)
      ORDER BY pi.score DESC NULLS LAST, pi.created_at DESC LIMIT 150`,
    [userId, MISSED_DAYS, plan?.id ?? null],
  );
  // People the user knows at each company (LinkedIn connections export).
  const keys = [...new Set([...items, ...picked, ...active].map(i => companyKey(i.company_name)).filter(Boolean))];
  const known = keys.length ? await all(
    'SELECT company_key, COUNT(*)::int AS n FROM linkedin_connections WHERE user_id = $1 AND company_key = ANY($2) GROUP BY company_key', [userId, keys],
  ) : [];
  const knownBy = Object.fromEntries(known.map(k => [k.company_key, k.n]));
  // People found at each company (with a usable email or a LinkedIn profile).
  const names = [...new Set([...items, ...picked, ...active].map(i => String(i.company_name).toLowerCase()))];
  const found = names.length ? await all(
    `SELECT lower(j.name) AS name, MIN(j.id) AS company_id, COUNT(*)::int AS n,
            COUNT(*) FILTER (WHERE c.email IS NOT NULL AND COALESCE(c.email_status, '') <> 'invalid')::int AS with_email
       FROM job_contacts c JOIN jobs j ON j.id = c.job_id
      WHERE c.user_id = $1 AND lower(j.name) = ANY($2)
        AND ((c.email IS NOT NULL AND COALESCE(c.email_status, '') <> 'invalid') OR c.linkedin_url ILIKE '%linkedin.com/in/%')
      GROUP BY 1`,
    [userId, names],
  ) : [];
  const foundBy = Object.fromEntries(found.map(f => [f.name, f]));
  const withKnown = (i) => {
    const f = foundBy[String(i.company_name).toLowerCase()];
    return { ...i, connections: knownBy[companyKey(i.company_name)] || 0, people: f?.n || 0, people_email: f?.with_email || 0, company_id: f ? Number(f.company_id) : null };
  };
  const asks = await asksFor(userId, active.map(a => a.id));
  return {
    settings,
    plan,
    items: items.map(withKnown),
    picked: picked.map(withKnown),
    missed: missed.map(m => ({ ...m, connections: knownBy[companyKey(m.company_name)] || 0 })),
    active: active.map(a => ({ ...withKnown(a), asks: asks.filter(x => String(x.plan_item_id) === String(a.id)) })),
    gmailConnected: Boolean(await connectionFor(userId)),
  };
}
