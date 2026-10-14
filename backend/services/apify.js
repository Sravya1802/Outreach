import { ApifyClient } from 'apify-client';
import { isDomainPlausibleForCompany } from './companyDomain.js';
import { isRelevantContact, isUsableEmail, nameKey, seniorityScore } from './contactRules.js';
import { apolloOrganization, isConfigured, serperSearch as providerSerperSearch } from './emailProviders.js';
import { spend as spendProviderBudget } from './providerUsage.js';

// Token is read lazily so dotenv has time to load before first use
function getToken() { return process.env.APIFY_API_TOKEN || ''; }
function getClient() { return new ApifyClient({ token: getToken() }); }

// Log token presence once the event loop starts (after dotenv config runs)
setTimeout(() => {
  console.log(`[apify] token present: ${getToken().length > 10}`);
  console.log(`[serper] key present: ${(process.env.SERPER_API_KEY || '').length > 10}`);
}, 0);

// ── Quota-burn sentinel ─────────────────────────────────────────────────────
// Apify's /v2/users/me endpoint reports the *account's* platform credit balance,
// which is reliably 0/0 on FREE accounts even when the actor-side monthly limit
// has been blown. So creditChecker can't detect a burn from the Apify API
// alone. We track it here: every actor-failure path that throws with a
// quota-shaped message bumps a module-level timestamp + last error. The
// /api/credits/status route reads this via getApifyQuotaBurn() and flags
// `critical: true` when the burn was recent (last 6h). The sidebar Apify dot
// turns red within seconds of the next failed scrape — no polling needed.
const apifyQuotaBurn = { lastFailureAt: 0, lastError: null, lastActor: null };
const QUOTA_RE = /hard limit|monthly usage|quota|exhausted|insufficient.*credit|402|payment required/i;
export function noteApifyError(actor, err) {
  const msg = err?.message || String(err);
  if (QUOTA_RE.test(msg)) {
    apifyQuotaBurn.lastFailureAt = Date.now();
    apifyQuotaBurn.lastError     = msg.slice(0, 200);
    apifyQuotaBurn.lastActor     = actor || null;
  }
}
export function getApifyQuotaBurn() {
  if (!apifyQuotaBurn.lastFailureAt) return null;
  const ageMs = Date.now() - apifyQuotaBurn.lastFailureAt;
  return { ...apifyQuotaBurn, ageMs, recent: ageMs < 6 * 60 * 60 * 1000 };
}

// ── Serper.dev Google search (replaces Apify google-search-scraper) ──────────
// Returns { organic: [{ title, link, snippet }] }
async function serperSearch(query, num = 10) {
  const key = (process.env.SERPER_API_KEY || '').trim();
  if (!key || key === 'your_serper_key_here' || key.length < 10) {
    throw new Error('SERPER_API_KEY not configured');
  }
  const res = await fetch('https://google.serper.dev/search', {
    method:  'POST',
    headers: { 'X-API-KEY': key, 'Content-Type': 'application/json' },
    body:    JSON.stringify({ q: query, num }),
    signal:  AbortSignal.timeout(12000),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Serper HTTP ${res.status}: ${txt.slice(0, 200)}`);
  }
  return res.json();
}

// Run an Apify actor and await completion with full status logging.
// Short-circuits with a synthetic quota-error when the last Apify call hit
// "Monthly usage hard limit exceeded" within the past hour — otherwise the
// daily cron wastes minutes hammering every actor variant for every source
// (LinkedIn × 4, Wellfound × 4, Indeed × 2, ...) just to log the same error
// for each.
const QUOTA_SHORT_CIRCUIT_MS = 60 * 60 * 1000; // 1h cooldown
async function runActor(actorId, input, waitSecs = 120) {
  if (apifyQuotaBurn.lastFailureAt && Date.now() - apifyQuotaBurn.lastFailureAt < QUOTA_SHORT_CIRCUIT_MS) {
    const ageMin = Math.round((Date.now() - apifyQuotaBurn.lastFailureAt) / 60000);
    const err = new Error(`Apify quota exhausted (last failure ${ageMin}m ago: ${apifyQuotaBurn.lastError || 'monthly limit'}) — skipping ${actorId} for the next hour.`);
    err.code = 'APIFY_QUOTA_BURNED';
    throw err;
  }
  const client = getClient();
  console.log(`[apify] starting actor ${actorId}...`);
  try {
    const run = await client.actor(actorId).call(input, { waitSecs });
    console.log(`[apify] run ID: ${run.id} — status: ${run.status}`);
    if (run.status !== 'SUCCEEDED') {
      throw new Error(`Actor ${actorId} finished with status ${run.status}`);
    }
    const { items } = await client.dataset(run.defaultDatasetId).listItems();
    console.log(`[apify] dataset items: ${items.length}`);
    return items;
  } catch (err) {
    // Defense in depth: even if the caller forgets to call noteApifyError,
    // central runActor catches any quota-shaped error before re-throwing.
    noteApifyError(actorId, err);
    throw err;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Category label mappings — DB stores exact CATEGORY LABEL strings
// These must match the `label` field in OutreachHub's CATEGORIES constant
// ─────────────────────────────────────────────────────────────────────────────

const SIMPLIFY_CAT_MAP = {
  'Quant':                               'Quant / HFT',
  'Quantitative Finance':                'Quant / HFT',
  'AI/ML/Data':                          'AI Labs',
  'Data Science, AI & Machine Learning': 'AI Labs',
  'Hardware':                            'Startups',
  'Hardware Engineering':                'Startups',
  'Software':                            'Growth Tech',
  'Software Engineering':                'Growth Tech',
  'Product':                             'Growth Tech',
  'Product Management':                  'Growth Tech',
  'Other':                               'Growth Tech',
};

// ─────────────────────────────────────────────────────────────────────────────
// Source 1: SimplifyJobs GitHub (free, no Apify credits)
// ─────────────────────────────────────────────────────────────────────────────

export async function scrapeGitHubInternships() {
  try {
    const url = 'https://raw.githubusercontent.com/SimplifyJobs/Summer2026-Internships/dev/.github/scripts/listings.json';
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const listings = await res.json();
    const active = listings.filter(item => item.active === true && item.company_name);
    console.log(`[simplify] ${active.length} active listings`);

    return active.map(item => ({
      name:       item.company_name,
      role:       item.title || 'Software Engineering Intern',
      location:   Array.isArray(item.locations) ? item.locations.slice(0, 3).join(', ') : (item.location || ''),
      pay:        0,
      careersUrl: item.url || '',
      // category set to our label — subcategory stays null (generic scrape)
      category:   SIMPLIFY_CAT_MAP[item.category] || 'Growth Tech',
      subcategory: null,
      source:     'simplify',
    }));
  } catch (err) {
    console.error(`[simplify] failed: ${err.message}`);
    return [];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Source 2: SpeedyApply GitHub (free, markdown parse)
// ─────────────────────────────────────────────────────────────────────────────

export async function scrapeSpeedyApply() {
  try {
    const url = 'https://raw.githubusercontent.com/speedyapply/2026-SWE-College-Jobs/main/README.md';
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();

    const results = [];
    let currentCategory = 'Growth Tech';

    for (const line of text.split('\n')) {
      if (/###\s*FAANG/i.test(line))  { currentCategory = 'Big Tech';    continue; }
      if (/###\s*Quant/i.test(line))  { currentCategory = 'Quant / HFT'; continue; }
      if (/###\s*Other/i.test(line))  { currentCategory = 'Growth Tech';  continue; }

      if (!line.startsWith('|') || !line.includes('<strong>')) continue;
      const cols = line.split('|').map(c => c.trim());
      const companyMatch = cols[1]?.match(/<strong>(.*?)<\/strong>/);
      if (!companyMatch) continue;

      const applyMatch  = cols[5]?.match(/href="(https?:\/\/[^"]+)"/);
      const salaryMatch = cols[4]?.match(/\$(\d+)/);

      results.push({
        name:       companyMatch[1].trim(),
        role:       cols[2]?.replace(/<[^>]+>/g, '').trim() || 'Software Engineering Intern',
        location:   cols[3]?.replace(/<[^>]+>/g, '').trim() || 'USA',
        pay:        salaryMatch ? parseInt(salaryMatch[1]) : 0,
        careersUrl: applyMatch?.[1] || '',
        category:   currentCategory,
        subcategory: null,
        source:     'speedyapply',
      });
    }

    console.log(`[speedyapply] parsed ${results.length} listings`);
    return results;
  } catch (err) {
    console.error(`[speedyapply] failed: ${err.message}`);
    return [];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Source 3: LinkedIn Jobs — Apify (verbose logging + actor fallback)
// ─────────────────────────────────────────────────────────────────────────────

// LinkedIn Jobs actor configs — tried in order until one succeeds
// Each entry has { actorId, buildInput } so we can adapt to each actor's schema
const LINKEDIN_ACTOR_CONFIGS = [
  {
    // valig/linkedin-jobs-scraper — keyword search, no cookie needed
    actorId: 'valig/linkedin-jobs-scraper',
    buildInput: (query) => ({
      keyword:  query,
      location: 'United States',
      limit:    100,
    }),
  },
  {
    // bebity/linkedin-jobs-scraper — keyword + location
    actorId: 'bebity/linkedin-jobs-scraper',
    buildInput: (query) => ({
      keyword:  query,
      location: 'United States',
      limit:    100,
    }),
  },
  {
    // curious_coder — requires URLs, build a LinkedIn jobs search URL
    actorId: 'curious_coder/linkedin-jobs-scraper',
    buildInput: (query, cookie) => ({
      urls:      [`https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(query)}&location=United%20States`],
      maxJobs:   100,
      ...(cookie ? { cookie } : {}),
    }),
  },
];

export async function scrapeLinkedInJobs(subcategory = '', category = '') {
  // Role-agnostic by default — covers product, design, data, marketing, finance,
  // not just SWE. Subcategory still narrows when caller provides one.
  const query = [subcategory, 'Intern 2026'].filter(Boolean).join(' ');
  const cookie = process.env.LINKEDIN_SESSION_COOKIE || '';
  console.log(`[linkedin] starting — query: "${query}"`);

  let lastError = null;
  for (const { actorId, buildInput } of LINKEDIN_ACTOR_CONFIGS) {
    try {
      console.log(`[linkedin] trying actor: ${actorId}`);
      const client = getClient();
      const input  = buildInput(query, cookie.length > 20 ? cookie : null);
      const run    = await client.actor(actorId).call(input, { waitSecs: 120 });

      console.log(`[linkedin] run ID: ${run.id} — status: ${run.status}`);
      if (run.status !== 'SUCCEEDED') throw new Error(`Status: ${run.status}`);

      const { items } = await client.dataset(run.defaultDatasetId).listItems();
      console.log(`[linkedin] items: ${items.length} (actor: ${actorId})`);

      const results = items
        .filter(i => i.companyName || i.company || i.title)
        .map(i => ({
          name:        (i.companyName || i.company || i.title?.split(' at ')?.[1] || '').trim(),
          role:        i.jobTitle || i.title || 'SWE Intern',
          location:    i.location || i.jobLocation || 'USA',
          pay:         0,
          careersUrl:  i.url || i.applyUrl || i.link || '',
          category:    category || 'Growth Tech',
          subcategory: subcategory || null,
          source:      'linkedin',
        }))
        .filter(i => i.name && i.name.length > 1);

      console.log(`[linkedin] returning ${results.length} companies`);
      return results;

    } catch (err) {
      lastError = err;
      noteApifyError(actorId, err);
      console.error(`[linkedin] actor ${actorId} failed: ${err.message}`);
    }
  }

  console.error(`[linkedin] all actors failed — last: ${lastError?.message}. Falling back to Greenhouse direct scan.`);

  // Fallback: scan top tech companies directly on Greenhouse for intern roles
  const GREENHOUSE_FALLBACK = [
    'stripe','airbnb','coinbase','plaid','brex','ramp','notion','anthropic','openai',
    'scale','databricks','cloudflare','datadog','palantir','anduril','gusto','rippling',
    'lattice','figma','robinhood','airtable','asana','hubspot','intercom','segment',
    'retool','vercel','linear','resend','supabase','posthog','clerk','mercury',
  ];
  const INTERN_RE = /\binterns?\b|\binternships?\b|\bco-op\b|\bnew.?grad\b|\bentry.?level\b/i;
  const results = [];
  await Promise.allSettled(GREENHOUSE_FALLBACK.map(async (slug) => {
    try {
      const r = await fetch(`https://boards-api.greenhouse.io/v1/boards/${slug}/jobs?content=false`, { signal: AbortSignal.timeout(5000) });
      if (!r.ok) return;
      const d = await r.json();
      for (const j of (d.jobs || [])) {
        if (!INTERN_RE.test(j.title || '')) continue;
        const loc = j.location?.name || '';
        if (/canada|uk|united kingdom|hong kong|warsaw|toronto|london|berlin|paris|amsterdam|sydney/i.test(loc)) continue;
        results.push({
          name:        slug.charAt(0).toUpperCase() + slug.slice(1),
          role:        j.title,
          location:    loc || 'USA',
          pay:         0,
          careersUrl:  j.absolute_url || `https://boards.greenhouse.io/${slug}`,
          category:    category || 'Tech & Software',
          subcategory: subcategory || null,
          source:      'linkedin',
        });
      }
    } catch (_) {}
  }));
  console.log(`[linkedin] Greenhouse fallback returned ${results.length} roles`);
  return results;
}

// ─────────────────────────────────────────────────────────────────────────────
// Source 4: Google Jobs — Apify
// ─────────────────────────────────────────────────────────────────────────────

export async function scrapeGoogleJobs(subcategory = '', category = '') {
  const query = subcategory
    ? `${subcategory} Internship 2026 United States`
    : 'Internship 2026 site:jobs.lever.co OR site:greenhouse.io OR site:myworkdayjobs.com';

  try {
    console.log(`[google_jobs] Serper search: "${query}"`);
    const data = await serperSearch(query, 10);
    const organic = data.organic || [];
    console.log(`[google_jobs] ${organic.length} results`);

    return organic
      .filter(i => i.title && i.link)
      .map(i => {
        const domain = i.link.replace(/^https?:\/\/(www\.)?/, '').split('/')[0];
        const company = domain.split('.')[0] || i.title.split(/[-–|]/)[0].trim();
        return {
          name:        company.trim(),
          role:        i.title || 'SWE Intern',
          location:    'USA',
          pay:         0,
          careersUrl:  i.link || '',
          category:    category || 'Growth Tech',
          subcategory: subcategory || null,
          source:      'google_jobs',
        };
      })
      .filter(i => i.name && i.name.length > 1);
  } catch (err) {
    console.error(`[google_jobs] failed: ${err.message}`);
    return [];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Source 5: Wellfound — Apify with multiple actor fallbacks + Serper
// ─────────────────────────────────────────────────────────────────────────────

export async function scrapeWellfound(roleQuery = 'intern 2026', subcategory = '', category = '') {
  const role = subcategory ? `${subcategory} intern 2026` : roleQuery;

  // Try multiple known actors in order
  const ACTORS = [
    { id: 'curious_coder/wellfound-scraper',  input: { role, location: 'United States', maxJobs: 100 } },
    { id: 'clearpath/wellfound-api-ppe',       input: { role: 'Intern', location: 'United States', maxJobs: 50 } },
    { id: 'apify/rag-web-browser',             input: { startUrls: [{ url: 'https://wellfound.com/role/r/software-engineer-intern' }], maxCrawlDepth: 0, maxCrawlPages: 1, outputFormats: ['text'] } },
  ];

  for (const { id, input } of ACTORS) {
    try {
      const items = await runActor(id, input, 90);
      if (!items || items.length === 0) continue;
      console.log(`[wellfound] ${items.length} items from ${id}`);

      // rag-web-browser returns { text, markdown } — parse company names from text
      if (id.includes('rag-web-browser')) {
        const text = items[0]?.text || items[0]?.markdown || '';
        const seen = new Set();
        const results = [];
        // Extract company names from "Company Name - Role" patterns
        const lines = text.split('\n').filter(l => l.length > 3);
        for (const line of lines) {
          const m = line.match(/^([A-Z][A-Za-z0-9& ,.]+?)\s+[-–]\s+(Software|Engineer|Intern|Developer|Frontend|Backend|Full)/);
          if (m) {
            const name = m[1].trim();
            if (!seen.has(name.toLowerCase())) {
              seen.add(name.toLowerCase());
              results.push({ name, role: 'Software Engineering Intern', location: 'USA', pay: 0, careersUrl: 'https://wellfound.com/role/r/software-engineer-intern', category: category || 'Startups', subcategory: subcategory || null, source: 'wellfound' });
            }
          }
        }
        if (results.length > 0) return results;
        continue;
      }

      return items
        .filter(i => i.companyName || i.company)
        .map(i => ({
          name:        (i.companyName || i.company || '').trim(),
          role:        i.title || i.role || 'SWE Intern',
          location:    i.location || 'USA',
          pay:         0,
          careersUrl:  i.url || i.applyUrl || '',
          category:    category || 'Startups',
          subcategory: subcategory || null,
          source:      'wellfound',
        }));
    } catch (err) {
      noteApifyError(id, err);
      console.error(`[wellfound] ${id} failed: ${err.message}`);
    }
  }

  // Final fallback: Serper search for Wellfound intern jobs
  try {
    console.log('[wellfound] trying Serper fallback');
    const q = subcategory
      ? `site:wellfound.com ${subcategory} intern 2026`
      : 'site:wellfound.com/companies intern 2026';
    const data = await serperSearch(q, 10);
    const organic = data.organic || [];
    return organic
      .filter(i => i.link && i.title)
      .map(i => ({
        name:        (i.title || '').split(/[-–|]/)[0].trim(),
        role:        i.title || 'SWE Intern',
        location:    'USA',
        pay:         0,
        careersUrl:  i.link,
        category:    category || 'Startups',
        subcategory: subcategory || null,
        source:      'wellfound',
      }))
      .filter(i => i.name && i.name.length > 2);
  } catch (err) {
    console.error(`[wellfound] Serper fallback failed: ${err.message}`);
    return [];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Source 7: YC Work at a Startup — Serper + direct fetch fallback
// ─────────────────────────────────────────────────────────────────────────────

export async function scrapeYCStartups(subcategory = '', category = '') {
  const results = [];
  const seen    = new Set();

  function add(name, role, location, url) {
    const key = name.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!key || key.length < 2 || seen.has(key)) return;
    seen.add(key);
    results.push({
      name,
      role:        role || 'Software Engineering Intern',
      location:    location || 'USA',
      pay:         0,
      careersUrl:  url || '',
      category:    category || 'Startups',
      subcategory: subcategory || null,
      source:      'yc',
    });
  }

  // Layer 1: Serper search on WorkAtAStartup
  try {
    const q = subcategory
      ? `site:workatastartup.com "${subcategory}" intern 2026`
      : 'site:workatastartup.com intern 2026';
    console.log(`[yc] Serper: "${q}"`);
    const data = await serperSearch(q, 10);
    for (const item of (data.organic || [])) {
      const link = item.link || '';
      const match = link.match(/workatastartup\.com\/companies\/([^/?#]+)/);
      if (match) {
        const slug = match[1];
        const name = slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        add(name, item.title?.split(/[-–|]/)[0].trim(), 'San Francisco, CA', link);
      }
    }
    console.log(`[yc] Serper returned ${results.length} companies`);
  } catch (err) {
    console.error(`[yc] Serper failed: ${err.message}`);
  }

  // Layer 2: Direct fetch of WorkAtAStartup JSON endpoint
  if (results.length < 5) {
    try {
      const url = 'https://www.workatastartup.com/companies?companySize=1-10&companySize=11-50&demographic=Intern&role=eng&jobType=intern';
      const res = await fetch(url, {
        headers: {
          'User-Agent':  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
          'Accept':      'application/json, text/html',
          'X-Requested-With': 'XMLHttpRequest',
        },
        signal: AbortSignal.timeout(12000),
      });
      if (res.ok) {
        const data = await res.json().catch(() => null);
        if (data?.companies && Array.isArray(data.companies)) {
          console.log(`[yc] direct fetch returned ${data.companies.length} companies`);
          for (const c of data.companies.slice(0, 100)) {
            add(c.name || c.slug?.replace(/-/g, ' '), 'Software Engineering Intern', c.locations?.[0] || 'San Francisco, CA', `https://www.workatastartup.com/companies/${c.slug || ''}`);
          }
        }
      }
    } catch (err) {
      console.log(`[yc] direct fetch failed (expected for SPA): ${err.message}`);
    }
  }

  // Layer 3: Serper search on YC company directory
  if (results.length < 5) {
    try {
      const q2 = subcategory
        ? `YC startup "${subcategory}" hiring intern 2026 site:ycombinator.com`
        : 'YC startup hiring intern 2026 site:ycombinator.com/companies';
      const data2 = await serperSearch(q2, 10);
      for (const item of (data2.organic || [])) {
        const link = item.link || '';
        const match = link.match(/ycombinator\.com\/companies\/([^/?#]+)/);
        if (match) {
          const slug = match[1];
          const name = slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
          add(name, 'Software Engineering Intern', 'San Francisco, CA', link);
        }
      }
      console.log(`[yc] after YC directory search: ${results.length} total`);
    } catch (err) {
      console.error(`[yc] YC directory Serper failed: ${err.message}`);
    }
  }

  console.log(`[yc] final: ${results.length} companies`);
  return results;
}

// ─────────────────────────────────────────────────────────────────────────────
// Source 6: Jobright.ai — direct fetch (no Apify actor available)
// ─────────────────────────────────────────────────────────────────────────────

export async function scrapeJobright(subcategory = '', category = '') {
  try {
    const res = await fetch('https://jobright.ai/jobs/internships', {
      headers: {
        'User-Agent':      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();

    const seen = new Set();
    const results = [];
    const patterns = [
      /"company_name"\s*:\s*"([^"]+)"/g,
      /"companyName"\s*:\s*"([^"]+)"/g,
      /"company"\s*:\s*"([^"]+)"/g,
    ];
    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(html)) !== null) {
        const name = match[1].trim();
        if (name && name.length > 1 && !seen.has(name.toLowerCase())) {
          seen.add(name.toLowerCase());
          results.push({
            name,
            role:       'Software Engineering Intern',
            location:   'USA',
            pay:        0,
            careersUrl: 'https://jobright.ai/jobs/internships',
            category:   category || 'Growth Tech',
            subcategory: subcategory || null,
            source:     'jobright',
          });
        }
      }
    }

    if (results.length === 0) {
      console.log('[jobright] no structured data found (SPA) — skipping');
      return [];
    }
    console.log(`[jobright] ${results.length} companies from page`);
    return results;
  } catch (err) {
    console.log(`[jobright] unavailable — skipping: ${err.message}`);
    return [];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// People finders — used by contact panel (unchanged logic)
// ─────────────────────────────────────────────────────────────────────────────

export async function findLinkedInDecisionMakers(companyName, companyStage) {
  try {
    const isStartup = companyStage === 'startup' || companyStage === 'YC';
    const titleQuery = isStartup
      ? '"founder" OR "co-founder" OR "CTO" OR "CEO" OR "Head of Engineering"'
      : '"VP Engineering" OR "Director of Engineering" OR "Head of Engineering" OR "Engineering Manager"';

    const searchQuery = `site:linkedin.com/in "${companyName}" (${titleQuery})`;
    console.log(`[people] findLinkedInDecisionMakers Serper: "${searchQuery}"`);

    const data = await serperSearch(searchQuery, 10);
    const organic = data.organic || [];
    const NON_US = /\b(germany|deutschland|uk|united kingdom|france|india|canada|australia|netherlands|sweden|norway|denmark|finland|switzerland|austria|belgium|spain|italy|portugal|brazil|singapore|japan|china|korea|israel|poland|czech|romania|ukraine|russia|mexico)\b/i;

    return organic
      .filter(item => (item.link || '').includes('linkedin.com/in'))
      .filter(item => !NON_US.test((item.snippet || '').toLowerCase()))
      .map(item => {
        const titleText = item.title || '';
        const name = titleText.split(/[-–|·]/)[0].trim().replace(/\s*linkedin\s*/i, '').trim();
        const titleMatch = titleText.match(/(founder|co-founder|cto|ceo|vp|director|head of|manager)[^-|·]*/i);
        return { name, title: titleMatch?.[0]?.trim() || '', linkedin_url: item.link, company: companyName };
      })
      .filter(p => p.name && p.name.length > 2 && p.name.toLowerCase() !== 'linkedin');
  } catch (err) {
    console.error('[people] findLinkedInDecisionMakers failed:', err.message);
    return [];
  }
}

/**
 * Parse a Google result for a LinkedIn profile ("Jane Doe - Staff Engineer at
 * Acme | LinkedIn") into { name, title } — or null unless it plausibly says
 * the person is at `companyName` (the old parser kept ex-employees and
 * people at similarly named companies).
 */
export function parseLinkedInSerpResult(item, companyName) {
  const link = item?.link || '';
  if (!/linkedin\.com\/in\//i.test(link)) return null;
  const title = String(item.title || '').replace(/\s*\|\s*LinkedIn.*$/i, '').trim();
  const [namePart, ...rest] = title.split(/\s+[-–—]\s+/);
  const name = (namePart || '').replace(/[,(].*$/, '').trim();
  if (!name || name.length < 3 || /linkedin/i.test(name) || name.split(/\s+/).length > 5) return null;
  const roleText = rest.join(' - ');
  const hay = `${roleText} ${item.snippet || ''}`.toLowerCase();
  const company = String(companyName || '').toLowerCase().replace(/\b(inc|llc|ltd|corp)\b\.?/g, '').trim();
  if (!company || !hay.includes(company)) return null;
  if (/\b(former|formerly|ex-|previously|past)\b[^.]{0,40}/i.test(hay) && !roleText.toLowerCase().includes(company)) return null;
  const role = roleText.replace(new RegExp(`\\s*(?:at|@)\\s+${company.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}.*$`, 'i'), '').trim();
  return { name, title: role, linkedin_url: link.split('?')[0] };
}

/**
 * Find people worth contacting at a company:
 *   L1 Apollo  — organization (by trusted domain, else by name with a
 *                plausibility check) → people search
 *   L2 Apify   — LinkedIn company people actors (quota-aware via runActor)
 *   L3 Google  — LinkedIn profiles that name the company in their headline
 * Later layers only run while fewer than 3 people were found, and nothing
 * runs after the caller aborts (client closed the stream).
 *
 * @param {string}   companyName
 * @param {string}   linkedinCompanyUrl  optional; improves the LinkedIn slug
 * @param {string}   domain              trusted company domain, or null
 * @param {Function} onProgress          ({ source, status, count, message })
 * @param {{signal?: AbortSignal}} [opts]
 */
export async function findPeopleAtLinkedInCompany(companyName, linkedinCompanyUrl = null, domain = null, onProgress = null, { signal, userId = null } = {}) {
  const NON_US = /\b(germany|deutschland|united kingdom|france|india|canada|australia|netherlands|sweden|norway|denmark|finland|switzerland|austria|belgium|spain|italy|portugal|brazil|singapore|japan|china|korea|israel|poland|czech|romania|ukraine|russia|mexico)\b/i;
  const people = [];
  const seenNames = new Set();
  const seenLinks = new Set();
  const aborted = () => Boolean(signal?.aborted);

  function notify(source, status, count = 0, message = null) {
    console.log(`[people/${source}] ${status}${count > 0 ? ` count=${count}` : ''}${message ? ` — ${message}` : ''}`);
    if (onProgress) onProgress({ source, status, count, ...(message ? { message: `${source}: ${message}` } : {}) });
  }
  function addPeople(list, source) {
    let added = 0;
    for (const p of list) {
      const key = nameKey(p.name);
      const link = (p.linkedin_url || '').toLowerCase().replace(/\/$/, '');
      if (!key || key.length < 4 || seenNames.has(key) || (link && seenLinks.has(link))) continue;
      if (!isRelevantContact(p.title)) continue;
      seenNames.add(key);
      if (link) seenLinks.add(link);
      people.push({ ...p, source });
      added++;
    }
    return added;
  }

  // ── L1 Apollo ──────────────────────────────────────────────────────────────
  if (!isConfigured('apollo')) {
    notify('apollo', 'skip', 0, 'not configured');
  } else if (!aborted()) {
    notify('apollo', 'running');
    try {
      await spendProviderBudget(userId, 'apollo');
      let org = await apolloOrganization(domain ? { domain } : { name: companyName });
      if (org && !domain && org.domain && !isDomainPlausibleForCompany(org.domain, companyName)) {
        notify('apollo', 'done', 0, `closest match was ${org.name} (${org.domain}) — not this company`);
        org = null;
      }
      if (!org) {
        if (domain) notify('apollo', 'done', 0, `no organization found for ${domain}`);
      } else {
        const raw = [];
        for (let page = 1; page <= 3 && !aborted(); page++) {
          const res = await fetch('https://api.apollo.io/v1/mixed_people/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Api-Key': process.env.APOLLO_API_KEY },
            body: JSON.stringify({ organization_ids: [org.id], person_seniorities: ['founder', 'c_suite', 'vp', 'head', 'director', 'manager', 'senior', 'entry'], page, per_page: 25 }),
            signal: AbortSignal.timeout(15000),
          });
          if (!res.ok) throw new Error(`Apollo people search HTTP ${res.status}`);
          const data = await res.json();
          const batch = Array.isArray(data.people) ? data.people : [];
          raw.push(...batch);
          if (batch.length < 25) break;
        }
        const n = addPeople(raw.map(p => ({
          name: (p.name || `${p.first_name || ''} ${p.last_name || ''}`).trim(),
          title: p.title || '',
          linkedin_url: p.linkedin_url || null,
          email: isUsableEmail(p.email) ? p.email : null,
        })), 'apollo');
        notify('apollo', 'done', n, n === 0 && raw.length ? `${raw.length} people, none in engineering/recruiting` : null);
      }
    } catch (err) {
      notify('apollo', 'error', 0, err.message);
    }
  }

  // ── L2 LinkedIn actors (Apify) ─────────────────────────────────────────────
  if (people.length < 3 && !aborted()) {
    const cookie = (process.env.LINKEDIN_SESSION_COOKIE || '').trim();
    const slug = (linkedinCompanyUrl || '').match(/linkedin\.com\/company\/([^/?#]+)/)?.[1]
      || companyName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const auth = cookie.length > 20 ? { cookie, sessionCookie: cookie, li_at: cookie } : {};
    const actors = [
      ['powerai/linkedin-company-people-scraper', { url: `https://www.linkedin.com/company/${slug}/people/`, maxResults: 25, ...auth }],
      ['george.the.developer/linkedin-company-employees-scraper', { companyUrl: `https://www.linkedin.com/company/${slug}`, maxResults: 25, ...auth }],
    ];
    notify('linkedin', 'running', 0, `company page /${slug}`);
    let n = 0;
    let lastError = null;
    for (const [actorId, input] of actors) {
      if (n > 0 || aborted()) break;
      try {
        const items = await runActor(actorId, input, 90);
        n = addPeople(items.map(p => ({
          name: String(p.fullName || p.name || '').trim(),
          title: String(p.headline || p.title || p.jobTitle || '').trim(),
          linkedin_url: p.profileUrl || p.url || p.linkedin_url || null,
        })), 'linkedin');
      } catch (err) {
        lastError = err;
        if (err.code === 'APIFY_QUOTA_BURNED') break; // same answer for every actor
      }
    }
    notify('linkedin', lastError && n === 0 ? 'error' : 'done', n,
      n === 0 ? (lastError ? lastError.message.slice(0, 160) : (auth.cookie ? 'no results' : 'no LinkedIn session cookie set')) : null);
  } else if (!aborted()) {
    notify('linkedin', 'skip', 0, 'enough people already');
  }

  // ── L3 Google (Serper) ─────────────────────────────────────────────────────
  if (people.length < 3 && !aborted()) {
    if (!isConfigured('serper')) {
      notify('google', 'skip', 0, 'not configured');
    } else {
      notify('google', 'running');
      const queries = [
        `site:linkedin.com/in "${companyName}" "software engineer"`,
        `site:linkedin.com/in "${companyName}" CTO OR "VP Engineering" OR "Head of Engineering" OR founder`,
        `site:linkedin.com/in "${companyName}" recruiter OR "talent acquisition" OR "university recruiting"`,
        `site:linkedin.com/in "${companyName}" "engineering manager" OR "staff engineer" OR "machine learning"`,
      ];
      const found = [];
      const errors = [];
      for (const q of queries) {
        if (found.length >= 15 || aborted()) break;
        try {
          await spendProviderBudget(userId, 'serper');
          const data = await providerSerperSearch(q, 10);
          for (const item of data.organic || []) {
            if (NON_US.test(item.snippet || '')) continue;
            const p = parseLinkedInSerpResult(item, companyName);
            if (p) found.push(p);
          }
        } catch (err) {
          errors.push(err.message);
          if (['QUOTA', 'AUTH', 'SKIPPED', 'BUDGET'].includes(err.code)) break;
        }
      }
      const n = addPeople(found, 'google');
      notify('google', errors.length && n === 0 ? 'error' : 'done', n, n === 0 ? (errors[0] || `no LinkedIn profiles mention ${companyName}`) : null);
    }
  }

  people.sort((a, b) => seniorityScore(b.title) - seniorityScore(a.title));
  console.log(`[people] final: ${people.length} contacts (sources: ${[...new Set(people.map(p => p.source))].join(', ') || 'none'})`);
  return people;
}

export async function scrapeLinkedInProfile(linkedinUrl) {
  try {
    const cookie = process.env.LINKEDIN_SESSION_COOKIE;
    if (!cookie || cookie.length < 20) return null;
    const items = await runActor('curious_coder/linkedin-profile-scraper', { profileUrls: [linkedinUrl], cookie });
    if (!items.length) return null;
    const p = items[0];
    return { name: p.fullName || p.name || '', title: p.headline || p.title || '', linkedin_url: linkedinUrl, summary: p.summary || '', company: p.currentCompany || p.company || '' };
  } catch (err) {
    noteApifyError('curious_coder/linkedin-profile-scraper', err);
    console.error('[profile] scrape failed:', err.message);
    return null;
  }
}
