/**
 * multiSourceScraper.js — daily role catalog populator.
 *
 * Hits every supported source, normalizes results to a common shape, dedupes
 * by `apply_url`, and upserts into the public.scraped_roles table.
 *
 * Sources covered (v1):
 *   - greenhouse / lever / ashby   (reuse scanGreenhouse/Lever/Ashby in careerOps.js)
 *   - linkedin / wellfound          (Apify — burns quota; returns 0 if exhausted)
 *   - ai_jobs                       (https://ai-jobs.net  — public listing)
 *   - jobspresso                    (RSS feed)
 *   - remote_rocketship             (HTML scrape)
 *   - internshipdaily               (HTML scrape — internshipdaily.com)
 *
 * Each per-source function returns an array of:
 *   { title, company_name, location, apply_url, source, role_type, posted_at, description }
 *
 * Failures in one source never block the others — every call is isolated.
 *
 * Wired up by server.js daily cron at 06:00 UTC; toggle off via
 * `MULTI_SCRAPE_DISABLED` env var.
 */

import { fetchSpeedyApplyListings } from './speedyApply.js';
import { fetchJobSpyRoles } from './jobSpy.js';
import { regionForRole } from './markets.js';
import * as cheerio from 'cheerio';
import { all, run } from '../db.js';
import { scanGreenhouse, scanLever, scanAshby } from '../routes/careerOps.js';

// ── Role-type classification (same heuristic as the rest of the app) ─────────
const INTERN_PATTERN  = /\b(intern|internship|co-?op|co\s*op|summer\s*\d{4}|spring\s*\d{4}|fall\s*\d{4})\b/i;
// Tightened to avoid false positives. The previous pattern accepted bare
// "graduate" (matches "Graduate Research Engineer" — senior) and bare
// "associate" (matches "Associate Director", "Sales Associate", etc.). Now
// "graduate" only counts when preceded by "new" / "recent", and "associate"
// requires explicit software/engineer pairing.
const NEW_GRAD_PATTERN = /\b(new\s*grad|recent\s*grad|new\s*graduate|recent\s*graduate|early\s*career|entry[-\s]?level|jr\.?|junior)\b/i;
const ASSOCIATE_ENG_PATTERN = /\bassociate\s+(software|engineer|developer|data|ml|machine|ai)\b/i;
// Seniority markers — a real internship/new-grad role never carries these.
// Used to keep senior/lead/manager/architect titles out of the new-grad pile.
const SENIOR_PATTERN = /\b(senior|sr\.?|staff|principal|lead|director|vp|vice\s*president|head\s+of|manager|mgr|architect|distinguished|fellow|expert)\b/i;
// Non-roles that occasionally appear in curated lists — events, sessions, etc.
// (Residency/Fellowship are real paid roles, so they're intentionally NOT here.)
export const NON_ROLE_PATTERN = /\b(networking\s*event|info(rmation)?\s*session|webinar|open\s*house|career\s*fair|job\s*fair|hiring\s*event|recruit(ing|ment)\s*event|virtual\s*event|meet\s*&?\s*greet|interest\s*form|talent\s*(community|network|pool)|coffee\s*chat)\b/i;

// Reject titles that contain CJK, Arabic, Cyrillic, or other non-Latin scripts.
// ai-jobs.net sometimes returns Chinese-language listings; filter them out so
// only English-readable titles reach the database.
function isEnglishTitle(title = '') {
  if (!title) return false;
  // Unicode ranges for scripts we want to reject:
  //   CJK Unified/Compat, Hiragana, Katakana, Hangul, Arabic, Devanagari,
  //   Thai, Cyrillic (broad), Hebrew, etc.
  const nonLatin = (title.match(/[Ѐ-ӿ؀-ۿऀ-ॿ฀-๿぀-ヿ㐀-䶿一-鿿가-힯]/g) || []).length;
  return nonLatin / title.length < 0.1;
}

export function classifyRoleType(title = '') {
  const t = String(title).toLowerCase();
  if (INTERN_PATTERN.test(t)) return 'intern';       // an internship is never "senior"
  if (SENIOR_PATTERN.test(t)) return null;           // senior/lead/manager/architect → not new-grad
  if (NEW_GRAD_PATTERN.test(t)) return 'new_grad';
  if (ASSOCIATE_ENG_PATTERN.test(t)) return 'new_grad';
  return null; // doesn't match either — skip
}

// Some sources return company tokens like "stripe" — pretty-print to "Stripe".
function prettyCompany(token) {
  if (!token) return '';
  return String(token).replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

// US-only filter (mirrors the rest of the codebase). Matches isUSLocation
// behavior: empty / "remote" / "anywhere" / "us" → keep; any non-US country
// token → drop. Keeps the filter consistent with our site-wide US-only scope.
const NON_US = /\b(canada|toronto|vancouver|montreal|uk|united kingdom|london|england|scotland|ireland|dublin|france|paris|germany|berlin|munich|spain|madrid|barcelona|italy|rome|netherlands|amsterdam|sweden|stockholm|denmark|copenhagen|finland|norway|portugal|lisbon|switzerland|zurich|zurich|austria|vienna|poland|warsaw|czech|prague|hungary|budapest|greece|athens|turkey|istanbul|israel|tel aviv|uae|dubai|saudi|riyadh|qatar|doha|egypt|cairo|south africa|cape town|johannesburg|nigeria|lagos|kenya|nairobi|india|bangalore|bengaluru|hyderabad|delhi|mumbai|pune|chennai|kolkata|gurgaon|noida|sri lanka|colombo|pakistan|karachi|lahore|china|beijing|shanghai|shenzhen|hong kong|taiwan|taipei|japan|tokyo|osaka|kyoto|south korea|seoul|busan|singapore|malaysia|kuala lumpur|indonesia|jakarta|philippines|manila|thailand|bangkok|vietnam|hanoi|ho chi minh|australia|sydney|melbourne|brisbane|perth|new zealand|auckland|wellington|brazil|sao paulo|rio|argentina|buenos aires|chile|santiago|colombia|bogota|peru|lima|mexico|mexico city|emea|apac|latam|europe|asia|oceania|africa|middle east)\b/i;
function isUSish(loc = '') {
  if (!loc) return true;
  const s = String(loc).toLowerCase().trim();
  if (!s) return true;
  if (/^(remote|anywhere|us\s*remote|usa|us|united states|america)$/i.test(s)) return true;
  if (NON_US.test(s)) return false;
  return true;
}

// ── 1. Greenhouse / Lever / Ashby ─────────────────────────────────────────────
//    These already exist as portal scanners in careerOps.js. Just call them
//    twice — once per role type — and reshape.

async function scrapePortals(roleTypeQuery /* 'intern' | 'fulltime' */) {
  const out = [];
  const [gh, lv, ash] = await Promise.allSettled([
    scanGreenhouse(roleTypeQuery),
    scanLever(roleTypeQuery),
    scanAshby(roleTypeQuery),
  ]);
  for (const r of [gh, lv, ash]) {
    if (r.status !== 'fulfilled' || !Array.isArray(r.value)) continue;
    for (const job of r.value) {
      const role_type = classifyRoleType(job.title);
      if (!role_type) continue;
      out.push({
        title:        job.title,
        company_name: prettyCompany(job.company),
        location:     job.location || '',
        apply_url:    job.applyUrl,
        source:       job.source,                    // 'greenhouse' | 'lever' | 'ashby'
        role_type,
        posted_at:    job.postedAt || null,
        description:  null,
      });
    }
  }
  return out;
}

// ── 2. LinkedIn (via Apify) ───────────────────────────────────────────────────
//    scrapeLinkedInJobs returns company-shaped rows but each carries a
//    `careersUrl` which is actually the role URL. Re-shape.


// ── 3. Wellfound (via Apify) ──────────────────────────────────────────────────


// ── 4. ai-jobs.net  ──────────────────────────────────────────────────────────
//    Public HTML listing. Each card has the company, role, location, and a
//    `/job/<id>` URL that we treat as the apply URL.

async function scrapeAiJobs(roleType /* 'intern' | 'new_grad' */) {
  const url = roleType === 'intern'
    ? 'https://ai-jobs.net/?reg=4&cat=18&type=4'   // category=internship, region=USA
    : 'https://ai-jobs.net/?reg=4&cat=18&type=1';  // category=full-time
  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 OutreachOS/1.0' },
      signal:  AbortSignal.timeout(10000),
    });
    if (!r.ok) return [];
    const html = await r.text();
    const $ = cheerio.load(html);
    const out = [];
    $('a[href*="/job/"]').each((_, el) => {
      const href = $(el).attr('href');
      if (!href) return;
      const apply_url = href.startsWith('http') ? href : `https://ai-jobs.net${href}`;
      const title = $(el).find('h5, h6, .job-title, strong').first().text().trim() || $(el).text().trim().slice(0, 120);
      if (!title) return;
      const card = $(el).closest('li, .list-group-item, .col, .card');
      const company = card.find('.text-muted, .small').first().text().trim() || '';
      const location = card.find('.location, [class*="location"]').first().text().trim() || '';
      // Drop titles that don't match either pattern. Previously the fallback
      // defaulted to whatever role type was requested, which let senior /
      // unrelated roles slip into the new_grad pile when the source page
      // returned a mixed bag.
      const role_type = classifyRoleType(title);
      if (!role_type || role_type !== roleType) return;
      out.push({
        title,
        company_name: company,
        location,
        apply_url,
        source: 'ai_jobs',
        role_type,
        posted_at: null,
        description: null,
      });
    });
    return out.filter(r => r.company_name);
  } catch (err) {
    console.warn(`[multi-scrape] ai_jobs failed: ${err.message}`);
    return [];
  }
}

// ── 5. Jobspresso (RSS) ──────────────────────────────────────────────────────

async function scrapeJobspresso(roleType) {
  const feed = roleType === 'intern'
    ? 'https://jobspresso.co/feed/?job_types=intern'
    : 'https://jobspresso.co/feed/?job_types=full-time';
  try {
    const r = await fetch(feed, { signal: AbortSignal.timeout(10000) });
    if (!r.ok) return [];
    const xml = await r.text();
    const $ = cheerio.load(xml, { xmlMode: true });
    const out = [];
    $('item').each((_, el) => {
      const $el = $(el);
      const title    = $el.find('title').first().text().trim();
      const link     = $el.find('link').first().text().trim() || $el.find('guid').first().text().trim();
      const pubDate  = $el.find('pubDate').first().text().trim();
      const category = $el.find('category').map((_, c) => $(c).text().trim()).get().join(', ');
      // Title format: "Job Title at Company"
      const match = /^(.+?)\s+(?:at|@)\s+(.+?)$/i.exec(title) || [];
      const role    = match[1] || title;
      const company = match[2] || '';
      const role_type = classifyRoleType(role);
      if (!role_type || role_type !== roleType) return;
      out.push({
        title:        role,
        company_name: company,
        location:     category.match(/(remote|anywhere|usa|united states|us)/i)?.[0] || 'Remote',
        apply_url:    link,
        source:       'jobspresso',
        role_type,
        posted_at:    pubDate ? new Date(pubDate).toISOString() : null,
        description:  null,
      });
    });
    return out.filter(r => r.apply_url && r.company_name);
  } catch (err) {
    console.warn(`[multi-scrape] jobspresso failed: ${err.message}`);
    return [];
  }
}

// ── 6. Remote Rocketship ──────────────────────────────────────────────────────
//    HTML listings page. Cloudflare-fronted; respects standard UA.

async function scrapeRemoteRocketship(roleType) {
  const url = roleType === 'intern'
    ? 'https://www.remoterocketship.com/?usaJobs=true&category=Internship'
    : 'https://www.remoterocketship.com/?usaJobs=true&category=Software Engineering&seniority=Entry';
  try {
    const r = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept':     'text/html',
      },
      signal: AbortSignal.timeout(12000),
    });
    if (!r.ok) return [];
    const html = await r.text();
    const $ = cheerio.load(html);
    const out = [];
    $('a[href^="/jobs/"], a[href*="/job/"]').each((_, el) => {
      const href = $(el).attr('href');
      if (!href) return;
      const apply_url = href.startsWith('http') ? href : `https://www.remoterocketship.com${href}`;
      const cardText = $(el).text().replace(/\s+/g, ' ').trim();
      // Cards encode "Title — Company — Location"
      const parts = cardText.split(/[—|·•|—]/).map(s => s.trim()).filter(Boolean);
      if (parts.length < 2) return;
      const title   = parts[0];
      const company = parts[1] || '';
      const location = parts[2] || 'Remote';
      const role_type = classifyRoleType(title);
      if (!role_type || role_type !== roleType) return;
      out.push({
        title, company_name: company, location, apply_url,
        source: 'remote_rocketship', role_type, posted_at: null, description: null,
      });
    });
    return out.filter(r => r.company_name);
  } catch (err) {
    console.warn(`[multi-scrape] remote_rocketship failed: ${err.message}`);
    return [];
  }
}

// ── 7. InternshipDaily.com  ───────────────────────────────────────────────────

async function scrapeInternshipDaily(roleType) {
  // The site posts internships; the "new grad" page is /new-grad-jobs/
  const url = roleType === 'intern'
    ? 'https://internshipdaily.com/internships/'
    : 'https://internshipdaily.com/new-grad-jobs/';
  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 OutreachOS/1.0' },
      signal:  AbortSignal.timeout(10000),
    });
    if (!r.ok) return [];
    const html = await r.text();
    const $ = cheerio.load(html);
    const out = [];
    $('article a[href], h2 a[href], h3 a[href]').each((_, el) => {
      const href = $(el).attr('href');
      const text = $(el).text().trim();
      if (!href || !text || text.length < 5) return;
      // Filter to job posts (not category/tag links)
      if (!/\b(internship|engineer|analyst|developer|intern|2025|2026|new grad)\b/i.test(text)) return;
      // Title format on this site: "Company — Role Title" or "Role at Company"
      const splitDash = text.split(/\s*[–—\-]\s*/);
      const splitAt   = text.split(/\s+at\s+/i);
      let title = text, company = '';
      if (splitAt.length === 2) { title = splitAt[0].trim(); company = splitAt[1].trim(); }
      else if (splitDash.length >= 2) { company = splitDash[0].trim(); title = splitDash.slice(1).join(' - ').trim(); }
      const role_type = classifyRoleType(title);
      if (!role_type || role_type !== roleType) return;
      out.push({
        title,
        company_name: company,
        location:     'United States',
        apply_url:    href.startsWith('http') ? href : `https://internshipdaily.com${href}`,
        source:       'internshipdaily',
        role_type,
        posted_at:    null,
        description:  null,
      });
    });
    // Dedupe on this source's URLs (page may link the same post twice)
    const seen = new Set();
    return out.filter(r => {
      if (!r.company_name) return false;
      if (seen.has(r.apply_url)) return false;
      seen.add(r.apply_url); return true;
    });
  } catch (err) {
    console.warn(`[multi-scrape] internshipdaily failed: ${err.message}`);
    return [];
  }
}

// ── 8. speedyapply (GitHub) — curated SWE + AI college-jobs lists ─────────────
//    Parsed by services/speedyApply.js (mirrors their generator; keeps salary,
//    posting age, company site and FAANG+/Quant tier). Fetched once per run —
//    one request set returns both internships and new-grad rows.
let speedyApplyRun = null;
function speedyApplyRows(roleType) {
  speedyApplyRun ??= fetchSpeedyApplyListings();
  return speedyApplyRun.then(r => r.rows.filter(row => row.role_type === roleType));
}

// ── Orchestrator ──────────────────────────────────────────────────────────────

const SOURCE_FNS = {
  speedyapply:       (rt) => speedyApplyRows(rt),
  portals:           (rt) => scrapePortals(rt === 'intern' ? 'intern' : 'fulltime'),
  // Indeed + LinkedIn job listings via JobSpy (free). Apify is no longer used
  // for job listings — it burned the monthly budget; it's kept for people search.
  jobspy:            (rt) => fetchJobSpyRoles(rt).then(r => r.rows),
  jobspy_india:      (rt) => fetchJobSpyRoles(rt, { market: 'india' }).then(r => r.rows),
  remote_rocketship: (rt) => scrapeRemoteRocketship(rt),
  // Pruned: ai_jobs (persistent "fetch failed"), jobspresso + internshipdaily
  // (persistent timeouts). speedyapply now provides the clean primary feed.
};

async function runOneSource(name, roleType) {
  try {
    const rows = await SOURCE_FNS[name](roleType);
    return { name, ok: true, count: rows.length, rows };
  } catch (err) {
    return { name, ok: false, count: 0, rows: [], error: err.message };
  }
}

/**
 * Run every scraper for every role type, dedupe on apply_url, and upsert.
 * Returns a per-source summary `{ source: { intern, new_grad } }` plus totals.
 */
/** Keep a scraped row? (language, not an event, US-ish location) */
function keepRole(role) {
  if (!role.apply_url || !role.title || !role.company_name) return false;
  if (!isEnglishTitle(role.title)) return false;    // drop non-English (CJK etc.) listings
  if (NON_ROLE_PATTERN.test(role.title)) return false; // drop events / webinars / info sessions
  // International and India rows are kept on purpose; everything else must look US.
  return role.region === 'intl' || role.region === 'india' || isUSish(role.location);
}

const UPSERT_CHUNK = 200;

// AI/ML vs SWE for sources that don't say (SpeedyApply rows carry their list).
const AI_TITLE = /\b(ai|a\.i\.|ml|machine learning|deep learning|data scien\w*|llms?|nlp|computer vision|generative|genai|research scientist|applied scientist|reinforcement learning|robot learning)\b/i;
export function classifyTracks(role) {
  if (Array.isArray(role.tracks) && role.tracks.length) return role.tracks;
  return [AI_TITLE.test(role.title || '') ? 'ai' : 'swe'];
}

/**
 * Upsert catalog rows in chunks (one multi-row statement per 200). The DB is
 * in another region from the server, so the old one-statement-per-row loop
 * made a ~3,000-row refresh take ~10 minutes.
 * @returns {Promise<number>} rows written
 */
export async function persistCatalogRows(rows) {
  let written = 0;
  for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
    const chunk = rows.slice(i, i + UPSERT_CHUNK);
    const params = [];
    const values = chunk.map((role, j) => {
      const b = j * 13;
      params.push(
        role.role_type,
        String(role.title).slice(0, 500),
        String(role.company_name).slice(0, 200),
        role.location ? String(role.location).slice(0, 200) : null,
        String(role.apply_url).slice(0, 1000),
        role.source,
        role.description ? String(role.description).slice(0, 4000) : null,
        role.posted_at || null,
        role.salary_range ? String(role.salary_range).slice(0, 100) : null,
        role.company_url ? String(role.company_url).slice(0, 500) : null,
        role.tier || null,
        regionForRole(role),
        classifyTracks(role),
      );
      return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}, $${b + 7}, $${b + 8}, $${b + 9}, $${b + 10}, $${b + 11}, $${b + 12}, $${b + 13}::text[], NOW(), NOW(), 1)`;
    });
    try {
      const r = await run(
        `INSERT INTO scraped_roles
           (role_type, title, company_name, location, apply_url, source, description, posted_at, salary_range, company_url, tier, region, tracks, scraped_at, last_seen_at, is_active)
         VALUES ${values.join(', ')}
         ON CONFLICT (apply_url) DO UPDATE
           SET last_seen_at = NOW(),
               is_active    = 1,
               title        = EXCLUDED.title,
               company_name = EXCLUDED.company_name,
               location     = EXCLUDED.location,
               description  = COALESCE(EXCLUDED.description,  scraped_roles.description),
               -- Age-derived dates drift by hours run to run; keep the earliest.
               posted_at    = LEAST(scraped_roles.posted_at, EXCLUDED.posted_at),
               salary_range = COALESCE(EXCLUDED.salary_range, scraped_roles.salary_range),
               company_url  = COALESCE(EXCLUDED.company_url,  scraped_roles.company_url),
               tier         = COALESCE(EXCLUDED.tier,         scraped_roles.tier),
               region       = EXCLUDED.region,
               tracks       = EXCLUDED.tracks`,
        params,
      );
      written += r.rowCount || 0;
    } catch (err) {
      console.warn(`[multi-scrape] chunk upsert failed (${chunk.length} rows): ${err.message}`);
    }
  }
  return written;
}

async function deactivateStaleRows() {
  // Haven't been seen by any source in 14 days → no longer listed.
  await run(
    `UPDATE scraped_roles SET is_active = 0
      WHERE is_active = 1 AND last_seen_at < NOW() - INTERVAL '14 days'`
  ).catch(() => {});
}

export async function scrapeAllSourcesAndPersist() {
  const summary = { total: 0, inserted: 0, updated: 0, perSource: {}, errors: {} };
  const seen = new Set();
  const keep = [];
  speedyApplyRun = null; // fresh fetch each run

  for (const roleType of ['intern', 'new_grad']) {
    const results = await Promise.all(
      Object.keys(SOURCE_FNS).map(name => runOneSource(name, roleType))
    );
    for (const result of results) {
      summary.perSource[result.name] = summary.perSource[result.name] || { intern: 0, new_grad: 0 };
      summary.perSource[result.name][roleType] = result.count;
      if (result.error) summary.errors[result.name] = result.error;
      for (const role of result.rows) {
        if (!keepRole(role) || seen.has(role.apply_url)) continue; // intra-run dedupe
        seen.add(role.apply_url);
        keep.push(role);
      }
    }
  }
  summary.total = keep.length;
  summary.inserted = await persistCatalogRows(keep);
  await deactivateStaleRows();
  return summary;
}

/**
 * SpeedyApply only — run right after their 12:00 UTC daily update so the
 * catalog has the new list the same day (the full multi-source scrape runs
 * at 06:15 UTC, before they publish).
 */
export async function syncSpeedyApply() {
  const { rows, repos, files } = await fetchSpeedyApplyListings();
  const seen = new Set();
  const keep = rows.filter(r => keepRole(r) && !seen.has(r.apply_url) && seen.add(r.apply_url));
  const written = await persistCatalogRows(keep);
  return { repos, files, parsed: rows.length, kept: keep.length, written };
}
