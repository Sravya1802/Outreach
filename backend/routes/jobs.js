import { Router } from 'express';
import { one, all, run, tx } from '../db.js';
import * as apify from '../services/apify.js';
import { normalizeHost, resolveCompanyDomain } from '../services/companyDomain.js';
import { seniorityScore } from '../services/contactRules.js';
import { findCompanyEmails, findPersonEmail, upsertContact } from '../services/contactFinder.js';
import { generateOutreach } from '../services/ai.js';
import { loadSenderProfile } from '../services/senderProfile.js';
import { loadUserTemplates } from '../services/outreachTemplates.js';
import { scrapeAllSources, scraperHealth } from '../services/scraper.js';
import { classifyCompanies } from '../services/categorize.js';
import { safeFetch } from '../services/safeFetch.js';

function getDomain(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

const router = Router();

// ── Scrape companies from all 6 sources in parallel ──────────────────────────

router.post('/scrape', async (req, res) => {
  const { category = '', subcategory = '', source = '' } = req.body || {};
  // category/subcategory are ONLY for search query construction — never written to DB directly.
  console.log(`[scrape] starting — context: category="${category}" subcategory="${subcategory}" source="${source}"`);

  // ── Run all sources ──────────────────────────────────────────────────────
  const { results: rawResults, bySource, errors: scrapeErrors } =
    await scrapeAllSources(subcategory, category, source);

  const succeeded = Object.values(bySource).filter(n => n > 0).length;
  const failedSrc = Object.keys(scrapeErrors).length;

  // ── Check which companies are already classified in DB ───────────────────
  const nameList = rawResults.map(r => r.name);
  let existingMap = new Map();
  if (nameList.length > 0) {
    const placeholders = nameList.map((_, i) => `$${i + 1}`).join(',');
    const userIdx = nameList.length + 1;
    const rows = await all(`
      SELECT name, category, subcategory, confidence, classified_at
      FROM jobs
      WHERE user_id = $${userIdx}
        AND name IN (${placeholders})
        AND confidence >= 0.40
        AND category IS NOT NULL AND category != 'Unclassified'
        AND classified_at IS NOT NULL
    `, [...nameList, req.user.id]);
    existingMap = new Map(rows.map(r => [r.name.toLowerCase(), r]));
  }

  // ── Classify only companies that need it ────────────────────────────────
  const toClassify = rawResults.filter(r => !existingMap.has(r.name.toLowerCase()));
  console.log(`[scrape] classifying ${toClassify.length} new companies (${existingMap.size} reusing cached classification)`);

  const classifiedMap = await classifyCompanies(toClassify, { category, subcategory });

  // ── Insert / update DB ───────────────────────────────────────────────────
  const insertSql = `
    INSERT INTO jobs
      (name, category, subcategory, confidence, classified_at, wikipedia_summary,
       roles, location, city, state, country, url, tag, domain, is_hiring, source, user_id)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, 1, $15, $16)
    ON CONFLICT (user_id, name) DO NOTHING
  `;

  // Duplicate update: upgrade classification only if existing row is unclassified/low confidence
  const updateSql = `
    UPDATE jobs SET
      source = CASE
        WHEN source IS NULL OR source = '' THEN $1
        WHEN source NOT LIKE '%' || $2 || '%' THEN source || ',' || $3
        ELSE source
      END,
      category        = CASE WHEN (confidence IS NULL OR confidence < 0.40 OR category IS NULL OR category = 'Unclassified') THEN $4 ELSE category END,
      subcategory     = CASE WHEN (confidence IS NULL OR confidence < 0.40 OR category IS NULL OR category = 'Unclassified') THEN $5 ELSE subcategory END,
      confidence      = CASE WHEN (confidence IS NULL OR confidence < 0.40 OR category IS NULL OR category = 'Unclassified') THEN $6 ELSE confidence END,
      classified_at   = CASE WHEN (confidence IS NULL OR confidence < 0.40 OR category IS NULL OR category = 'Unclassified') THEN $7 ELSE classified_at END,
      wikipedia_summary = COALESCE(wikipedia_summary, $8)
    WHERE name = $9 AND user_id = $10
  `;

  let added = 0, classified = 0, unclassified = 0;
  const newCompanies = [];

  await tx(async (client) => {
    for (const entry of rawResults) {
      const key      = entry.name.toLowerCase();
      const existing = existingMap.get(key);
      const fallback = { category: 'Tech & Software', subcategory: 'SaaS', confidence: 0.35, classified_at: new Date().toISOString(), wikipedia: '' };
      const cls      = classifiedMap.get(key) || fallback;

      // Category ALWAYS from classifier — never from scrape context
      const dbCategory     = existing ? existing.category     : cls.category;
      const dbSubcategory  = existing ? existing.subcategory  : cls.subcategory;
      const dbConfidence   = existing ? existing.confidence   : cls.confidence;
      const dbClassifiedAt = existing ? existing.classified_at : cls.classified_at;
      const wikiSummary    = cls.wikipedia || '';

      if (dbCategory !== 'Unclassified') classified++;
      else unclassified++;

      const domain = getDomain(entry.careersUrl);
      const r = await client.query(insertSql, [
        entry.name,
        dbCategory, dbSubcategory, dbConfidence, dbClassifiedAt, wikiSummary,
        entry.jobTitle || 'SWE Intern', entry.location || 'USA',
        entry.city || null, entry.state || null, entry.country || 'US',
        entry.careersUrl || '', entry.source || 'scrape', domain,
        entry.source || 'scrape',
        req.user.id
      ]);

      if (r.rowCount > 0) {
        added++;
        newCompanies.push({ name: entry.name, category: dbCategory, location: entry.location || 'USA', source: entry.source || 'scrape', careersUrl: entry.careersUrl || '' });
      } else {
        const firstSrc = (entry.source || '').split(',')[0] || '';
        await client.query(updateSql, [
          firstSrc, firstSrc, firstSrc,
          cls.category, cls.subcategory, cls.confidence, cls.classified_at, wikiSummary,
          entry.name,
          req.user.id
        ]);
      }
    }
  });

  // Log category breakdown
  const breakdown = await all(`
    SELECT category, subcategory, COUNT(*) as n FROM jobs
    WHERE user_id = $1
    GROUP BY category, subcategory ORDER BY n DESC LIMIT 10
  `, [req.user.id]);
  console.log('[scrape] top categories:', breakdown.map(r => `${r.category}/${r.subcategory}:${r.n}`).join(', '));

  const total = (await one('SELECT COUNT(*) as n FROM jobs WHERE user_id = $1', [req.user.id])).n;
  const found = rawResults.length;
  const alreadyInDb = Math.max(0, found - added);
  console.log(`[scrape] done — found=${found} added=${added} alreadyInDb=${alreadyInDb} total=${total} classified=${classified} unclassified=${unclassified}`);

  // Persist the latest scrape summary so the dashboard can render
  // "Last scrape — 2 min ago, found 100, +5 new" without needing a separate
  // activity log query. meta is per-user; one row per user, last-write wins.
  try {
    await run(
      `INSERT INTO meta (user_id, key, value)
       VALUES ($1, 'last_scrape_summary', $2)
       ON CONFLICT (user_id, key) DO UPDATE SET value = EXCLUDED.value`,
      [req.user.id, JSON.stringify({
        at:           new Date().toISOString(),
        found,
        added,
        alreadyInDb,
        succeeded,
        failedSrc,
        bySource,
        // First 25 names so the Dashboard can show "Newly added: X, Y, Z + N more".
        // Full list is the canonical jobs table; this is just for surfacing.
        newCompanyNames: newCompanies.slice(0, 25).map(c => c.name),
        errors:          scrapeErrors,
      })]
    );
  } catch (e) { console.warn('[scrape] failed to persist last_scrape_summary:', e.message); }

  res.json({ added, found, alreadyInDb, total, succeeded, failedSrc, classified, unclassified, bySource, errors: scrapeErrors, newCompanies });
});

// ── Search companies by name ──────────────────────────────────────────────────

router.get('/search', async (req, res) => {
  try {
    const { q } = req.query;
    if (!q?.trim()) return res.json([]);
    const rows = await all(`
      SELECT id, name, category, subcategory, location, source, status, website, description, yc_batch, tags, team_size
      FROM jobs WHERE user_id = $1 AND name ILIKE $2
      ORDER BY name LIMIT 8
    `, [req.user.id, `%${q.trim()}%`]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Company detail (info + contacts + roles) ──────────────────────────────────

router.get('/:id/detail', async (req, res) => {
  try {
    const company = await one('SELECT * FROM jobs WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
    if (!company) return res.status(404).json({ error: 'Company not found' });
    const contacts = await all('SELECT * FROM job_contacts WHERE job_id = $1 AND user_id = $2 ORDER BY seniority_score DESC, created_at DESC', [req.params.id, req.user.id]);
    const roles    = await all('SELECT * FROM roles WHERE company_id = $1 AND user_id = $2 ORDER BY created_at DESC', [req.params.id, req.user.id]);
    res.json({ company, contacts, roles });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Update company status ─────────────────────────────────────────────────────

router.put('/:id/status', async (req, res) => {
  try {
    const { status } = req.body;
    const valid = ['new','researching','contacted','responded','skip'];
    if (!status || !valid.includes(status.toLowerCase())) return res.status(400).json({ error: 'invalid status' });
    await run('UPDATE jobs SET status = $1 WHERE id = $2 AND user_id = $3', [status, req.params.id, req.user.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Save a manually-entered careers URL for a company ────────────────────────
router.put('/:id/url', async (req, res) => {
  try {
    const { url } = req.body;
    if (!url || typeof url !== 'string') return res.status(400).json({ error: 'url required' });
    await run('UPDATE jobs SET url = $1 WHERE id = $2 AND user_id = $3', [url.trim(), req.params.id, req.user.id]);
    res.json({ success: true, url: url.trim() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Get saved roles for a company ────────────────────────────────────────────

router.get('/:id/roles', async (req, res) => {
  try {
    const roles = await all('SELECT * FROM roles WHERE company_id = $1 AND user_id = $2 ORDER BY created_at DESC', [req.params.id, req.user.id]);
    res.json(roles);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Canonical careers URL (for "Check Careers Page" button on mount) ─────────

router.get('/:id/careers-url', async (req, res) => {
  try {
    const c = await one('SELECT name, url FROM jobs WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
    if (!c) return res.status(404).json({ error: 'Company not found' });
    const known = knownCareersFor(c.name);
    if (known?.root) return res.json({ url: known.root + (known.internQuery || ''), source: 'known' });
    if (c.url) {
      try {
        const base = new URL(c.url.startsWith('http') ? c.url : `https://${c.url}`);
        const segments = base.pathname.split('/').filter(Boolean);
        const looksLikeRoleUrl = segments.length > 1 || /job[-_ ]?id|requisition|\/details\/|\/view\//i.test(c.url) || /\d{5,}/.test(c.url);
        if (looksLikeRoleUrl) return res.json({ url: `${base.origin}/careers`, source: 'derived' });
        if (/careers|jobs/i.test(c.url)) return res.json({ url: c.url, source: 'stored' });
        return res.json({ url: `${base.origin}/careers`, source: 'derived' });
      } catch (_) {
        return res.json({ url: c.url, source: 'stored' });
      }
    }
    res.json({ url: null });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Scrape open roles for a company ──────────────────────────────────────────

// Word-boundary aware: matches "intern", "interns", "internship", "internships"
// but NOT "internal", "international" (those have longer stems with \B after "intern").
const INTERN_KW = /\binterns?\b|\binternships?\b|\bco-op\b|\bcoop\b|\bsummer 202[456]\b/i;

// Full-time and new-grad keywords — entry-level positions that aren't explicitly internships
const FULLTIME_KW = /\bfull.?time\b|\bfull time\b|\bnew grad\b|\bnew-grad\b|\bentry.?level\b|\bjunior\b/i;

// CS/technical roles only - exclude PM, sales, marketing, etc.
const CS_ROLE_KW = /\b(software|engineer|developer|dev|backend|frontend|full.?stack|data|ml|machine learning|ai|artificial intelligence|scientist|research|platform|infrastructure|devops|sre|security|infosec)\b/i;
const NON_CS_ROLE = /\b(product\s+manager|pm\b|sales|marketing|business|account|recruiter|hr|finance|ops|operations|compliance|legal|support|customer)\b/i;

function classifyRoleType(title) {
  if (!title) return null;
  // Must be a CS role
  if (!CS_ROLE_KW.test(title)) return null;
  // Reject non-technical roles
  if (NON_CS_ROLE.test(title)) return null;
  // Classify type - must match exactly one
  if (INTERN_KW.test(title)) return 'intern';
  if (FULLTIME_KW.test(title)) return 'fulltime';
  // Default: if it has fulltime keywords or seniority levels, it's fulltime
  if (/\bsenior\b|\blead\b|\bstaff\b|\bprincipal\b|\bhead\b/i.test(title)) return 'fulltime';
  return null; // ambiguous or unable to classify
}

// US states abbreviations + common city names to detect US locations
const NON_US_COUNTRIES = /\b(canada|uk|united kingdom|england|germany|france|india|australia|netherlands|singapore|ireland|spain|brazil|mexico|poland|sweden|denmark|israel|japan|china|korea|new zealand|colombia|argentina|chile|peru|portugal|italy|switzerland|austria|belgium|norway|finland|czech|romania|hungary|turkey|egypt|nigeria|kenya|pakistan|bangladesh|philippines|indonesia|malaysia|thailand|vietnam|hong kong|hongkong|warsaw|toronto|montreal|vancouver|london|berlin|paris|amsterdam|dublin|madrid|sydney|melbourne|tel aviv|bangalore|mumbai|delhi|beijing|shanghai|tokyo|seoul|taipei|jakarta|kuala lumpur|dubai|cape town|johannesburg|lagos|nairobi|buenos aires|bogota|lima|santiago|sao paulo)\b/i;

const US_CITY_RE = /\b(New York|San Francisco|Seattle|Chicago|Austin|Boston|Denver|Atlanta|Los Angeles|Washington DC|Washington D\.C|Miami|Dallas|Houston|Portland|Phoenix|Minneapolis|Detroit|Pittsburgh|Philadelphia|San Jose|Oakland|Brooklyn|Manhattan|Palo Alto|Menlo Park|Sunnyvale|Mountain View|Santa Clara|San Diego|Las Vegas|Nashville|Salt Lake City|Baltimore|Tampa|Orlando|Columbus|Charlotte|Indianapolis|Kansas City|Stamford|Greenwich|Westport|Midtown|Wall Street|New Haven|Hartford|Raleigh|Durham|Research Triangle|Bellevue|Redmond|Kirkland|Irvine|San Diego|Pasadena|Santa Monica|Beverly Hills|Culver City|Burbank|Sacramento|San Jose|San Mateo|Palo Alto|Fremont|Oakland|Berkeley|Emeryville|South San Francisco|Menlo Park|Sunnyvale|Santa Clara|Mountain View|Cupertino|Milpitas|Newark|Redwood City|Foster City|Burlingame|Brisbane|Daly City)\b/i;

function isUsLocation(loc) {
  if (!loc) return true; // no location = don't exclude
  const l = loc.trim();
  if (/\bremote\b/i.test(l)) return true;
  // Reject if ANY non-US country/city appears anywhere in the string
  if (NON_US_COUNTRIES.test(l)) return false;
  // Explicit US markers
  if (/\bUnited States\b|\bUSA\b|\bU\.S\.A\b/i.test(l)) return true;
  // "City, XX" with 2-letter state code anywhere in the string
  if (/,\s*[A-Z]{2}\b/.test(l)) return true;
  // Known US city names
  if (US_CITY_RE.test(l)) return true;
  // Single-word or short location with no comma — allow (e.g. "Nationwide", "Remote")
  if (!/,/.test(l) && l.split(/\s+/).length <= 3) return true;
  // Multi-location semicolon-separated — allow only if no non-US part (already checked above)
  if (/;/.test(l)) return true;
  // Multi-word with comma but no recognizable US pattern — exclude
  return false;
}

// Canonical careers-search URLs for big companies whose public careers UI
// is a React/Workday SPA and can't be scraped via HTML. Used for:
//   - "Check Careers Page" link (so it goes to the search UI, not a single role)
//   - Serper site: filter (so we know the right host to search)
const KNOWN_CAREERS_ROOTS = {
  apple:       { root: 'https://jobs.apple.com/en-us/search',                         host: 'jobs.apple.com',                     internQuery: '?search=intern&sort=newest' },
  amazon:      { root: 'https://www.amazon.jobs/en/search',                           host: 'amazon.jobs',                        internQuery: '?base_query=intern' },
  google:      { root: 'https://careers.google.com/jobs/results/',                    host: 'careers.google.com',                 internQuery: '?q=intern&target_level=INTERN' },
  meta:        { root: 'https://www.metacareers.com/jobs',                            host: 'metacareers.com',                    internQuery: '?q=intern' },
  microsoft:   { root: 'https://careers.microsoft.com/us/en/search-results',          host: 'careers.microsoft.com',              internQuery: '?keywords=intern' },
  netflix:     { root: 'https://jobs.netflix.com/search',                             host: 'jobs.netflix.com',                   internQuery: '?q=intern' },
  nvidia:      { root: 'https://nvidia.wd5.myworkdayjobs.com/en-US/NVIDIAExternalCareerSite', host: 'nvidia.wd5.myworkdayjobs.com', internQuery: '?q=intern' },
  tesla:       { root: 'https://www.tesla.com/careers/search/',                       host: 'tesla.com',                          internQuery: '?type=5&query=intern' },
  spacex:      { root: 'https://www.spacex.com/careers/jobs/',                        host: 'spacex.com',                         internQuery: '?search=intern' },
  openai:      { root: 'https://openai.com/careers/search/',                          host: 'openai.com',                         internQuery: '?keywords=intern' },
  anthropic:   { root: 'https://www.anthropic.com/jobs',                              host: 'anthropic.com',                      internQuery: '?keyword=intern' },
  stripe:      { root: 'https://stripe.com/jobs/search',                              host: 'stripe.com',                         internQuery: '?query=intern' },
  uber:        { root: 'https://www.uber.com/us/en/careers/list/',                    host: 'uber.com',                           internQuery: '?query=intern' },
  airbnb:      { root: 'https://careers.airbnb.com/positions/',                       host: 'careers.airbnb.com',                 internQuery: '?search=intern' },
  linkedin:    { root: 'https://careers.linkedin.com/jobs',                           host: 'careers.linkedin.com',               internQuery: '?keywords=intern' },
  salesforce:  { root: 'https://careers.salesforce.com/en/jobs/',                     host: 'salesforce.com',                     internQuery: '?search=intern' },
  ibm:         { root: 'https://www.ibm.com/careers/search',                          host: 'ibm.com',                            internQuery: '?q=intern' },
  intel:       { root: 'https://jobs.intel.com/en/search-jobs',                       host: 'jobs.intel.com',                     internQuery: '?q=intern' },
  adobe:       { root: 'https://careers.adobe.com/us/en/search-results',              host: 'careers.adobe.com',                  internQuery: '?keywords=intern' },
  oracle:      { root: 'https://careers.oracle.com/jobs/',                            host: 'careers.oracle.com',                 internQuery: '?keyword=intern' },
  qualcomm:    { root: 'https://careers.qualcomm.com/careers',                        host: 'careers.qualcomm.com',               internQuery: '?q=intern' },
  snowflake:   { root: 'https://careers.snowflake.com/us/en/search-results',          host: 'careers.snowflake.com',              internQuery: '?keywords=intern' },
  databricks:  { root: 'https://www.databricks.com/company/careers/open-positions',   host: 'databricks.com',                     internQuery: '?search=intern' },
  palantir:    { root: 'https://www.palantir.com/careers/students/',                  host: 'palantir.com',                       internQuery: '' },
  palo_alto:   { root: 'https://jobs.paloaltonetworks.com/en/search-jobs',            host: 'jobs.paloaltonetworks.com',          internQuery: '?q=intern' },
  'goldman sachs': { root: 'https://www.goldmansachs.com/careers/students-and-graduates/', host: 'goldmansachs.com',              internQuery: '' },
  'jpmorgan':  { root: 'https://careers.jpmorgan.com/us/en/students',                 host: 'careers.jpmorgan.com',               internQuery: '' },
  citadel:     { root: 'https://www.citadel.com/careers/open-opportunities/',         host: 'citadel.com',                        internQuery: '?type=internship' },
};

function knownCareersFor(companyName = '') {
  const key = companyName.toLowerCase().trim();
  // Exact match first
  if (KNOWN_CAREERS_ROOTS[key]) return KNOWN_CAREERS_ROOTS[key];
  // Token match — check if any known key is a token in the company name
  const tokens = key.replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
  for (const k of Object.keys(KNOWN_CAREERS_ROOTS)) {
    if (tokens.includes(k)) return KNOWN_CAREERS_ROOTS[k];
  }
  return null;
}

// Known Workday slugs for major companies that don't use Greenhouse/Lever
const WORKDAY_SLUGS = {
  microsoft: { host: 'microsoft', path: 'en-US/jobs' },
  google: { host: 'google', path: 'en/jobs' },
  amazon: { host: 'amazon', path: 'en/jobs' },
  meta: { host: 'meta', path: 'en/jobs' },
  apple: { host: 'apple', path: 'en/jobs' },
  salesforce: { host: 'salesforce', path: 'en/jobs' },
  oracle: { host: 'oracle', path: 'en/jobs' },
  ibm: { host: 'ibm', path: 'en/jobs' },
  intel: { host: 'intel', path: 'en/jobs' },
  nvidia: { host: 'nvidia', path: 'en/jobs' },
  qualcomm: { host: 'qualcomm', path: 'en/jobs' },
};

// Extract the `searchResults` array from Apple's SSR HTML using a balanced-bracket
// walker. The old regex `\[[\s\S]*?\]` stopped at the first `]`, which broke once
// Apple started nesting location/team arrays inside each result.
function extractAppleSearchResults(html) {
  const key = '"searchResults"';
  const keyIdx = html.indexOf(key);
  if (keyIdx < 0) return null;
  // Walk forward to the opening `[`.
  let i = keyIdx + key.length;
  while (i < html.length && html[i] !== '[') i++;
  if (html[i] !== '[') return null;
  // Balance brackets — respect strings so we don't count `]` inside a title.
  let depth = 0, inStr = false, esc = false;
  const start = i;
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
  const arrSrc = html.slice(start, i);
  try { return JSON.parse(arrSrc); } catch { return null; }
}

// Direct scraper for Apple's careers site. Tries the JSON endpoint first
// (`jobs.apple.com/api/role/search`), then falls back to SSR-HTML extraction.
async function fetchAppleInternRoles(roleType = 'intern', maxPages = 3) {
  const seen = new Set();
  const roles = [];
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
  };

  function addItem(it) {
    const title = it.postingTitle || it.transformedPostingTitle;
    if (!title) return;
    const classified = classifyRoleType(title);
    // Filter by requested roleType
    if (roleType === 'intern' && classified !== 'intern') return;
    if (roleType === 'fulltime' && classified !== 'fulltime') return;
    const id = it.id || it.positionId;
    if (!id) return;
    const slug = (it.transformedPostingTitle || title)
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const applyUrl = `https://jobs.apple.com/en-us/details/${id}/${slug}`;
    if (seen.has(applyUrl)) return;
    seen.add(applyUrl);
    const locName = Array.isArray(it.locations) && it.locations[0]?.name ? it.locations[0].name : '';
    roles.push({
      title: title.trim(),
      location: locName || null,
      source: 'apple',
      apply_url: applyUrl,
      posted_at: it.postingDate || null,
      role_type: classified,
    });
  }

  // Strategy 1: official JSON API — most reliable when available.
  try {
    const searchQuery = roleType === 'fulltime' ? 'full time' : 'internship';
    for (let page = 1; page <= maxPages; page++) {
      const r = await fetch('https://jobs.apple.com/api/role/search', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json', 'Referer': `https://jobs.apple.com/en-us/search?search=${encodeURIComponent(searchQuery)}` },
        body: JSON.stringify({
          query:   searchQuery,
          filters: { locations: ['united-states-USA'], postingpostLocation: ['united-states-USA'] },
          page,
          locale:  'en-us',
          sort:    'newest',
        }),
        signal: AbortSignal.timeout(10000),
      });
      if (!r.ok) break;
      const data = await r.json().catch(() => null);
      const items = data?.searchResults || data?.res?.searchResults || [];
      if (!Array.isArray(items) || items.length === 0) break;
      for (const it of items) addItem(it);
      const total = data?.totalRecords ?? data?.res?.totalRecords ?? 0;
      if (roles.length >= total) break;
    }
    if (roles.length > 0) return roles;
  } catch (err) {
    console.log(`[apple] JSON API failed: ${err.message}`);
  }

  // Strategy 2: SSR HTML parse — fallback if the API refuses or schema drifts.
  const htmlHeaders = {
    ...headers,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  };
  // Build search URLs based on role type
  const searchUrls = roleType === 'fulltime'
    ? [
        (p) => `https://jobs.apple.com/en-us/search?search=full%20time&location=united-states-USA${p > 1 ? `&page=${p}` : ''}`,
        (p) => `https://jobs.apple.com/en-us/search?search=software%20engineer&location=united-states-USA${p > 1 ? `&page=${p}` : ''}`,
      ]
    : [
        (p) => `https://jobs.apple.com/en-us/search?search=internship&location=united-states-USA${p > 1 ? `&page=${p}` : ''}`,
        (p) => `https://jobs.apple.com/en-us/search?team=internships-STDNT-INTRN&location=united-states-USA${p > 1 ? `&page=${p}` : ''}`,
      ];
  for (const mkUrl of searchUrls) {
    for (let page = 1; page <= maxPages; page++) {
      try {
        const r = await fetch(mkUrl(page), { headers: htmlHeaders, signal: AbortSignal.timeout(10000) });
        if (!r.ok) break;
        // Apple embeds hydration JSON as escaped strings inside the HTML.
        const html = (await r.text()).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
        const items = extractAppleSearchResults(html);
        if (!Array.isArray(items) || items.length === 0) break;
        const before = roles.length;
        for (const it of items) addItem(it);
        // Stop paginating this URL once a page yields nothing new.
        if (roles.length === before) break;
      } catch { break; }
    }
    if (roles.length > 0) break;
  }
  return roles;
}

// Workday API search for roles (intern or fulltime)
async function fetchWorkdayRoles(slug, companyName, companyLocation, roleType = 'intern') {
  try {
    const url = `https://${slug}.wd1.myworkdayjobs.com/wday/cxs/${slug}/External_Career_Site/jobs`;
    const searchText = roleType === 'fulltime' ? 'full time' : 'intern';
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0' },
      body: JSON.stringify({ limit: 20, offset: 0, searchText, appliedFacets: {} }),
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return [];
    const d = await r.json();
    const jobs = d.jobPostings || [];
    return jobs
      .filter(j => {
        const classified = classifyRoleType(j.title || '');
        if (roleType === 'intern') return classified === 'intern';
        if (roleType === 'fulltime') return classified === 'fulltime';
        return true;
      })
      .map(j => ({
        title: j.title,
        location: j.locationsText || companyLocation || 'USA',
        source: 'workday',
        apply_url: `https://${slug}.wd1.myworkdayjobs.com/External_Career_Site/job/${j.externalPath || ''}`,
        posted_at: j.postedOn || null,
        role_type: classifyRoleType(j.title),
      }));
  } catch (_) { return []; }
}

async function fetchAtsRoles(slug, companyName, companyLocation, roleType = 'intern') {
  const results = [];
  // Try Greenhouse
  try {
    const r = await fetch(`https://boards-api.greenhouse.io/v1/boards/${slug}/jobs?content=false`, { signal: AbortSignal.timeout(6000) });
    if (r.ok) {
      const d = await r.json();
      for (const j of (d.jobs || [])) {
        const t = j.title || '';
        const classified = classifyRoleType(t);
        if (!classified) continue; // Skip non-CS roles
        if (roleType === 'intern' && classified !== 'intern') continue;
        if (roleType === 'fulltime' && classified !== 'fulltime') continue;
        results.push({ title: t, location: j.location?.name || companyLocation || '', source: 'greenhouse', apply_url: j.absolute_url || `https://boards.greenhouse.io/${slug}`, posted_at: null, role_type: classified });
      }
    }
  } catch (_) {}
  if (results.length) return results;
  // Try Lever
  try {
    const r = await fetch(`https://api.lever.co/v0/postings/${slug}?mode=json&limit=250`, { signal: AbortSignal.timeout(6000) });
    if (r.ok) {
      const d = await r.json();
      for (const j of (Array.isArray(d) ? d : [])) {
        const t = j.text || '';
        const classified = classifyRoleType(t);
        if (!classified) continue; // Skip non-CS roles
        if (roleType === 'intern' && classified !== 'intern') continue;
        if (roleType === 'fulltime' && classified !== 'fulltime') continue;
        results.push({ title: t, location: j.categories?.location || companyLocation || '', source: 'lever', apply_url: j.hostedUrl || `https://jobs.lever.co/${slug}`, posted_at: j.createdAt ? new Date(j.createdAt).toISOString() : null, role_type: classified });
      }
    }
  } catch (_) {}
  if (results.length) return results;
  // Try Ashby
  try {
    const r = await fetch(`https://api.ashbyhq.com/posting-api/job-board/${slug}`, { signal: AbortSignal.timeout(6000) });
    if (r.ok) {
      const d = await r.json();
      const jobs = d.jobs || d.jobPostings || [];
      for (const j of jobs) {
        const t = j.title || '';
        const classified = classifyRoleType(t);
        if (!classified) continue; // Skip non-CS roles
        if (roleType === 'intern' && classified !== 'intern') continue;
        if (roleType === 'fulltime' && classified !== 'fulltime') continue;
        results.push({ title: t, location: j.locationName || j.location || companyLocation || '', source: 'ashby', apply_url: j.jobPostingUrl || j.applyUrl || `https://jobs.ashbyhq.com/${slug}`, posted_at: j.publishedAt || null, role_type: classified });
      }
    }
  } catch (_) {}
  // Try Workday if slug matches a known company
  if (!results.length) {
    const wdSlug = Object.keys(WORKDAY_SLUGS).find(k => slug.includes(k) || k.includes(slug));
    if (wdSlug) {
      const wdRoles = await fetchWorkdayRoles(wdSlug, companyName, companyLocation, roleType);
      results.push(...wdRoles);
    }
  }
  return results;
}

router.post('/:id/scrape-roles', async (req, res) => {
  try {
    const company = await one('SELECT * FROM jobs WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
    if (!company) return res.status(404).json({ error: 'Company not found' });
    const name = company.name;
    const roleType = req.body?.roleType || 'intern'; // 'intern' or 'fulltime'
    let foundRoles = [];

    // Step 0: Direct scrapers for big companies that don't use standard ATS.
    // Apple embeds search results as JSON in the careers HTML — parse directly.
    const nameLowerSlug = name.toLowerCase().trim();
    if (nameLowerSlug === 'apple' || nameLowerSlug.startsWith('apple ')) {
      try {
        const apple = await fetchAppleInternRoles(roleType, 3);
        if (apple.length) foundRoles = apple;
      } catch (err) { console.log('[scrape-roles] Apple direct failed:', err.message); }
    }

    // Step 0b: YC companies on WorkAtAStartup — extract from page structure
    if (!foundRoles.length && company.source === 'yc' && company.url?.includes('workatastartup.com')) {
      try {
        const fetched = await safeFetch(company.url, {
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; InternBot/1.0)' },
          timeoutMs: 8000,
        });
        if (fetched.res.ok) {
          const html = await fetched.text();
          // Extract role titles from WaaS page — look for job postings
          const roleMatches = html.match(/(?:<h[23]|<strong|<span class="[^"]*job[^"]*")>([^<]{10,120}?(?:engineer|developer|analyst|scientist|designer|manager|researcher|program|intern)[^<]{0,40}?)<\/(?:h[23]|strong|span)/gi);
          if (roleMatches) {
            const uniqueRoles = [...new Set(roleMatches.map(m => m.replace(/<[^>]+>/g, '').trim()))];
            for (const title of uniqueRoles.slice(0, 8)) {
              const classified = classifyRoleType(title);
              if (!classified) continue; // Skip non-CS roles
              if (roleType === 'intern' && classified !== 'intern') continue;
              if (roleType === 'fulltime' && classified !== 'fulltime') continue;
              foundRoles.push({
                title: title.slice(0, 120),
                location: company.location || null,
                source: 'workatastartup',
                apply_url: company.url,
                posted_at: null,
                role_type: classified,
              });
            }
          }
        }
      } catch (_) {}
    }

    // Step 1a: Try ATS APIs directly using company's careers URL slug
    const careersUrl = company.url || '';
    let atsSlug = null;
    if (careersUrl.includes('greenhouse.io')) {
      const m = careersUrl.match(/greenhouse\.io\/([^/?#]+)/); if (m?.[1]) atsSlug = m[1];
    } else if (careersUrl.includes('lever.co')) {
      const m = careersUrl.match(/lever\.co\/([^/?#]+)/); if (m?.[1]) atsSlug = m[1];
    }
    if (atsSlug) {
      foundRoles = await fetchAtsRoles(atsSlug, name, company.location, roleType);
    }

    // Step 1b: Guess slug from company name and try ATS if no URL or no results
    if (!foundRoles.length) {
      const guessSlug = name.toLowerCase().replace(/[^a-z0-9]/g, '');
      foundRoles = await fetchAtsRoles(guessSlug, name, company.location, roleType);
    }

    // Step 1c: Try additional ATS slug variants (hyphenated, first word only)
    if (!foundRoles.length) {
      const slugVariants = [
        name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, ''), // new-york-life
        name.toLowerCase().split(/\s+/)[0].replace(/[^a-z0-9]/g, ''),       // first word: newlife
        name.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).slice(0, 2).join(''), // first two words
      ].filter((v, i, a) => v && a.indexOf(v) === i); // unique, non-empty

      for (const slug of slugVariants) {
        foundRoles = await fetchAtsRoles(slug, name, company.location, roleType);
        if (foundRoles.length) break;
      }
    }

    // Step 1d: Fall back to Serper — search the company's own careers domain
    if (!foundRoles.length) {
      const serperKey = (process.env.SERPER_API_KEY || '').trim();
      if (serperKey && serperKey.length > 10) {
        try {
          // Build a site-restricted query. Prefer the known careers host for big-name companies
          // (e.g. jobs.apple.com instead of apple.com), otherwise derive from company.url.
          let siteClause = '';
          const known = knownCareersFor(name);
          if (known?.host) {
            siteClause = `site:${known.host} OR site:boards.greenhouse.io OR site:jobs.lever.co OR site:jobs.ashbyhq.com`;
          } else if (company.url) {
            try {
              const domain = new URL(company.url.startsWith('http') ? company.url : `https://${company.url}`).hostname.replace(/^www\./, '');
              if (domain && !domain.includes('greenhouse') && !domain.includes('lever')) {
                siteClause = `site:${domain} OR site:boards.greenhouse.io OR site:jobs.lever.co OR site:jobs.ashbyhq.com`;
              }
            } catch (_) {}
          }
          // Run complementary queries based on role type
          const queries = roleType === 'fulltime'
            ? [
                `"${name}" full time engineering ${siteClause}`.trim(),
                `"${name}" software engineer ${siteClause}`.trim(),
                `"${name}" new grad ${siteClause}`.trim(),
                `"${name}" entry level ${siteClause}`.trim(),
              ]
            : [
                `"${name}" intern engineering ${siteClause}`.trim(),
                `"${name}" intern software ${siteClause}`.trim(),
                `"${name}" intern (ML OR data OR design OR research) ${siteClause}`.trim(),
                `"${name}" internships summer 2026 ${siteClause}`.trim(),
              ];
          const allItems = [];
          for (const q of queries) {
            try {
              const r = await fetch('https://google.serper.dev/search', {
                method: 'POST',
                headers: { 'X-API-KEY': serperKey, 'Content-Type': 'application/json' },
                body: JSON.stringify({ q, num: 20 }),
                signal: AbortSignal.timeout(12000),
              });
              if (!r.ok) continue;
              const d = await r.json();
              for (const it of (d.organic || [])) allItems.push(it);
            } catch (_) {}
          }
          // Dedup Serper results by URL before filtering
          {
            const seen = new Set();
            const d = { organic: allItems.filter(it => {
              if (!it?.link || seen.has(it.link)) return false;
              seen.add(it.link); return true;
            })};
            // Build a domain allowlist for this company.
            // Prefer the known careers host (jobs.apple.com, amazon.jobs, metacareers.com, …),
            // otherwise derive it from company.url.
            let companyDomain = '';
            if (known?.host) {
              companyDomain = known.host.replace(/^www\./, '');
            } else {
              try {
                companyDomain = new URL(company.url?.startsWith('http') ? company.url : `https://${company.url}`).hostname.replace(/^www\./, '');
              } catch (_) {}
            }
            // Strip leading subdomain for the endsWith check (so jobs.apple.com matches apple.com)
            const companyRootDomain = companyDomain.split('.').slice(-2).join('.');
            const nameLower = name.toLowerCase();

            for (const item of (d.organic || [])) {
              if (!item.title || !item.link) continue;
              // Skip job aggregator pages — only real company/ATS pages
              if (/linkedin\.com\/jobs\/search|indeed\.com\/jobs|glassdoor\.com\/job-listing|ziprecruiter\.com|monster\.com|dice\.com\/jobs|builtin|techcrunch|venturebeat|crunchbase/i.test(item.link)) continue;

              // Only accept if the URL belongs to this company's domain (or a subdomain like jobs.apple.com)
              // OR an ATS page that mentions the company slug.
              let linkOk = false;
              try {
                const linkHost = new URL(item.link).hostname.replace(/^www\./, '');
                const nameSlug = nameLower.replace(/[^a-z0-9]/g, '');
                if (companyDomain && (linkHost === companyDomain || linkHost.endsWith(`.${companyDomain}`))) linkOk = true;
                // Match the root domain too (jobs.apple.com → apple.com)
                else if (companyRootDomain && (linkHost === companyRootDomain || linkHost.endsWith(`.${companyRootDomain}`))) linkOk = true;
                // Big companies commonly host careers on cousin domains (amazon.jobs, metacareers.com, etc.)
                else if (linkHost.includes(nameSlug) && /jobs|careers/.test(linkHost)) linkOk = true;
                else if (/greenhouse\.io|lever\.co|ashbyhq\.com|workable\.com|smartrecruiters\.com/.test(linkHost)) {
                  // ATS link — must contain company name slug in path
                  if (item.link.toLowerCase().includes(nameSlug)) linkOk = true;
                }
              } catch (_) {}
              if (!linkOk) continue;

              // Strip "at CompanyName" suffixes added by search engines
              const rawTitle = item.title.split(/[-–|·]|\s+at\s+.+$/i)[0].trim();
              if (rawTitle.length < 8 || rawTitle.length > 110) continue;
              // Classify and filter by role type
              const classified = classifyRoleType(rawTitle);
              if (!classified) continue; // Skip non-CS roles
              if (roleType === 'intern' && classified !== 'intern') continue;
              if (roleType === 'fulltime' && classified !== 'fulltime') continue;

              // Only use a location if we can parse a clean US-style "City, ST" or Remote/Hybrid
              // from the snippet. Don't fall back to company.location — for big multi-country
              // companies like Apple that's "London, UK, Cambridge, UK" which fails isUsLocation()
              // and wipes out otherwise-valid US intern roles.
              const parsedLoc = item.snippet?.match(/\b([A-Z][a-z]+(?:\s[A-Z][a-z]+)*,\s*[A-Z]{2}|Remote|Hybrid)\b/)?.[1] || null;
              foundRoles.push({
                title: rawTitle,
                location: parsedLoc,
                source: 'google',
                apply_url: item.link,
                posted_at: null,
                role_type: classified,
              });
            }
          }
        } catch (err) { console.log('[scrape-roles] Serper failed:', err.message); }
      }
    }

    // Step 1e: Scrape the company's own careers page for intern listings
    if (!foundRoles.length && company.url) {
      try {
        const careersUrls = [];
        // Try /careers, /jobs paths on company domain
        try {
          const base = new URL(company.url.startsWith('http') ? company.url : `https://${company.url}`);
          careersUrls.push(`${base.origin}/careers`, `${base.origin}/jobs`);
          // Also try the URL itself if it looks like a careers page
          if (/careers|jobs/i.test(company.url)) careersUrls.unshift(company.url);
        } catch (_) {}

        for (const careersUrl of careersUrls) {
          try {
            const fetched = await safeFetch(careersUrl, {
              headers: { 'User-Agent': 'Mozilla/5.0 (compatible; InternBot/1.0)' },
              timeoutMs: 8000,
            });
            if (!fetched.res.ok) continue;
            const html = await fetched.text();
            // Extract text content — find lines that look like job titles
            const textLines = html
              .replace(/<[^>]+>/g, ' ')
              .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#\d+;/g, ' ')
              .split(/[\n\r]+/)
              .map(l => l.replace(/\s+/g, ' ').trim())
              .filter(l => l.length > 8 && l.length < 100)
              .filter(l => {
                // Check if it's a proper role type match
                const classified = classifyRoleType(l);
                if (!classified) return false; // Skip non-CS roles
                if (roleType === 'intern' && classified !== 'intern') return false;
                if (roleType === 'fulltime' && classified !== 'fulltime') return false;
                return true;
              });

            const uniqueLines = [...new Set(textLines)].slice(0, 8);
            for (const line of uniqueLines) {
              foundRoles.push({
                title: line.slice(0, 120),
                location: company.location || null,
                source: 'company-site',
                apply_url: careersUrl,
                posted_at: null,
                role_type: classifyRoleType(line),
              });
            }
            if (foundRoles.length) break;
          } catch (_) {}
        }
      } catch (_) {}
    }

    // Step 2: Replace ALL stored roles with fresh results (full refresh, no stale data)
    let added = 0;
    if (foundRoles.length > 0) {
      await tx(async (client) => {
        // Clear existing roles for this company matching the roleType — allows keeping intern + fulltime roles separately
        await client.query(`DELETE FROM roles WHERE company_id = $1 AND role_type = $2 AND user_id = $3`, [company.id, roleType, req.user.id]);
        const usRoles = foundRoles.filter(r => isUsLocation(r.location));
        for (const role of usRoles.slice(0, 20)) {
          const r = await client.query(
            `INSERT INTO roles (company_id, title, location, source, apply_url, posted_at, role_type, user_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (user_id, company_id, title, apply_url) DO NOTHING`,
            [company.id, role.title, role.location || null, role.source, role.apply_url, role.posted_at, role.role_type || roleType, req.user.id]
          );
          if (r.rowCount > 0) added++;
        }
      });
    }

    // Mark this company as "scraped" so the Companies category page can move
    // it from Yet-to-check → Already-checked, regardless of whether roles
    // were found. intern_roles_count caches the result so we don't have to
    // recount on every list render.
    try {
      await run(
        `UPDATE jobs
            SET intern_roles_checked_at = NOW(),
                intern_roles_count      = $2,
                intern_roles_source     = COALESCE($3, intern_roles_source)
          WHERE id = $1 AND user_id = $4`,
        [company.id, foundRoles.length, foundRoles[0]?.source || null, req.user.id]
      );
    } catch (e) {
      console.warn('[scrape-roles] failed to mark intern_roles_checked_at:', e.message);
    }

    const allRoles = await all('SELECT * FROM roles WHERE company_id = $1 AND user_id = $2 ORDER BY created_at DESC', [company.id, req.user.id]);

    // Build a canonical "careers search" URL for the "Check Careers Page" button.
    // Priority: known big-company search URL → derive from company.url origin → company.url as-is.
    // We specifically DON'T reuse company.url if it looks like a deep-link to a single role
    // (has more than one path segment or a query string referencing a job ID).
    let careersPageUrl = null;
    const knownRoot = knownCareersFor(name);
    if (knownRoot?.root) {
      careersPageUrl = knownRoot.root + (knownRoot.internQuery || '');
    } else if (company.url) {
      try {
        const base = new URL(company.url.startsWith('http') ? company.url : `https://${company.url}`);
        const looksLikeRoleUrl = (base.pathname.split('/').filter(Boolean).length > 1)
                              || /job[-_ ]?id|requisition|\d{5,}/i.test(company.url);
        if (looksLikeRoleUrl) {
          careersPageUrl = `${base.origin}/careers`;
        } else if (/careers|jobs/i.test(company.url)) {
          careersPageUrl = company.url;
        } else {
          careersPageUrl = `${base.origin}/careers`;
        }
      } catch (_) {}
    }

    res.json({ roles: allRoles, added, found: foundRoles.length, careersPageUrl });
  } catch (err) {
    console.error('[scrape-roles] error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Scraper health check ──────────────────────────────────────────────────────

router.get('/scraper-health', async (req, res) => {
  try {
    const health = await scraperHealth();
    res.json(health);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Reclassify unclassified companies (exported for server startup) ────────────

// User-scoped: caller MUST pass userId. Background callers (startup, cron) that
// have no request context should pass an explicit user UUID or skip — global
// reclassification across all users is no longer supported.
export async function runReclassifyUnclassified(userId) {
  if (!userId) {
    console.log('[reclassify] skipped — no userId provided (background context)');
    return { reclassified: 0, skipped: true };
  }

  const rows = await all(`
    SELECT name, roles AS "jobTitle", '' AS "jobDescription"
    FROM jobs
    WHERE user_id = $1
      AND (category = 'Unclassified' OR category IS NULL OR confidence < 0.40)
    ORDER BY name
  `, [userId]);

  if (rows.length === 0) { console.log('[reclassify] nothing to reclassify'); return { reclassified: 0 }; }
  console.log(`[reclassify] reclassifying ${rows.length} companies for user ${userId}...`);

  const classifiedMap = await classifyCompanies(rows);
  const updateSql = `
    UPDATE jobs SET
      category = $1, subcategory = $2, confidence = $3,
      classified_at = $4, wikipedia_summary = COALESCE(wikipedia_summary, $5)
    WHERE user_id = $6 AND name = $7
  `;

  let reclassified = 0;
  await tx(async (client) => {
    for (const row of rows) {
      const cls = classifiedMap.get(row.name.toLowerCase());
      if (!cls) continue;
      await client.query(updateSql, [cls.category, cls.subcategory, cls.confidence, cls.classified_at, cls.wikipedia || '', userId, row.name]);
      if (cls.category !== 'Unclassified') reclassified++;
    }
  });

  console.log(`[reclassify] done — ${reclassified}/${rows.length} newly classified`);
  return { reclassified, total: rows.length };
}

router.post('/reclassify-unclassified', async (req, res) => {
  try {
    const result = await runReclassifyUnclassified(req.user.id);
    const breakdown = await all('SELECT category, COUNT(*) as n FROM jobs WHERE user_id = $1 GROUP BY category ORDER BY n DESC', [req.user.id]);
    res.json({ ...result, breakdown });
  } catch (err) {
    console.error('reclassify-unclassified error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Debug: category breakdown ─────────────────────────────────────────────────

router.get('/debug/categories', async (req, res) => {
  try {
    const rows = await all(`
      SELECT category, subcategory, COUNT(*) as n
      FROM jobs
      WHERE user_id = $1
      GROUP BY category, subcategory
      ORDER BY n DESC
    `, [req.user.id]);
    res.json({ rows, total: (await one('SELECT COUNT(*) as n FROM jobs WHERE user_id = $1', [req.user.id])).n });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Reclassify all unclassified / low-confidence companies ────────────────────

router.post('/reclassify-all', async (req, res) => {
  try {
    const rows = await all(`
      SELECT name, roles AS "jobTitle", '' AS "jobDescription"
      FROM jobs
      WHERE user_id = $1 AND (category = 'Unclassified' OR category IS NULL OR confidence < 0.40)
      ORDER BY name
    `, [req.user.id]);

    console.log(`[reclassify] ${rows.length} companies to reclassify`);
    if (rows.length === 0) return res.json({ reclassified: 0, message: 'Nothing to reclassify' });

    const classifiedMap = await classifyCompanies(rows);

    const updateSql = `
      UPDATE jobs SET
        category = $1, subcategory = $2, confidence = $3,
        classified_at = $4, wikipedia_summary = COALESCE(wikipedia_summary, $5)
      WHERE name = $6 AND user_id = $7
    `;

    let reclassified = 0;
    await tx(async (client) => {
      for (const row of rows) {
        const cls = classifiedMap.get(row.name.toLowerCase());
        if (!cls) continue;
        await client.query(updateSql, [
          cls.category, cls.subcategory, cls.confidence,
          cls.classified_at, cls.wikipedia || '',
          row.name,
          req.user.id
        ]);
        reclassified++;
      }
    });

    const breakdown = await all(`
      SELECT category, COUNT(*) as n FROM jobs WHERE user_id = $1 GROUP BY category ORDER BY n DESC
    `, [req.user.id]);
    console.log('[reclassify] done —', breakdown.map(r => `${r.category}:${r.n}`).join(', '));

    res.json({ reclassified, breakdown });
  } catch (err) {
    console.error('reclassify-all error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── List companies ────────────────────────────────────────────────────────────

router.get('/', async (req, res) => {
  try {
    const { category, search } = req.query;
    let sql = 'SELECT * FROM jobs WHERE user_id = $1';
    const params = [req.user.id];
    let i = 2;
    if (category && category !== 'All') {
      sql += ` AND category = $${i++}`;
      params.push(category);
    }
    if (search) {
      sql += ` AND (name ILIKE $${i} OR roles ILIKE $${i+1} OR location ILIKE $${i+2})`;
      i += 3;
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    sql += ' ORDER BY pay DESC';
    const jobs = await all(sql, params);

    // Attach contact counts in ONE aggregate query instead of 3 × per-job
    // (previously 3 × 1499 = 4497 queries per page load, ~10 s wall-clock).
    // Single GROUP BY with FILTER brings that to 1 query regardless of count.
    const counts = await all(
      `SELECT job_id,
              COUNT(*)::int                                  AS contact_count,
              COUNT(*) FILTER (WHERE source = 'linkedin')::int AS linkedin_count,
              COUNT(*) FILTER (WHERE source = 'hunter')::int   AS email_count
         FROM job_contacts
        WHERE user_id = $1
        GROUP BY job_id`,
      [req.user.id]
    );
    const countMap = new Map(counts.map(c => [c.job_id, c]));
    const enriched = jobs.map(j => {
      const c = countMap.get(j.id);
      return {
        ...j,
        contact_count:  c?.contact_count  || 0,
        linkedin_count: c?.linkedin_count || 0,
        email_count:    c?.email_count    || 0,
      };
    });
    res.json(enriched);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Get contacts for a company ────────────────────────────────────────────────

router.get('/:id/contacts', async (req, res) => {
  try {
    const { source } = req.query; // 'linkedin' | 'hunter' | undefined (all)
    let sql = 'SELECT * FROM job_contacts WHERE user_id = $1 AND job_id = $2';
    const params = [req.user.id, req.params.id];
    let i = 3;
    if (source) { sql += ` AND source = $${i++}`; params.push(source); }
    sql += ' ORDER BY created_at DESC';
    res.json(await all(sql, params));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── People & email finding ───────────────────────────────────────────────────
// Domain resolution, provider order, status labels and dedupe live in
// services/companyDomain.js, contactRules.js and contactFinder.js; these
// handlers only do auth, locking, persistence and the response.

// One lookup per company / contact at a time (double clicks, two tabs).
const inFlight = new Set();
function withLock(key, res, fn) {
  if (inFlight.has(key)) {
    res.status(409).json({ error: 'That lookup is already running — give it a moment.' });
    return null;
  }
  inFlight.add(key);
  return Promise.resolve().then(fn).finally(() => inFlight.delete(key));
}

const dbHelpers = { all, run };

/** Domain we're confident in (no MX guessing) — what Apollo's org lookup should use. */
async function trustedDomain(job) {
  const r = await resolveCompanyDomain(job, { verify: async () => false });
  return r?.domain || null;
}

async function savePeople(job, people, userId, limit = 10) {
  let added = 0;
  let updated = 0;
  for (const p of people.slice(0, limit)) {
    if (!p.name || p.name.toLowerCase() === 'unknown') continue;
    const out = await upsertContact(dbHelpers, {
      userId, jobId: job.id, seniorityScore: seniorityScore(p.title),
      contact: { name: p.name, title: p.title, linkedin_url: p.linkedin_url || null, email: p.email || null, status: p.email ? 'unverified' : undefined, source: p.source || 'linkedin' },
    });
    if (out === 'inserted') added++;
    else if (out === 'updated') updated++;
  }
  return { added, updated };
}

function describeReasons(reasons) {
  return reasons.map(r => r.message).filter(Boolean).join(' · ');
}

// ── Find people — SSE stream ("Find People" button) ──────────────────────────
// Emits start | source | complete | error. The work stops if the client leaves.
router.get('/:id/find-people-stream', async (req, res) => {
  const job = await one('SELECT * FROM jobs WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
  if (!job) return res.status(404).json({ error: 'Company not found' });

  await withLock(`people:${req.user.id}:${job.id}`, res, async () => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // disable nginx buffering
    res.flushHeaders();

    const abort = new AbortController();
    let closed = false;
    req.on('close', () => { closed = true; abort.abort(); });
    const emit = (event, data) => { if (!closed) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); };

    try {
      emit('start', { company: job.name });
      const people = await apify.findPeopleAtLinkedInCompany(
        job.name,
        job.linkedin_company_url || null,
        await trustedDomain(job),
        (progress) => emit('source', progress),
        { signal: abort.signal, userId: req.user.id },
      );
      if (closed) return;
      const { added, updated } = await savePeople(job, people, req.user.id, 10);
      const bySource = {};
      for (const p of people) bySource[p.source] = (bySource[p.source] || 0) + 1;
      emit('complete', {
        added, updated, total: people.length, bySource,
        message: people.length ? `+${added} new contact${added === 1 ? '' : 's'}${updated ? `, ${updated} updated` : ''} (${people.length} found)` : 'No matching people found — try adding the company LinkedIn URL',
      });
    } catch (err) {
      console.error('find-people-stream error:', err.message);
      emit('error', { message: err.message, error: err.message });
    } finally {
      if (!closed) res.end();
    }
  });
});

// ── Find people — non-streaming (auto-trigger) ───────────────────────────────
router.post('/:id/find-linkedin', async (req, res) => {
  const job = await one('SELECT * FROM jobs WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
  if (!job) return res.status(404).json({ error: 'Company not found' });
  await withLock(`people:${req.user.id}:${job.id}`, res, async () => {
    const people = await apify.findPeopleAtLinkedInCompany(job.name, job.linkedin_company_url || null, await trustedDomain(job), null, { userId: req.user.id });
    const { added, updated } = await savePeople(job, people, req.user.id, 8);
    const contacts = await all('SELECT * FROM job_contacts WHERE job_id = $1 AND user_id = $2 ORDER BY seniority_score DESC, created_at DESC', [job.id, req.user.id]);
    res.json({ added, updated, contacts });
  });
});

// ── Find emails for a company (bulk) ─────────────────────────────────────────
router.post('/:id/find-emails', async (req, res) => {
  const job = await one('SELECT * FROM jobs WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
  if (!job) return res.status(404).json({ error: 'Company not found' });
  const override = req.body?.domain ? String(req.body.domain) : null;
  if (override && !normalizeHost(override)) return res.status(400).json({ error: `"${override}" isn't a valid domain — use something like acme.com` });

  await withLock(`emails:${req.user.id}:${job.id}`, res, async () => {
    const result = await findCompanyEmails(job, { override, userId: req.user.id });
    if (!result.domain) {
      return res.status(400).json({ error: describeReasons(result.reasons), hint: 'domain_needed', reasons: result.reasons });
    }
    // Remember the domain and where it came from; a guess stays marked as one.
    await run('UPDATE jobs SET domain = $1, domain_source = $2 WHERE id = $3 AND user_id = $4',
      [result.domain, result.domainSource === 'mx' ? 'guess' : result.domainSource, job.id, req.user.id]);

    let added = 0;
    let updated = 0;
    const ordered = [...result.candidates].sort((a, b) => seniorityScore(b.title) - seniorityScore(a.title));
    for (const c of ordered) {
      const out = await upsertContact(dbHelpers, { userId: req.user.id, jobId: job.id, contact: c, seniorityScore: seniorityScore(c.title) });
      if (out === 'inserted') added++;
      else if (out === 'updated') updated++;
    }
    const contacts = await all(
      'SELECT * FROM job_contacts WHERE job_id = $1 AND user_id = $2 AND email IS NOT NULL ORDER BY seniority_score DESC, created_at DESC',
      [job.id, req.user.id],
    );

    const sources = [...new Set(result.candidates.map(c => c.source))].join(', ');
    const parts = [];
    if (result.candidates.length) parts.push(`+${added} new email${added === 1 ? '' : 's'}${updated ? `, ${updated} updated` : ''} at ${result.domain}${sources ? ` (via ${sources})` : ''}`);
    else parts.push(`No relevant emails found at ${result.domain}`);
    if (result.filteredOut) parts.push(`${result.filteredOut} non-engineering/recruiting contact${result.filteredOut === 1 ? '' : 's'} skipped`);
    if (!result.domainVerified) parts.push(`domain ${result.domain} was inferred — set it on the company if it's wrong`);
    if (result.cachedFrom?.length) parts.push(`reused a recent ${result.cachedFrom.join('/')} search — no credits spent`);
    if (result.reasons.length) parts.push(describeReasons(result.reasons));

    res.json({
      added, updated,
      found: result.candidates.length,
      total: result.candidates.length + result.filteredOut,
      filteredOut: result.filteredOut,
      domain: result.domain,
      domainSource: result.domainSource,
      domainVerified: result.domainVerified,
      pattern: result.pattern,
      tried: result.tried,
      reasons: result.reasons,
      contacts,
      message: parts.join(' · '),
      ...(result.candidates.length === 0 && result.filteredOut > 0 && {
        hint: 'all_filtered',
        hintText: `Found ${result.filteredOut} contact${result.filteredOut === 1 ? '' : 's'} but none are engineering or recruiting roles — try "Find People" to search LinkedIn`,
      }),
    });
  });
});

// ── Find email for one contact ───────────────────────────────────────────────
const LOOKUP_RETRY_DAYS = 7;

router.post('/contacts/:contactId/find-email', async (req, res) => {
  const contact = await one(`
    SELECT jc.*, j.name AS company_name, j.domain AS job_domain, j.url AS job_url, j.domain_source AS job_domain_source
    FROM job_contacts jc JOIN jobs j ON j.id = jc.job_id AND j.user_id = $2
    WHERE jc.id = $1 AND jc.user_id = $2
  `, [req.params.contactId, req.user.id]);
  if (!contact) return res.status(404).json({ error: 'Contact not found' });
  const force = Boolean(req.body?.force);

  if (!force && contact.email && ['valid', 'risky'].includes(contact.email_status)) {
    return res.json({ email: contact.email, email_status: contact.email_status, contact, cached: true });
  }
  const lastLookup = contact.email_lookup_at ? new Date(contact.email_lookup_at).getTime() : 0;
  if (!force && !contact.email && lastLookup && Date.now() - lastLookup < LOOKUP_RETRY_DAYS * 86_400_000) {
    return res.json({
      email: null, cached: true, contact,
      message: `${contact.email_lookup_note || 'No email found last time.'} (looked up ${new Date(lastLookup).toLocaleDateString()} — retry to spend credits again)`,
    });
  }

  await withLock(`email:${req.user.id}:${contact.id}`, res, async () => {
    const job = { name: contact.company_name, domain: contact.job_domain, url: contact.job_url, domain_source: contact.job_domain_source };
    const r = await findPersonEmail(contact, job, { userId: req.user.id });
    const note = r.best ? null : [`No email found${r.tried.length ? ` (tried ${r.tried.join(', ')})` : ''}.`, describeReasons(r.reasons)].filter(Boolean).join(' ');

    if (r.best) {
      await run(`UPDATE job_contacts SET email = $1, email_status = $2, email_confidence = $3,
                   source = COALESCE(NULLIF(source, ''), $4), email_lookup_at = NOW(), email_lookup_note = NULL
                 WHERE id = $5 AND user_id = $6`,
        [r.best.email, r.best.status, r.best.confidence, r.best.source, contact.id, req.user.id]);
    } else {
      await run('UPDATE job_contacts SET email_lookup_at = NOW(), email_lookup_note = $1 WHERE id = $2 AND user_id = $3', [note, contact.id, req.user.id]);
    }
    const updated = await one('SELECT * FROM job_contacts WHERE id = $1 AND user_id = $2', [contact.id, req.user.id]);
    res.json({
      email: r.best?.email || null,
      email_status: r.best?.status || null,
      confidence: r.best?.confidence ?? null,
      source: r.best?.source || null,
      domain: r.domain,
      contact: updated,
      triedSources: r.tried,
      reasons: r.reasons,
      ...(note ? { message: note } : {}),
    });
  });
});

// ── Generate outreach for a contact ──────────────────────────────────────────

router.post('/contacts/:contactId/generate', async (req, res) => {
  try {
    const contact = await one(`
      SELECT jc.*, j.name as company_name, j.category as company_type
      FROM job_contacts jc
      JOIN jobs j ON j.id = jc.job_id AND j.user_id = $2
      WHERE jc.id = $1 AND jc.user_id = $2
    `, [req.params.contactId, req.user.id]);
    if (!contact) return res.status(404).json({ error: 'Contact not found' });

    const { type = 'email', extraContext = '' } = req.body;

    const params = {
      recipientName:   contact.name,
      recipientTitle:  contact.title || 'Decision Maker',
      companyName:     contact.company_name,
      companyCategory: contact.company_type,
      isRecruiter:     /recruit|talent|people|hr\b|human resources/i.test(contact.title || ''),
      extraContext,
      sender:          await loadSenderProfile(req.user.id),
      customTemplates: await loadUserTemplates(req.user.id),
    };

    if (type === 'linkedin') {
      const result = await generateOutreach({ ...params, type: 'linkedin' });
      const dm = result.message || result.body || '';
      await run("UPDATE job_contacts SET generated_dm = $1, status = 'generated' WHERE id = $2 AND user_id = $3", [dm, contact.id, req.user.id]);
      return res.json({ message: dm, dm });
    } else {
      const result = await generateOutreach({ ...params, type: 'cold_email' });
      await run(
        "UPDATE job_contacts SET generated_subject = $1, generated_body = $2, status = 'generated' WHERE id = $3 AND user_id = $4",
        [result.subject, result.body, contact.id, req.user.id]
      );
      return res.json({ subject: result.subject, body: result.body });
    }
  } catch (err) {
    console.error('generate contact error:', err.message);
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ── Update contact (save edits / status) ──────────────────────────────────────

router.put('/contacts/:contactId', async (req, res) => {
  try {
    const { status, generated_dm, generated_subject, generated_body } = req.body || {};
    const CONTACT_STATUSES = ['pending', 'generated', 'sent', 'email_sent', 'dm_sent', 'replied', 'closed', 'skip'];
    if (status && !CONTACT_STATUSES.includes(status)) return res.status(400).json({ error: `Unknown status "${status}"` });
    let email = req.body?.email;
    if (email !== undefined && email !== null && email !== '') {
      email = String(email).trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'That doesn\'t look like an email address' });
    } else email = null;
    const r = await run(`
      UPDATE job_contacts SET
        status            = COALESCE($1, status),
        generated_dm      = COALESCE($2, generated_dm),
        generated_subject = COALESCE($3, generated_subject),
        generated_body    = COALESCE($4, generated_body),
        -- A hand-edited address hasn't been verified by anyone.
        email_status      = CASE WHEN $5::text IS NOT NULL AND lower($5) IS DISTINCT FROM lower(email) THEN 'unverified' ELSE email_status END,
        email             = COALESCE($5, email)
      WHERE id = $6 AND user_id = $7
    `, [
      status || null, generated_dm || null,
      generated_subject || null, generated_body || null,
      email, req.params.contactId, req.user.id
    ]);
    if (!r.rowCount) return res.status(404).json({ error: 'Contact not found' });
    res.json(await one('SELECT * FROM job_contacts WHERE id = $1 AND user_id = $2', [req.params.contactId, req.user.id]));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Delete a contact ──────────────────────────────────────────────────────────

router.delete('/contacts/:contactId', async (req, res) => {
  try {
    const r = await run('DELETE FROM job_contacts WHERE id = $1 AND user_id = $2', [req.params.contactId, req.user.id]);
    if (!r.rowCount) return res.status(404).json({ error: 'Contact not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Scrape people from a company's LinkedIn page ──────────────────────────────

router.post('/:id/scrape-linkedin-company', async (req, res) => {
  try {
    const job = await one('SELECT * FROM jobs WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
    if (!job) return res.status(404).json({ error: 'Company not found' });

    const { linkedinUrl } = req.body;

    // Save the LinkedIn company URL if provided
    if (linkedinUrl) {
      await run('UPDATE jobs SET linkedin_company_url = $1 WHERE id = $2 AND user_id = $3', [linkedinUrl, job.id, req.user.id]);
    }

    const urlToUse = linkedinUrl || job.linkedin_company_url || null;

    const people = await apify.findPeopleAtLinkedInCompany(job.name, urlToUse, await trustedDomain(job), null, { userId: req.user.id });
    const { added } = await savePeople(job, people, req.user.id, 8);

    const contacts = await all(
      'SELECT * FROM job_contacts WHERE job_id = $1 AND user_id = $2 ORDER BY created_at DESC',
      [job.id, req.user.id]
    );

    res.json({ added, contacts, linkedinUrl: urlToUse });
  } catch (err) {
    console.error('scrape-linkedin-company error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
