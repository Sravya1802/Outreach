import { Router } from 'express';
import * as cheerio from 'cheerio';
import { one, run } from '../db.js';
import { safeFetch } from '../services/safeFetch.js';

const router = Router();

const INTERN_KEYWORDS = [
  'intern', 'internship', 'co-op', 'coop',
  'summer 2025', 'summer 2026', 'new grad', 'ng 2025', 'ng 2026',
];

function isInternRole(title = '') {
  const t = title.toLowerCase();
  return INTERN_KEYWORDS.some(kw => t.includes(kw));
}

// Walks the Apple SSR HTML balancing brackets so we don't get a truncated array.
function extractAppleSearchResults(html) {
  const keyIdx = html.indexOf('"searchResults"');
  if (keyIdx < 0) return null;
  let i = keyIdx + '"searchResults"'.length;
  while (i < html.length && html[i] !== '[') i++;
  if (html[i] !== '[') return null;
  const start = i;
  let depth = 0, inStr = false, esc = false;
  for (; i < html.length; i++) {
    const c = html[i];
    if (inStr) {
      if (esc) { esc = false; continue; }
      if (c === '\\') { esc = true; continue; }
      if (c === '"')  { inStr = false; continue; }
      continue;
    }
    if (c === '"') { inStr = true; continue; }
    if (c === '[') depth++;
    else if (c === ']') { depth--; if (depth === 0) { i++; break; } }
  }
  if (depth !== 0) return null;
  try { return JSON.parse(html.slice(start, i)); } catch { return null; }
}

async function fetchApplePortalRoles(maxPages = 3) {
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  };
  const out = [];
  const seen = new Set();
  const add = (it) => {
    const title = it.postingTitle || it.transformedPostingTitle;
    if (!title || !isInternRole(title)) return;
    const id = it.id || it.positionId;
    if (!id) return;
    const slug = (it.transformedPostingTitle || title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const url = `https://jobs.apple.com/en-us/details/${id}/${slug}`;
    if (seen.has(url)) return;
    seen.add(url);
    out.push({ title: title.trim(), location: Array.isArray(it.locations) && it.locations[0]?.name || '', url });
  };

  // JSON API first — faster and more reliable when accessible.
  try {
    for (let page = 1; page <= maxPages; page++) {
      const r = await fetch('https://jobs.apple.com/api/role/search', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({
          query:   'internship',
          filters: { locations: ['united-states-USA'] },
          page, locale: 'en-us', sort: 'newest',
        }),
        signal: AbortSignal.timeout(10000),
      });
      if (!r.ok) break;
      const data = await r.json().catch(() => null);
      const items = data?.searchResults || data?.res?.searchResults || [];
      if (!Array.isArray(items) || items.length === 0) break;
      for (const it of items) add(it);
      const total = data?.totalRecords ?? data?.res?.totalRecords ?? 0;
      if (out.length >= total) break;
    }
    if (out.length > 0) return out;
  } catch {}

  // SSR fallback.
  const htmlHeaders = { ...headers, 'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' };
  const urlBuilders = [
    (p) => `https://jobs.apple.com/en-us/search?search=internship&location=united-states-USA${p > 1 ? `&page=${p}` : ''}`,
    (p) => `https://jobs.apple.com/en-us/search?team=internships-STDNT-INTRN&location=united-states-USA${p > 1 ? `&page=${p}` : ''}`,
  ];
  for (const mkUrl of urlBuilders) {
    for (let page = 1; page <= maxPages; page++) {
      try {
        const r = await fetch(mkUrl(page), { headers: htmlHeaders, signal: AbortSignal.timeout(10000) });
        if (!r.ok) break;
        const html = (await r.text()).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
        const items = extractAppleSearchResults(html);
        if (!Array.isArray(items) || items.length === 0) break;
        const before = out.length;
        for (const it of items) add(it);
        if (out.length === before) break;
      } catch { break; }
    }
    if (out.length > 0) break;
  }
  return out;
}

// ── ATS fetchers ──────────────────────────────────────────────────────────────

async function fetchGreenhouseRoles(token) {
  const url = `https://api.greenhouse.io/v1/boards/${token}/jobs?content=false`;
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`Greenhouse ${res.status}`);
  const data = await res.json();
  return (data.jobs || [])
    .filter(j => isInternRole(j.title))
    .map(j => ({ title: j.title, location: j.location?.name || '', url: j.absolute_url || '' }));
}

async function fetchLeverRoles(token) {
  const url = `https://api.lever.co/v0/postings/${token}?mode=json&limit=250`;
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`Lever ${res.status}`);
  const data = await res.json();
  return (Array.isArray(data) ? data : [])
    .filter(j => isInternRole(j.text))
    .map(j => ({ title: j.text, location: j.categories?.location || '', url: j.hostedUrl || '' }));
}

async function fetchAshbyRoles(token) {
  const url = `https://api.ashbyhq.com/posting-api/job-board/${token}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`Ashby ${res.status}`);
  const data = await res.json();
  return (data.jobs || [])
    .filter(j => isInternRole(j.title))
    .map(j => ({ title: j.title, location: j.location || '', url: j.jobUrl || '' }));
}

async function fetchHTMLRoles(careersUrl) {
  const fetched = await safeFetch(careersUrl, {
    timeoutMs: 10000,
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; InternFinder/1.0)' },
  });
  if (!fetched.res.ok) throw new Error(`HTTP ${fetched.res.status}`);
  const html = await fetched.text();
  const $ = cheerio.load(html);

  const roles = [];
  const seen = new Set();

  $('a, h2, h3, li, div[class*="job"], div[class*="role"], span[class*="title"]').each((_, el) => {
    const text = $(el).text().replace(/\s+/g, ' ').trim();
    if (text.length < 5 || text.length > 200 || !isInternRole(text)) return;
    if (seen.has(text)) return;
    seen.add(text);
    const href = el.tagName === 'a' ? ($(el).attr('href') || '') : '';
    const fullUrl = href.startsWith('http') ? href : href ? new URL(href, careersUrl).href : careersUrl;
    roles.push({ title: text.slice(0, 150), location: '', url: fullUrl });
  });

  return roles;
}

// ── Route ─────────────────────────────────────────────────────────────────────

router.post('/:id/check-intern-roles', async (req, res) => {
  const jobId = parseInt(req.params.id, 10);
  if (isNaN(jobId)) return res.status(400).json({ error: 'Invalid id' });

  const job = await one('SELECT * FROM jobs WHERE id = $1 AND user_id = $2', [jobId, req.user.id]);
  if (!job) return res.status(404).json({ error: 'Company not found' });

  // 24-hour cache
  if (job.intern_roles_checked_at) {
    const ageMs = Date.now() - new Date(job.intern_roles_checked_at).getTime();
    if (ageMs < 24 * 60 * 60 * 1000) {
      const cached = job.intern_roles_json ? JSON.parse(job.intern_roles_json) : [];
      return res.json({
        companyId: jobId,
        careersUrl: job.url,
        internRoles: cached,
        totalFound: cached.length,
        source: job.intern_roles_source,
        cached: true,
        checkedAt: job.intern_roles_checked_at,
      });
    }
  }

  const careersUrl = job.url || '';
  let internRoles = [];
  let source = 'none';

  // Custom portal handlers for companies that don't use Greenhouse/Lever/Ashby.
  // Keyed by a token that matches the company name (case-insensitive).
  const customPortals = {
    apple: async () => {
      try {
        // Inline port of fetchAppleInternRoles — same logic, kept local to avoid
        // depending on jobs.js (which would introduce a circular import).
        return await fetchApplePortalRoles();
      } catch (err) {
        console.warn(`[InternRoles] Apple portal failed: ${err.message}`);
        return [];
      }
    },
  };

  const nameLower = (job.name || '').toLowerCase();
  const portalKey = Object.keys(customPortals).find(k => nameLower === k || nameLower.startsWith(k + ' ') || nameLower.split(/\s+/).includes(k));

  try {
    if (portalKey) {
      internRoles = await customPortals[portalKey]();
      if (internRoles.length > 0) source = portalKey;
    }
    if (internRoles.length > 0) {
      // We already have data from the portal handler.
    } else if (!careersUrl) {
      source = 'no_url';
    } else if (careersUrl.includes('greenhouse.io')) {
      const m = careersUrl.match(/greenhouse\.io\/([^/?#]+)/);
      if (m?.[1]) { internRoles = await fetchGreenhouseRoles(m[1]); source = 'greenhouse'; }
    } else if (careersUrl.includes('lever.co')) {
      const m = careersUrl.match(/lever\.co\/([^/?#]+)/);
      if (m?.[1]) { internRoles = await fetchLeverRoles(m[1]); source = 'lever'; }
    } else if (careersUrl.includes('ashbyhq.com')) {
      const m = careersUrl.match(/ashbyhq\.com\/([^/?#]+)/);
      if (m?.[1]) { internRoles = await fetchAshbyRoles(m[1]); source = 'ashby'; }
    } else {
      internRoles = await fetchHTMLRoles(careersUrl);
      source = 'html';
    }
  } catch (err) {
    console.warn(`[InternRoles] ${job.name}: ${err.message}`);
    source = 'error';
  }

  const checkedAt = new Date().toISOString();
  await run(`
    UPDATE jobs
    SET intern_roles_json=$1, intern_roles_checked_at=$2, intern_roles_source=$3, intern_roles_count=$4
    WHERE id=$5 AND user_id=$6
  `, [JSON.stringify(internRoles), checkedAt, source, internRoles.length, jobId, req.user.id]);

  res.json({
    companyId: jobId,
    careersUrl,
    internRoles,
    totalFound: internRoles.length,
    source,
    cached: false,
    checkedAt,
  });
});

export default router;
