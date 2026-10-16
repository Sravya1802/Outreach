/**
 * boardResolver.js — a role that arrived as a LinkedIn (or unknown-site) link
 * often exists on the company's own Greenhouse, Lever or Ashby board, where
 * auto-apply can fill the form. Given the company and title, find that
 * posting. Public board APIs, no keys; results cached per company for a day.
 * Measured 2026-10-15: ~9% of LinkedIn-only US roles resolve this way.
 */

const TTL_MS = 24 * 3600_000;
const cache = new Map(); // slug → { at, board|null }

const SUFFIX = /\b(inc|incorporated|llc|ltd|limited|corp|corporation|co|company|plc|technologies|technology|labs|group|holdings|the)\b/g;

/** Candidate board slugs for a company name, most likely first. */
export function slugsFor(company) {
  const base = String(company ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');
  const stripped = base.replace(/\(.*?\)/g, '').replace(SUFFIX, ' ').replace(/[^a-z0-9\s-]/g, ' ').replace(/\s+/g, ' ').trim();
  const out = new Set();
  if (stripped) {
    out.add(stripped.replace(/[\s-]+/g, ''));
    out.add(stripped.replace(/\s+/g, '-'));
    out.add(stripped.split(' ')[0]);
  }
  const raw = base.replace(/[^a-z0-9]+/g, '');
  if (raw) out.add(raw);
  return [...out].filter(s => s.length >= 2);
}

/** Titles compare without parentheticals, punctuation or season words. */
export function normTitle(t) {
  return String(t ?? '').toLowerCase()
    .replace(/\(.*?\)/g, ' ')
    .replace(/\b(summer|fall|spring|winter|20\d\d|usa?|remote|hybrid|onsite|on-site)\b/g, ' ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function sameTitle(a, b) {
  const x = normTitle(a);
  const y = normTitle(b);
  if (!x || !y) return false;
  return x === y || x.includes(y) || y.includes(x);
}

async function getJson(url, fetchImpl) {
  try {
    const r = await fetchImpl(url, { headers: { Accept: 'application/json', 'User-Agent': 'Scout’n’Jobs job catalog' }, signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

/** The company's board: { kind, jobs: [{ title, url }] } or null. */
export async function findBoard(company, { fetchImpl = fetch, now = Date.now() } = {}) {
  const key = slugsFor(company)[0];
  if (!key) return null;
  const hit = cache.get(key);
  if (hit && now - hit.at < TTL_MS) return hit.board;
  let board = null;
  for (const slug of slugsFor(company)) {
    const gh = await getJson(`https://boards-api.greenhouse.io/v1/boards/${slug}/jobs`, fetchImpl);
    if (gh?.jobs?.length) { board = { kind: 'greenhouse', slug, jobs: gh.jobs.map(j => ({ title: j.title, url: j.absolute_url })) }; break; }
    const lv = await getJson(`https://api.lever.co/v0/postings/${slug}?mode=json`, fetchImpl);
    if (Array.isArray(lv) && lv.length) { board = { kind: 'lever', slug, jobs: lv.map(j => ({ title: j.text, url: j.hostedUrl })) }; break; }
    const ab = await getJson(`https://api.ashbyhq.com/posting-api/job-board/${slug}`, fetchImpl);
    if (ab?.jobs?.length) { board = { kind: 'ashby', slug, jobs: ab.jobs.map(j => ({ title: j.title, url: j.jobUrl })) }; break; }
  }
  cache.set(key, { at: now, board });
  return board;
}

/** The same role on the company's own board, or null. */
export async function resolveToBoard(company, title, opts) {
  const board = await findBoard(company, opts);
  if (!board) return null;
  const exact = board.jobs.find(j => normTitle(j.title) === normTitle(title));
  const loose = exact || board.jobs.find(j => sameTitle(j.title, title));
  return loose ? { kind: board.kind, url: loose.url, title: loose.title } : null;
}

export const _cache = cache;
