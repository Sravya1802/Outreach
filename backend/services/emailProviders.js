// ── Email / people provider clients ──────────────────────────────────────────
// Thin, typed wrappers over Hunter, Prospeo, Apollo, Serper and the company's
// own website. Every call has a timeout, goes through providerGuard (typed
// errors + quota cooldown), and returns candidates in one shape:
//   { email, name, title, linkedin_url, status, confidence, source }
// Status uses contactRules.normalizeEmailStatus — nothing is labelled
// "valid" unless the provider verified it.
import axios from 'axios';
import { guarded, ProviderError, errorFromHttp } from './providerGuard.js';
import { isUsableEmail, normalizeEmailStatus } from './contactRules.js';
import { normalizeHost } from './companyDomain.js';
import { safeFetch } from './safeFetch.js';

const TIMEOUT_MS = 12_000;
const http = axios.create({ timeout: TIMEOUT_MS });

function key(envName, provider) {
  const k = (process.env[envName] || '').trim();
  if (!k || k.length < 10 || /^your_|placeholder|optional_fallback/i.test(k)) {
    throw new ProviderError(provider, 'CONFIG', `${provider} isn't configured on the server`);
  }
  return k;
}

export function isConfigured(provider) {
  const env = { hunter: 'HUNTER_API_KEY', prospeo: 'PROSPEO_API_KEY', apollo: 'APOLLO_API_KEY', serper: 'SERPER_API_KEY' }[provider];
  try { key(env, provider); return true; } catch { return false; }
}

function candidate(source, { email, first = '', last = '', name = '', title = '', linkedin = '', raw = {} }) {
  const e = String(email || '').trim().toLowerCase();
  if (!isUsableEmail(e)) return null;
  return {
    email: e,
    name: (name || `${first || ''} ${last || ''}`).trim() || null,
    title: String(title || '').trim(),
    linkedin_url: String(linkedin || '').trim() || null,
    status: normalizeEmailStatus(source, raw),
    confidence: Number.isFinite(Number(raw.score ?? raw.confidence)) ? Number(raw.score ?? raw.confidence) : null,
    source,
  };
}

async function fetchJson(provider, url, init = {}) {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  const text = await res.text();
  if (!res.ok) throw errorFromHttp(provider, res.status, text);
  try { return JSON.parse(text); } catch { throw new ProviderError(provider, 'HTTP', `${provider} returned non-JSON`); }
}

// ── Hunter ───────────────────────────────────────────────────────────────────

/** Domain search → { emails, pattern, organization }. One Hunter credit when it returns results. */
export function hunterDomainSearch(domain, { limit = 10 } = {}) {
  return guarded('hunter', async () => {
    const res = await http.get('https://api.hunter.io/v2/domain-search', {
      params: { domain, limit, type: 'personal', api_key: key('HUNTER_API_KEY', 'hunter') },
    });
    const d = res.data?.data || {};
    const emails = (d.emails || [])
      .map(e => candidate('hunter', {
        email: e.value, first: e.first_name, last: e.last_name, title: e.position, linkedin: e.linkedin,
        raw: { status: e.verification?.status, score: e.confidence },
      }))
      .filter(Boolean);
    return { emails, pattern: d.pattern || null, organization: d.organization || null };
  });
}

/** Email finder for one person. Returns a candidate or null (not found). */
export function hunterEmailFinder(domain, first, last) {
  return guarded('hunter', async () => {
    const res = await http.get('https://api.hunter.io/v2/email-finder', {
      params: { domain, first_name: first, last_name: last, api_key: key('HUNTER_API_KEY', 'hunter') },
      validateStatus: s => s < 500,
    });
    if (res.status === 404 || res.status === 400) return null;
    if (res.status >= 400) throw errorFromHttp('hunter', res.status, JSON.stringify(res.data));
    const d = res.data?.data || {};
    return candidate('hunter', { email: d.email, first, last, title: d.position, linkedin: d.linkedin_url, raw: { status: d.verification?.status, score: d.score } });
  });
}

// ── Prospeo ──────────────────────────────────────────────────────────────────

export function prospeoEmailFinder(first, last, domain) {
  return guarded('prospeo', async () => {
    const data = await fetchJson('prospeo', 'https://api.prospeo.io/email-finder', {
      method: 'POST',
      headers: { 'X-KEY': key('PROSPEO_API_KEY', 'prospeo'), 'Content-Type': 'application/json' },
      body: JSON.stringify({ first_name: first, last_name: last, company: domain }),
    });
    if (data?.error) {
      if (/NO_RESULT|not found/i.test(String(data.message || data.error))) return null;
      throw errorFromHttp('prospeo', 400, JSON.stringify(data));
    }
    const r = data?.response || {};
    const email = typeof r.email === 'string' ? r.email : r.email?.email;
    const status = typeof r.email === 'object' ? r.email?.email_status : r.email_status;
    return candidate('prospeo', { email, first, last, raw: { status } });
  });
}

export function prospeoDomainSearch(domain, { limit = 20 } = {}) {
  return guarded('prospeo', async () => {
    const data = await fetchJson('prospeo', 'https://api.prospeo.io/domain-search', {
      method: 'POST',
      headers: { 'X-KEY': key('PROSPEO_API_KEY', 'prospeo'), 'Content-Type': 'application/json' },
      body: JSON.stringify({ company: domain, limit }),
    });
    const list = Array.isArray(data?.response?.email_list) ? data.response.email_list
      : Array.isArray(data?.response) ? data.response : [];
    return list
      .map(e => candidate('prospeo', {
        email: e.email, first: e.first_name, last: e.last_name, title: e.position || e.title, linkedin: e.linkedin,
        raw: { status: e.email_status || e.verification },
      }))
      .filter(Boolean);
  });
}

// ── Apollo ───────────────────────────────────────────────────────────────────

function apolloHeaders() {
  return { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache', 'X-Api-Key': key('APOLLO_API_KEY', 'apollo') };
}

/** People match by LinkedIn URL (preferred) or name + domain. */
export function apolloMatch({ linkedinUrl = null, first = null, last = null, domain = null }) {
  return guarded('apollo', async () => {
    const body = linkedinUrl ? { linkedin_url: linkedinUrl } : { first_name: first, last_name: last, domain };
    const res = await http.post('https://api.apollo.io/v1/people/match', { ...body, reveal_personal_emails: false }, { headers: apolloHeaders() });
    const p = res.data?.person;
    if (!p?.email) return null;
    return candidate('apollo', {
      email: p.email, name: p.name, title: p.title, linkedin: p.linkedin_url || linkedinUrl,
      raw: { status: p.email_status },
    });
  });
}

/** Apollo organization lookup → { id, domain, name } or null. */
export function apolloOrganization({ domain = null, name = null }) {
  return guarded('apollo', async () => {
    if (domain) {
      const res = await http.get('https://api.apollo.io/v1/organizations/enrich', { params: { domain }, headers: apolloHeaders(), validateStatus: s => s < 500 });
      if (res.status === 404) return null;
      if (res.status >= 400) throw errorFromHttp('apollo', res.status, JSON.stringify(res.data));
      const o = res.data?.organization;
      return o?.id ? { id: o.id, domain: o.primary_domain || domain, name: o.name } : null;
    }
    const res = await http.post('https://api.apollo.io/v1/organizations/search', { q_organization_name: name, per_page: 1 }, { headers: apolloHeaders() });
    const o = res.data?.organizations?.[0];
    return o?.id ? { id: o.id, domain: o.primary_domain || null, name: o.name } : null;
  });
}

// ── Serper (Google) ──────────────────────────────────────────────────────────

export function serperSearch(q, num = 10) {
  return guarded('serper', () => fetchJson('serper', 'https://google.serper.dev/search', {
    method: 'POST',
    headers: { 'X-API-KEY': key('SERPER_API_KEY', 'serper'), 'Content-Type': 'application/json' },
    body: JSON.stringify({ q, num }),
  }));
}

function emailRegexFor(domain) {
  const d = domain.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Trailing boundary: "jane@acme.co" must not match inside "jane@acme.com".
  return new RegExp(`[a-z0-9._%+'-]+@${d}(?![a-z0-9.-]*[a-z0-9])`, 'gi');
}

/** Emails at @domain mentioned in Google results. */
export async function serperEmails(domain) {
  const re = emailRegexFor(domain);
  const found = new Map();
  for (const q of [`"@${domain}" engineer OR developer OR recruiter OR founder`, `site:${domain} email`]) {
    const data = await serperSearch(q, 10);
    for (const item of [...(data.organic || []), ...(data.knowledgeGraph ? [data.knowledgeGraph] : [])]) {
      const text = `${item.title || ''} ${item.snippet || ''} ${item.description || ''}`;
      for (const m of text.match(re) || []) {
        const c = candidate('serper', { email: m, raw: {} });
        if (c && !found.has(c.email)) found.set(c.email, c);
      }
    }
  }
  return [...found.values()];
}

// ── Company website ──────────────────────────────────────────────────────────

const STAFF_PATHS = ['/team', '/about', '/about-us', '/people', '/contact', '/leadership'];

/** Emails at @domain published on the company's own team/about pages. Free. */
export async function websiteEmails(domain) {
  const host = normalizeHost(domain);
  if (!host) return [];
  const re = emailRegexFor(host);
  const pages = await Promise.allSettled(STAFF_PATHS.map(async (p) => {
    const { res, text } = await safeFetch(`https://${host}${p}`, {
      timeoutMs: 8000, maxBytes: 2 * 1024 * 1024,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Scout’n’Jobs/1.0)', Accept: 'text/html' },
    });
    return res.ok ? text() : '';
  }));
  const found = new Map();
  for (const page of pages) {
    if (page.status !== 'fulfilled' || !page.value) continue;
    for (const m of page.value.match(re) || []) {
      const c = candidate('website', { email: m, raw: {} });
      if (c && !found.has(c.email)) found.set(c.email, c);
    }
  }
  return [...found.values()];
}
