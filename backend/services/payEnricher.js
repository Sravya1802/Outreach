// Fill in posted pay for catalog roles hosted on Greenhouse, Ashby and Lever.
// All three have free public job-board APIs that return each posting's pay
// range (or its description, which usually states it). One request per
// company board covers every role on it.
import { all, run } from '../db.js';
import { formatPay, payFromText } from './payParse.js';

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
  const res = await fetchImpl(url, { headers: { Accept: 'application/json', 'User-Agent': 'OutreachOS job catalog' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** One company board → Map(jobId → pay text|null). */
export async function fetchBoardPay({ ats, board }, fetchImpl = fetch) {
  const out = new Map();
  const b = encodeURIComponent(board);
  if (ats === 'greenhouse') {
    const d = await getJson(`https://boards-api.greenhouse.io/v1/boards/${b}/jobs?content=true&pay_transparency=true`, fetchImpl);
    for (const j of d?.jobs || []) out.set(String(j.id), payFromGreenhouse(j));
  } else if (ats === 'ashby') {
    const d = await getJson(`https://api.ashbyhq.com/posting-api/job-board/${b}?includeCompensation=true`, fetchImpl);
    for (const j of d?.jobs || []) out.set(String(j.id), payFromAshby(j));
  } else if (ats === 'lever') {
    const d = await getJson(`https://api.lever.co/v0/postings/${b}?mode=json`, fetchImpl);
    for (const p of Array.isArray(d) ? d : []) out.set(String(p.id), payFromLever(p));
  }
  return out;
}

async function mapLimit(items, limit, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) await fn(items[i++]);
  }));
}

/**
 * Look up posted pay for active roles that have none and weren't checked in
 * the last week. Every looked-at row gets pay_checked_at so it isn't re-fetched
 * daily. Returns { boards, checked, filled, failedBoards }.
 */
export async function enrichPostedPay({ limit = 3000, fetchImpl = fetch, log = console } = {}) {
  const rows = await all(
    `SELECT id, apply_url FROM scraped_roles
      WHERE is_active = 1 AND salary_range IS NULL
        AND (pay_checked_at IS NULL OR pay_checked_at < NOW() - ($1::int * INTERVAL '1 day'))
        AND apply_url ~* '^https?://(job-boards\\.greenhouse\\.io|boards\\.greenhouse\\.io|jobs\\.ashbyhq\\.com|jobs\\.lever\\.co)/'
      ORDER BY scraped_at DESC LIMIT $2`,
    [RECHECK_DAYS, limit],
  );
  const groups = new Map();
  for (const r of rows) {
    const b = boardFor(r.apply_url);
    if (!b) continue;
    const key = `${b.ats}:${b.board.toLowerCase()}`;
    if (!groups.has(key)) groups.set(key, { ats: b.ats, board: b.board, rows: [] });
    groups.get(key).rows.push({ id: r.id, jobId: b.id });
  }
  let filled = 0; let checked = 0; let failedBoards = 0;
  await mapLimit([...groups.values()], 4, async g => {
    let pay;
    try { pay = await fetchBoardPay(g, fetchImpl); } catch (err) {
      failedBoards++;
      log.warn?.(`[pay] ${g.ats}/${g.board}: ${err.message}`);
      return;
    }
    const found = g.rows.map(r => ({ ...r, pay: pay.get(String(r.jobId)) || null }));
    const withPay = found.filter(r => r.pay);
    for (const r of withPay) {
      await run('UPDATE scraped_roles SET salary_range = $2, pay_checked_at = NOW() WHERE id = $1 AND salary_range IS NULL', [r.id, r.pay.slice(0, 100)]);
    }
    const without = found.filter(r => !r.pay).map(r => r.id);
    if (without.length) await run('UPDATE scraped_roles SET pay_checked_at = NOW() WHERE id = ANY($1::bigint[])', [without]);
    filled += withPay.length;
    checked += found.length;
  });
  return { boards: groups.size, checked, filled, failedBoards };
}
