// Fill in posted pay for catalog roles hosted on Greenhouse, Ashby and Lever.
// All three have free public job-board APIs that return each posting's pay
// range (or its description, which usually states it). One request per
// company board covers every role on it.
import { all, run } from '../db.js';
import { formatPay, payFromText } from './payParse.js';
import { classifySponsorship } from './sponsorship.js';

const TIMEOUT_MS = 20_000;
const RECHECK_DAYS = 7;

/** apply_url → { ats, board, id } for the three supported job boards. */
export function boardFor(url) {
  let u;
  try { u = new URL(url); } catch { return null; }
  const host = u.hostname.toLowerCase();
  const parts = u.pathname.split('/').filter(Boolean);
  if (host === 'job-boards.greenhouse.io' || host === 'boards.greenhouse.io') {
    if (parts[0] === 'embed') {
      const board = u.searchParams.get('for'); const id = u.searchParams.get('token');
      return board && id ? { ats: 'greenhouse', board, id } : null;
    }
    const i = parts.indexOf('jobs');
    return i > 0 && /^\d+$/.test(parts[i + 1] || '') ? { ats: 'greenhouse', board: parts[0], id: parts[i + 1] } : null;
  }
  if (host === 'jobs.ashbyhq.com' && parts.length >= 2) return { ats: 'ashby', board: parts[0], id: parts[1] };
  if (host === 'jobs.lever.co' && parts.length >= 2) return { ats: 'lever', board: parts[0], id: parts[1] };
  return null;
}

function intervalFromLabel(label) {
  const t = String(label || '').toLowerCase();
  if (/hour/.test(t)) return 'hour';
  if (/month/.test(t)) return 'month';
  if (/week/.test(t)) return 'week';
  if (/year|annual|salary/.test(t)) return 'year';
  return null;
}
const guessInterval = n => (n < 300 ? 'hour' : n < 20_000 ? 'month' : 'year');

/** Greenhouse job (content=true&pay_transparency=true) → pay text or null. */
export function payFromGreenhouse(job) {
  const r = (job?.pay_input_ranges || []).find(x => Number(x.min_cents) > 0 || Number(x.max_cents) > 0);
  if (r) {
    const min = Number(r.min_cents) / 100; const max = Number(r.max_cents) / 100;
    return formatPay({ min, max, interval: intervalFromLabel(r.title) || guessInterval(Math.max(min, max)), currency: r.currency_type || 'USD' });
  }
  // Content is HTML-escaped in the list response.
  const html = String(job?.content || '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"');
  return payFromText(html);
}

/** Ashby job (includeCompensation=true) → pay text or null. */
export function payFromAshby(job) {
  const comps = (job?.compensation?.compensationTiers || []).flatMap(t => t.components || [])
    .concat(job?.compensation?.summaryComponents || []);
  const c = comps.find(x => /salary|hourly|base/i.test(String(x.compensationType)) && (Number(x.minValue) > 0 || Number(x.maxValue) > 0));
  if (c) {
    const interval = /HOUR/i.test(c.interval) ? 'hour' : /MONTH/i.test(c.interval) ? 'month' : /WEEK/i.test(c.interval) ? 'week'
      : /YEAR/i.test(c.interval) ? 'year' : guessInterval(Math.max(Number(c.minValue) || 0, Number(c.maxValue) || 0));
    return formatPay({ min: c.minValue, max: c.maxValue, interval, currency: c.currencyCode || 'USD' });
  }
  return payFromText(job?.descriptionPlain || job?.descriptionHtml || '');
}

/** Lever posting (mode=json) → pay text or null. */
export function payFromLever(p) {
  const s = p?.salaryRange;
  if (s && (Number(s.min) > 0 || Number(s.max) > 0)) {
    const interval = /hour/i.test(s.interval) ? 'hour' : /month/i.test(s.interval) ? 'month' : /week/i.test(s.interval) ? 'week' : 'year';
    return formatPay({ min: s.min, max: s.max, interval, currency: s.currency || 'USD' });
  }
  return payFromText([p?.additionalPlain, p?.descriptionPlain, ...(p?.lists || []).map(l => `${l.text} ${l.content}`)].filter(Boolean).join(' '));
}

async function getJson(url, fetchImpl) {
  const res = await fetchImpl(url, { headers: { Accept: 'application/json', 'User-Agent': 'Scout’n’Jobs job catalog' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

const ghText = j => String(j?.content || '');
const ashbyText = j => j?.descriptionHtml || j?.descriptionPlain || '';
const leverText = p => [p?.descriptionPlain, p?.additionalPlain, ...(p?.lists || []).map(l => `${l.text}\n${l.content}`)].filter(Boolean).join('\n');

/** One company board → Map(jobId → { pay, text }). */
export async function fetchBoard({ ats, board }, fetchImpl = fetch) {
  const out = new Map();
  const b = encodeURIComponent(board);
  if (ats === 'greenhouse') {
    const d = await getJson(`https://boards-api.greenhouse.io/v1/boards/${b}/jobs?content=true&pay_transparency=true`, fetchImpl);
    for (const j of d?.jobs || []) out.set(String(j.id), { pay: payFromGreenhouse(j), text: ghText(j) });
  } else if (ats === 'ashby') {
    const d = await getJson(`https://api.ashbyhq.com/posting-api/job-board/${b}?includeCompensation=true`, fetchImpl);
    for (const j of d?.jobs || []) out.set(String(j.id), { pay: payFromAshby(j), text: ashbyText(j) });
  } else if (ats === 'lever') {
    const d = await getJson(`https://api.lever.co/v0/postings/${b}?mode=json`, fetchImpl);
    for (const p of Array.isArray(d) ? d : []) out.set(String(p.id), { pay: payFromLever(p), text: leverText(p) });
  }
  return out;
}

/** Back-compat: one board → Map(jobId → pay text|null). */
export async function fetchBoardPay(b, fetchImpl = fetch) {
  const m = await fetchBoard(b, fetchImpl);
  return new Map([...m].map(([k, v]) => [k, v.pay]));
}

/**
 * Per-posting APIs for boards without a whole-board feed:
 *   Workday:         https://{tenant}.wdN.myworkdayjobs.com/[locale/]{site}/job/{…}
 *                    → /wday/cxs/{tenant}/{site}/job/{…}
 *   SmartRecruiters: https://jobs.smartrecruiters.com/{Company}/{postingId}-{slug}
 *                    → api.smartrecruiters.com/v1/companies/{Company}/postings/{postingId}
 */
export function postingApiFor(url) {
  let u;
  try { u = new URL(url); } catch { return null; }
  const host = u.hostname.toLowerCase();
  const parts = u.pathname.split('/').filter(Boolean);
  if (/\.myworkdayjobs\.com$/.test(host)) {
    const p = /^[a-z]{2}-[A-Z]{2}$/.test(parts[0] || '') ? parts.slice(1) : parts;
    const i = p.indexOf('job');
    if (i < 1 || i === p.length - 1) return null;
    return { ats: 'workday', url: `https://${host}/wday/cxs/${host.split('.')[0]}/${p[0]}/job/${p.slice(i + 1).join('/')}` };
  }
  if (host === 'jobs.smartrecruiters.com' && parts.length >= 2) {
    const id = (parts[1].match(/^(\d{6,})/) || [])[1];
    return id ? { ats: 'smartrecruiters', url: `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(parts[0])}/postings/${id}` } : null;
  }
  return null;
}

export async function fetchPosting({ ats, url }, fetchImpl = fetch) {
  const d = await getJson(url, fetchImpl);
  if (!d) return null;
  if (ats === 'workday') {
    const text = d?.jobPostingInfo?.jobDescription || '';
    return { pay: payFromText(text), text };
  }
  const sec = d?.jobAd?.sections || {};
  const text = [sec.jobDescription?.text, sec.qualifications?.text, sec.additionalInformation?.text].filter(Boolean).join('\n');
  return { pay: payFromText(text), text };
}

async function mapLimit(items, limit, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) await fn(items[i++]);
  }));
}

const SUPPORTED_HOSTS = String.raw`^https?://(job-boards\.greenhouse\.io|boards\.greenhouse\.io|jobs\.ashbyhq\.com|jobs\.lever\.co|[a-z0-9-]+\.wd[0-9]+\.myworkdayjobs\.com|jobs\.smartrecruiters\.com)/`;

async function saveDetails(id, { pay, text }) {
  const sp = classifySponsorship(text);
  await run(
    `UPDATE scraped_roles
        SET salary_range = COALESCE(salary_range, $2),
            sponsorship = COALESCE($3, sponsorship),
            sponsorship_quote = COALESCE($4, sponsorship_quote),
            pay_checked_at = NOW(), jd_checked_at = NOW()
      WHERE id = $1`,
    [id, pay ? pay.slice(0, 100) : null, sp.status, sp.quote],
  );
  return { pay: Boolean(pay), sponsorship: sp.status };
}

/**
 * Read each active role's job description once a week: fill posted pay where
 * missing and record what it says about visa sponsorship. Whole-board feeds
 * (Greenhouse, Ashby, Lever) cost one request per company; Workday and
 * SmartRecruiters one per posting; rows that already carry a description
 * (e.g. Indeed via JobSpy) are read from the database.
 * Returns { boards, postings, checked, pay, sponsorship: {…counts} }.
 */
export async function enrichPostingDetails({ limit = 4000, perPostingLimit = 600, fetchImpl = fetch, log = console } = {}) {
  const stats = { boards: 0, postings: 0, checked: 0, pay: 0, failed: 0, sponsorship: { sponsors: 0, no_sponsorship: 0, citizens_only: 0, unknown: 0 } };
  const tally = r => {
    stats.checked++;
    if (r.pay) stats.pay++;
    stats.sponsorship[r.sponsorship || 'unknown']++;
  };
  const due = `is_active = 1 AND (jd_checked_at IS NULL OR jd_checked_at < NOW() - ($1::int * INTERVAL '1 day'))`;

  // 1. Descriptions already stored with the row.
  const stored = await all(`SELECT id, description FROM scraped_roles WHERE ${due} AND description IS NOT NULL AND length(description) > 200 LIMIT $2`, [RECHECK_DAYS, limit]);
  for (const r of stored) tally(await saveDetails(r.id, { pay: payFromText(r.description), text: r.description }));

  // 2. Supported job boards.
  const rows = await all(
    `SELECT id, apply_url FROM scraped_roles WHERE ${due} AND (description IS NULL OR length(description) <= 200) AND apply_url ~* $3
      ORDER BY scraped_at DESC LIMIT $2`,
    [RECHECK_DAYS, limit, SUPPORTED_HOSTS],
  );
  const groups = new Map();
  const single = [];
  for (const r of rows) {
    const b = boardFor(r.apply_url);
    if (b) {
      const key = `${b.ats}:${b.board.toLowerCase()}`;
      if (!groups.has(key)) groups.set(key, { ats: b.ats, board: b.board, rows: [] });
      groups.get(key).rows.push({ id: r.id, jobId: b.id });
      continue;
    }
    const api = postingApiFor(r.apply_url);
    if (api && single.length < perPostingLimit) single.push({ id: r.id, ...api });
  }
  stats.boards = groups.size;
  await mapLimit([...groups.values()], 4, async g => {
    let board;
    try { board = await fetchBoard(g, fetchImpl); } catch (err) {
      stats.failed++;
      log.warn?.(`[details] ${g.ats}/${g.board}: ${err.message}`);
      return;
    }
    for (const r of g.rows) {
      const hit = board.get(String(r.jobId));
      if (hit) tally(await saveDetails(r.id, hit));
      else await run('UPDATE scraped_roles SET jd_checked_at = NOW(), pay_checked_at = NOW() WHERE id = $1', [r.id]); // closed or moved
    }
  });
  stats.postings = single.length;
  await mapLimit(single, 3, async p => {
    try {
      const hit = await fetchPosting(p, fetchImpl);
      if (hit) tally(await saveDetails(p.id, hit));
      else await run('UPDATE scraped_roles SET jd_checked_at = NOW() WHERE id = $1', [p.id]);
    } catch (err) {
      stats.failed++;
      if (stats.failed <= 5) log.warn?.(`[details] ${p.ats} ${p.url}: ${err.message}`);
    }
  });
  return stats;
}

/** Kept for the cron and older callers. */
export const enrichPostedPay = enrichPostingDetails;
