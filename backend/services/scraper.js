import { ApifyClient } from 'apify-client';
import { noteApifyError, getApifyQuotaBurn } from './apify.js';

// Lazy accessor — dotenv must load before first call
function getApifyToken() { return process.env.APIFY_API_TOKEN || ''; }
function getApifyClient() { return new ApifyClient({ token: getApifyToken() }); }

// ─── ATS company configs ──────────────────────────────────────────────────────

const GREENHOUSE_TOKENS = [
  'stripe', 'airbnb', 'dropbox', 'robinhood', 'figma', 'coinbase', 'plaid',
  'brex', 'ramp', 'notion', 'linear', 'vercel', 'retool', 'cursor',
  'anthropic', 'openai', 'scale', 'databricks', 'snowflake', 'hashicorp',
  'twilio', 'datadog', 'cloudflare', 'fastly', 'sendgrid', 'segment',
  'mixpanel', 'amplitude', 'benchling', 'asana', 'box',
  'reddit', 'pinterest', 'lyft', 'squarespace', 'etsy',
  'zendesk', 'hubspot', 'intercom', 'freshworks', 'clickup',
  'palantir', 'anduril', 'samsara', 'weave', 'lacework',
  'wayfair', 'carvana', 'opendoor', 'convoy', 'flatiron', 'tempus',
  'gusto', 'rippling', 'lattice', 'personio', 'workos',
  'nerdio', 'pagerduty', 'victorops', 'mimecast', 'carbonblack',
];

const LEVER_COMPANIES = [
  'netflix', 'atlassian', 'reddit', 'duolingo', 'airtable', 'benchling',
  'carta', 'flexport', 'lattice', 'persona', 'rippling',
  'figma', 'klaviyo', 'canva', 'hubspot', 'zendesk', 'intercom',
  'mixpanel', 'amplitude', 'brex', 'ramp', 'plaid',
  'chime', 'affirm', 'marqeta', 'checkout',
  'cloudflare', 'fastly', 'zscaler', 'crowdstrike',
  'databricks', 'snowflake', 'airbyte', 'fivetran', 'prefect',
  'notion', 'coda', 'asana', 'clickup', 'height',
  'retool', 'vercel', 'netlify', 'supabase', 'neon',
];

const ASHBY_COMPANIES = [
  'linear', 'vercel', 'retool', 'cursor', 'turso', 'neon',
  'pitch', 'coda', 'hex', 'replit', 'railway', 'render',
  'resend', 'cal', 'raycast', 'supabase', 'fly', 'clerk',
  'convex', 'trigger', 'inngest', 'upstash',
  'axiom', 'highlight', 'posthog', 'june', 'june-so',
  'remote', 'deel', 'mercury', 'brex', 'ramp',
  'deno', 'bun-sh', 'liveblocks', 'partykit',
];

// ─── CS dept / intern title filters ──────────────────────────────────────────

const CS_DEPTS  = /engineering|software|data|machine.?learning|\bml\b|infrastructure|platform|backend|frontend|systems|sre|devops|security|ai\b|research|analytics|cloud/i;
const INTERN_RE = /\bintern(?:s|ship|ships)?\b/i;

// ─── USA-only location filter ─────────────────────────────────────────────────
// Drop results from non-US countries. Actors regularly leak Toronto/Bangalore/
// London/Dublin/etc even when the input asks for "United States". Strategy:
//   1. Anything explicitly non-US (country name or non-US country code) → drop
//   2. Anything explicitly US (state name, US city, "Remote US", "USA") → keep
//   3. Empty / "Remote" / unknown → keep (assume US since query was US-targeted)
const NON_US_TOKENS = /\b(canada|toronto|vancouver|montreal|ottawa|calgary|waterloo|mississauga|edmonton|quebec|brampton|surrey|halifax|saskatoon|winnipeg|burnaby|markham|richmond hill|brampton|guelph|kitchener|ontario|alberta|british columbia|manitoba|saskatchewan|nova scotia|new brunswick|newfoundland|prince edward island|yukon|northwest territories|nunavut|\bon, ca\b|\bbc, ca\b|\bab, ca\b|\bqc, ca\b|united kingdom|england|britain|\buk\b|london|manchester|birmingham|liverpool|edinburgh|glasgow|bristol|leeds|cambridge|oxford|sheffield|cardiff|belfast|dublin|cork|galway|limerick|ireland|france|paris|lyon|marseille|toulouse|nice|nantes|strasbourg|montpellier|bordeaux|germany|berlin|munich|hamburg|frankfurt|cologne|stuttgart|düsseldorf|leipzig|netherlands|amsterdam|rotterdam|the hague|utrecht|eindhoven|belgium|brussels|antwerp|ghent|spain|madrid|barcelona|valencia|seville|bilbao|portugal|lisbon|porto|italy|rome|milan|naples|turin|florence|bologna|venice|switzerland|zurich|geneva|basel|bern|austria|vienna|salzburg|sweden|stockholm|gothenburg|malmö|denmark|copenhagen|aarhus|norway|oslo|bergen|trondheim|finland|helsinki|tampere|poland|warsaw|kraków|wrocław|gdańsk|czechia|prague|brno|hungary|budapest|romania|bucharest|cluj|iași|greece|athens|thessaloniki|bulgaria|sofia|turkey|istanbul|ankara|izmir|israel|tel aviv|jerusalem|haifa|herzliya|india|bangalore|bengaluru|mumbai|delhi|noida|gurgaon|gurugram|hyderabad|chennai|pune|kolkata|ahmedabad|jaipur|lucknow|kanpur|nagpur|indore|coimbatore|kochi|thiruvananthapuram|chandigarh|china|beijing|shanghai|shenzhen|guangzhou|chengdu|hangzhou|wuhan|nanjing|tianjin|hong kong|taiwan|taipei|kaohsiung|japan|tokyo|osaka|kyoto|yokohama|nagoya|sapporo|fukuoka|south korea|seoul|busan|incheon|singapore|malaysia|kuala lumpur|penang|johor bahru|indonesia|jakarta|surabaya|bandung|thailand|bangkok|chiang mai|vietnam|ho chi minh|hanoi|philippines|manila|cebu|davao|australia|sydney|melbourne|brisbane|perth|adelaide|canberra|hobart|new zealand|auckland|wellington|christchurch|dunedin|brazil|são paulo|rio de janeiro|brasília|salvador|fortaleza|belo horizonte|curitiba|porto alegre|argentina|buenos aires|córdoba|rosario|chile|santiago|valparaíso|colombia|bogotá|medellín|cali|peru|lima|mexico|mexico city|guadalajara|monterrey|puebla|tijuana|south africa|johannesburg|cape town|durban|pretoria|nigeria|lagos|abuja|kenya|nairobi|egypt|cairo|alexandria|uae|dubai|abu dhabi|saudi arabia|riyadh|jeddah|qatar|doha|kuwait|kuwait city|bahrain|manama|jordan|amman|lebanon|beirut|pakistan|karachi|lahore|islamabad|bangladesh|dhaka|sri lanka|colombo|nepal|kathmandu)\b/i;
function isUSLocation(loc) {
  if (!loc) return true;
  const s = String(loc).toLowerCase().trim();
  if (!s) return true;
  // Common "remote" variants → assume US since query was US-targeted
  if (/^(remote|anywhere|us remote|usa|united states|us only|remote, usa|remote - us|remote \(us\))$/.test(s)) return true;
  // Explicit non-US match
  if (NON_US_TOKENS.test(s)) return false;
  return true;
}

// ─── Search terms per subcategory ─────────────────────────────────────────────

const SEARCH_TERMS_MAP = {
  'Quant Funds':                   ['quantitative trader intern', 'quant researcher intern', 'algo trading intern', 'hft software engineer intern', 'quant developer intern'],
  'Hedge Funds':                   ['hedge fund software engineer intern', 'systematic trading intern', 'hedge fund tech intern'],
  'Investment Banks':              ['investment banking technology intern', 'securities software engineer intern', 'capital markets tech intern'],
  'Prop Trading Firms':            ['proprietary trading software intern', 'trading systems engineer intern'],
  'Fintech':                       ['fintech software engineer intern', 'payments engineer intern', 'financial technology intern'],
  'Payments & Payment Processors': ['payments software engineer intern', 'payment systems intern'],
  'Crypto Exchanges':              ['crypto software engineer intern', 'blockchain developer intern', 'web3 engineer intern'],
  'Blockchain Infrastructure':     ['blockchain infrastructure intern', 'web3 infrastructure intern', 'defi engineer intern'],
  'Asset Management':              ['asset management technology intern', 'portfolio analytics intern'],
  'Venture Capital':               ['venture capital software intern', 'vc data engineer intern'],
  'AI Labs':                       ['ai research intern', 'ml research intern', 'foundation model intern', 'llm engineer intern', 'ai safety intern'],
  'AI Infrastructure':             ['mlops intern', 'ml platform intern', 'ai infrastructure engineer intern', 'model serving intern'],
  'Applied AI':                    ['machine learning engineer intern', 'applied ai intern', 'nlp engineer intern', 'computer vision intern'],
  'Robotics AI':                   ['robotics software engineer intern', 'autonomous systems intern', 'robot perception intern'],
  'AI Chip Makers':                ['ai chip design intern', 'ml accelerator intern', 'neural chip engineer intern'],
  'Big Tech / FAANG':              ['software engineer intern 2026', 'new grad software engineer', 'swe intern big tech'],
  'Enterprise Software':           ['enterprise software engineer intern', 'b2b saas engineering intern'],
  'Cloud Providers':               ['cloud engineer intern', 'cloud infrastructure intern', 'platform engineer intern'],
  'Developer Tools':               ['developer tools engineer intern', 'devtools intern', 'sdk engineer intern', 'developer experience intern'],
  'Cybersecurity':                 ['security engineer intern', 'penetration testing intern', 'appsec intern', 'cybersecurity intern', 'information security intern'],
  'SaaS':                          ['saas software engineer intern', 'b2b software intern', 'product engineer intern'],
  'Semiconductor Manufacturers':   ['vlsi intern', 'chip design intern', 'semiconductor engineer intern', 'fpga intern', 'asic design intern', 'eda intern'],
  'Consumer Electronics':          ['hardware engineer intern', 'embedded software intern', 'firmware engineer intern'],
  'Networking Hardware':           ['network engineer intern', 'network software intern'],
  'Gaming':                        ['game engineer intern', 'gameplay engineer intern', 'game developer intern', 'game studio intern', 'unity developer intern'],
  'Streaming':                     ['streaming software engineer intern', 'video platform engineer intern'],
  'Social Media':                  ['social media platform engineer intern', 'feed algorithm intern'],
  'Ad Tech':                       ['ad tech engineer intern', 'advertising platform intern', 'programmatic advertising intern'],
  'Defense Contractors':           ['defense software engineer intern', 'aerospace software intern', 'dod software intern', 'embedded defense intern'],
  'GovTech / Defense Tech':        ['govtech engineer intern', 'government technology intern'],
  'Biotech':                       ['bioinformatics intern', 'computational biology intern', 'biotech software intern', 'genomics data intern'],
  'Pharma':                        ['pharmaceutical data intern', 'drug discovery ml intern', 'pharma software intern'],
  'Health Tech':                   ['health tech software intern', 'digital health engineering intern', 'healthcare platform intern'],
  'Medical Devices':               ['medical device software intern', 'embedded medical intern'],
  'Electric Vehicles':             ['autonomous vehicle software intern', 'ev software engineer intern', 'self-driving software intern'],
  'Aerospace & Space':             ['aerospace software intern', 'satellite software intern', 'space systems engineer intern'],
  'Data Infrastructure':           ['data engineer intern', 'data platform intern', 'analytics engineer intern', 'data pipeline intern'],
  'Business Intelligence Platforms':['business intelligence intern', 'bi engineer intern', 'analytics platform intern'],
  'EdTech':                        ['edtech software engineer intern', 'education technology intern', 'learning platform engineer intern'],
  'Climate Tech':                  ['climate tech software intern', 'clean energy software intern', 'sustainability tech intern'],
  'Renewables':                    ['renewable energy software intern', 'solar tech intern', 'clean energy data intern'],
  'E-Commerce':                    ['ecommerce software engineer intern', 'marketplace platform intern'],
  'Logistics & Supply Chain':      ['logistics software engineer intern', 'supply chain tech intern', 'last mile delivery intern'],
  // ── Startups ──────────────────────────────────────────────────────────────
  'YC Companies':                  ['yc startup software engineer intern', 'y combinator intern', 'yc company engineer intern 2026'],
  'Series A':                      ['series a startup software engineer intern', 'early stage startup engineer intern'],
  'Series B':                      ['series b startup software engineer intern', 'growth stage startup intern'],
  'Pre-Seed / Seed':               ['seed startup software engineer intern', 'pre-seed startup engineer intern'],
  'Dev Tools Startups':            ['developer tools startup intern', 'devtools startup engineer intern', 'dev infrastructure intern', 'sdk startup intern'],
  'AI Startups':                   ['ai startup software engineer intern', 'generative ai startup intern', 'llm startup engineer intern', 'ai product engineer intern'],
  'Fintech Startups':              ['fintech startup software engineer intern', 'neobank intern', 'payments startup engineer intern', 'financial startup intern'],
  'HealthTech Startups':           ['healthtech startup software engineer intern', 'digital health startup intern', 'health startup engineer intern'],
  'Climate Startups':              ['climate tech startup intern', 'cleantech startup engineer intern', 'green tech startup intern'],
  'Consumer Startups':             ['consumer startup software engineer intern', 'consumer app engineer intern', 'd2c startup intern'],
  'B2B SaaS Startups':             ['b2b saas startup intern', 'startup saas engineer intern', 'b2b software startup intern'],
  'Web3 Startups':                 ['web3 startup engineer intern', 'crypto startup software intern', 'defi startup intern', 'blockchain startup engineer intern'],
  'Marketplace Startups':          ['marketplace startup software intern', 'two-sided marketplace engineer intern', 'gig economy startup intern'],
  'Deep Tech Startups':            ['deep tech startup intern', 'biotech startup software intern', 'hardtech startup engineer intern', 'computational biology startup intern'],
};

export function getSearchTerms(category = '', subcategory = '') {
  // Search terms are intentionally role-agnostic by default so LinkedIn/Wellfound
  // pick up product, design, data, marketing, finance interns — not just SWE.
  // SEARCH_TERMS_MAP entries are role-specific by category (Quant Funds want
  // quantitative roles, etc.) and should still take precedence when set.
  if (SEARCH_TERMS_MAP[subcategory]) return SEARCH_TERMS_MAP[subcategory];
  if (subcategory) return [`${subcategory} intern 2026`, `${subcategory} internship`, `${subcategory} new grad 2026`];
  if (category)    return [`${category.split(/[&/]/)[0].trim()} intern 2026`, `${category.split(/[&/]/)[0].trim()} new grad 2026`];
  return ['intern 2026', 'internship 2026', 'new grad 2026'];
}

// ─── Location parser ──────────────────────────────────────────────────────────

const US_STATES = new Set([
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA',
  'KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
  'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT',
  'VA','WA','WV','WI','WY','DC',
]);

export function parseCity(location = '') {
  const l = (location || '').trim();
  if (!l || /^(usa|us|united states)$/i.test(l)) return { city: null, state: null, country: 'US' };
  if (/^remote$/i.test(l)) return { city: 'Remote', state: null, country: 'US' };

  // "City, ST" — take FIRST city/state pair (locations can be multi-city like "SF, NY, Seattle")
  const stateMatch = l.match(/^([^,]+),\s*([A-Z]{2})\b/);
  if (stateMatch && US_STATES.has(stateMatch[2])) {
    return { city: stateMatch[1].trim(), state: stateMatch[2], country: 'US' };
  }

  // "City, Country" for known international countries
  const intlMatch = l.match(/^([^,]+),\s*(Canada|UK|Germany|France|India|Australia|Singapore|Ireland|Netherlands|Switzerland|Sweden|Denmark|Finland|Norway)$/i);
  if (intlMatch) return { city: intlMatch[1].trim(), state: null, country: intlMatch[2] };

  // Single token that looks like a city name
  const firstPart = l.split(',')[0].trim();
  if (firstPart.length < 60) return { city: firstPart, state: null, country: 'US' };

  return { city: null, state: null, country: 'US' };
}

// ─── Normalizer ───────────────────────────────────────────────────────────────

function norm({ name, jobTitle = '', jobDescription = '', location = 'USA', careersUrl = '', source }) {
  const { city, state, country } = parseCity(location);
  return {
    name:           (name || '').trim().replace(/\s+/g, ' '),
    jobTitle:       jobTitle.trim(),
    jobDescription: jobDescription.replace(/<[^>]+>/g, '').slice(0, 500),
    location:       location.trim() || 'USA',
    city,
    state,
    country:        country || 'US',
    careersUrl:     careersUrl.trim(),
    source:         source || 'unknown',
    activelyHiring: true,
    category:       null,
    subcategory:    null,
    confidence:     null,
  };
}

// ─── Deduplication ────────────────────────────────────────────────────────────

function dedupe(listings) {
  const map = new Map();
  for (const item of listings) {
    if (!item.name || item.name.length < 2) continue;
    const key = item.name.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!key) continue;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, { ...item });
    } else {
      if (!existing.careersUrl && item.careersUrl) existing.careersUrl = item.careersUrl;
      if (item.jobDescription && item.jobDescription.length > (existing.jobDescription?.length || 0)) {
        existing.jobDescription = item.jobDescription;
      }
      if (!existing.jobTitle && item.jobTitle) existing.jobTitle = item.jobTitle;
      if (!existing.city && item.city) {
        existing.city = item.city;
        existing.state = item.state;
        existing.country = item.country;
      }
      const srcSet = new Set(existing.source.split(',').filter(Boolean));
      srcSet.add(item.source);
      existing.source = [...srcSet].join(',');
    }
  }
  return [...map.values()];
}

// ─── Apify actor runner with store-discovery fallback ─────────────────────────

async function findActorInStore(searchTerm) {
  try {
    const token = getApifyToken();
    if (!token) return null;
    const res = await fetch(
      `https://api.apify.com/v2/store?search=${encodeURIComponent(searchTerm)}&token=${token}&limit=10`,
      { signal: AbortSignal.timeout(6000) }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const items = data.data?.items || [];
    const best  = items.find(a => (a.stats?.totalRuns || 0) > 1000);
    if (best) {
      const id = `${best.username}/${best.name}`;
      console.log(`[apify-discovery] selected "${id}" (${best.stats.totalRuns} runs) for "${searchTerm}"`);
      return id;
    }
    return null;
  } catch (err) {
    console.error(`[apify-discovery] store search failed: ${err.message}`);
    return null;
  }
}

async function runApifyActor(actorId, input, storeSearchTerm, waitSecs = 90) {
  // Same 1h short-circuit as apify.js runActor: once the monthly hard limit
  // is hit, every further actor call fails identically — don't make them.
  const burn = getApifyQuotaBurn();
  if (burn && burn.ageMs < 60 * 60_000) {
    const err = new Error(`Apify quota exhausted (${burn.lastError || 'monthly limit'}) — skipping ${actorId} for now.`);
    err.code = 'APIFY_QUOTA_BURNED';
    throw err;
  }
  const client = getApifyClient();

  const tryRun = async (id) => {
    console.log(`[apify] running ${id}...`);
    const run = await client.actor(id).call(input, { waitSecs });
    console.log(`[apify] run ${run.id} → ${run.status}`);
    if (run.status !== 'SUCCEEDED') throw new Error(`Actor ${id} status: ${run.status}`);
    const { items } = await client.dataset(run.defaultDatasetId).listItems();
    console.log(`[apify] ${id} → ${items.length} items`);
    return items;
  };

  try {
    return await tryRun(actorId);
  } catch (err) {
    const msg = err.message.toLowerCase();
    const isUnavailable = msg.includes('not found') || msg.includes('404') ||
                          msg.includes('permission') || msg.includes('access denied') ||
                          msg.includes('does not exist');
    if (isUnavailable && storeSearchTerm) {
      console.warn(`[apify] ${actorId} unavailable — searching store for: "${storeSearchTerm}"`);
      const alt = await findActorInStore(storeSearchTerm);
      if (alt && alt !== actorId) {
        try { return await tryRun(alt); }
        catch (altErr) { noteApifyError(alt, altErr); throw altErr; }
      }
    }
    // Defense in depth: any actor failure in this central runner records to
    // the burn sentinel if it's quota-shaped, even when callers forget.
    noteApifyError(actorId, err);
    throw err;
  }
}

// ─── Tier 1: ATS APIs ─────────────────────────────────────────────────────────

async function scrapeGreenhouse() {
  console.log('[greenhouse] started');
  const results = [];

  await Promise.allSettled(GREENHOUSE_TOKENS.map(async (token) => {
    try {
      const res = await fetch(
        `https://boards-api.greenhouse.io/v1/boards/${token}/jobs?content=true`,
        { signal: AbortSignal.timeout(12000), headers: { 'User-Agent': 'Mozilla/5.0' } }
      );
      if (!res.ok) return;
      const data = await res.json();
      const companyName = data.meta?.name || (token.charAt(0).toUpperCase() + token.slice(1));

      for (const job of (data.jobs || [])) {
        if (!INTERN_RE.test(job.title || '')) continue;
        const depts = (job.departments || []).map(d => d.name || '').join(' ');
        if (!CS_DEPTS.test(depts) && !CS_DEPTS.test(job.title || '')) continue;
        const loc = job.location?.name || 'USA';
        if (!isUSLocation(loc)) continue;
        results.push(norm({
          name:           companyName,
          jobTitle:       job.title || '',
          jobDescription: (job.content || '').replace(/<[^>]+>/g, '').slice(0, 500),
          location:       loc,
          careersUrl:     job.absolute_url || '',
          source:         'greenhouse',
        }));
      }
    } catch { /* skip individual company errors silently */ }
  }));

  console.log(`[greenhouse] returned ${results.length} results`);
  return results;
}

async function scrapeLever() {
  console.log('[lever] started');
  const results = [];

  await Promise.allSettled(LEVER_COMPANIES.map(async (company) => {
    try {
      const res = await fetch(
        `https://api.lever.co/v0/postings/${company}?mode=json`,
        { signal: AbortSignal.timeout(10000) }
      );
      if (!res.ok) return;
      const jobs = await res.json();
      for (const job of (Array.isArray(jobs) ? jobs : [])) {
        if (!INTERN_RE.test(job.text || '')) continue;
        const team = job.categories?.team || '';
        if (!CS_DEPTS.test(team) && !CS_DEPTS.test(job.text || '')) continue;
        const loc = job.categories?.location || 'USA';
        if (!isUSLocation(loc)) continue;
        results.push(norm({
          name:           job.company || (company.charAt(0).toUpperCase() + company.slice(1)),
          jobTitle:       job.text || '',
          jobDescription: (job.descriptionPlain || job.description || '').slice(0, 500),
          location:       loc,
          careersUrl:     job.hostedUrl || '',
          source:         'lever',
        }));
      }
    } catch {}
  }));

  console.log(`[lever] returned ${results.length} results`);
  return results;
}

async function scrapeAshby() {
  console.log('[ashby] started');
  const results = [];

  await Promise.allSettled(ASHBY_COMPANIES.map(async (company) => {
    try {
      const res = await fetch(
        `https://api.ashbyhq.com/posting-api/job-board/${company}`,
        { signal: AbortSignal.timeout(10000) }
      );
      if (!res.ok) return;
      const data = await res.json();
      const companyName = data.organization?.name || data.name || (company.charAt(0).toUpperCase() + company.slice(1));
      // Ashby returns 'jobs' (not 'jobPostings') — try both for safety
      const jobList = data.jobs || data.jobPostings || [];
      for (const job of jobList) {
        if (!INTERN_RE.test(job.title || '')) continue;
        if (!CS_DEPTS.test(job.department || '') && !CS_DEPTS.test(job.title || '')) continue;
        const loc = job.locationName || job.location || 'USA';
        if (!isUSLocation(loc)) continue;
        results.push(norm({
          name:           companyName,
          jobTitle:       job.title || '',
          jobDescription: (job.descriptionHtml || job.descriptionSocial || '').replace(/<[^>]+>/g, '').slice(0, 500),
          location:       loc,
          careersUrl:     job.jobPostingUrl || job.applyUrl || '',
          source:         'ashby',
        }));
      }
    } catch {}
  }));

  console.log(`[ashby] returned ${results.length} results`);
  return results;
}

// ─── Tier 2: GitHub repos ─────────────────────────────────────────────────────

function parseSimplifyJSON(listings, source) {
  return (listings || [])
    .filter(item => item.active !== false && item.company_name)
    .filter(item => !item.title || INTERN_RE.test(item.title))
    .map(item => norm({
      name:      item.company_name,
      jobTitle:  item.title || 'Software Engineering Intern',
      location:  Array.isArray(item.locations)
        ? item.locations.slice(0, 3).join(', ')
        : (item.location || 'USA'),
      careersUrl: item.url || '',
      source,
    }));
}

async function scrapeSimplify() {
  console.log('[simplify] started');
  try {
    const res = await fetch(
      'https://raw.githubusercontent.com/SimplifyJobs/Summer2026-Internships/dev/.github/scripts/listings.json',
      { signal: AbortSignal.timeout(20000) }
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const results = parseSimplifyJSON(data, 'simplify');
    console.log(`[simplify] returned ${results.length} results`);
    return results;
  } catch (err) {
    console.error(`[simplify] failed — ${err.message}`);
    return [];
  }
}

async function scrapeSpeedyApply() {
  console.log('[speedyapply] started');

  for (const url of [
    'https://raw.githubusercontent.com/speedyapply/2026-SWE-College-Jobs/main/.github/scripts/listings.json',
    'https://raw.githubusercontent.com/speedyapply/2026-SWE-College-Jobs/dev/.github/scripts/listings.json',
  ]) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (res.ok) {
        const data = await res.json();
        const results = parseSimplifyJSON(data, 'speedyapply');
        if (results.length > 0) {
          console.log(`[speedyapply] returned ${results.length} results (JSON)`);
          return results;
        }
      }
    } catch {}
  }

  // Fallback: markdown table parsing
  try {
    const res = await fetch(
      'https://raw.githubusercontent.com/speedyapply/2026-SWE-College-Jobs/main/README.md',
      { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(15000) }
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    const results = [];
    for (const line of text.split('\n')) {
      if (!line.startsWith('|') || !line.includes('<strong>')) continue;
      const cols = line.split('|').map(c => c.trim());
      const nameMatch = cols[1]?.match(/<strong>(.*?)<\/strong>/);
      if (!nameMatch) continue;
      const applyMatch = cols[5]?.match(/href="(https?:\/\/[^"]+)"/);
      results.push(norm({
        name:       nameMatch[1].trim(),
        jobTitle:   cols[2]?.replace(/<[^>]+>/g, '').trim() || 'Software Engineering Intern',
        location:   cols[3]?.replace(/<[^>]+>/g, '').trim() || 'USA',
        careersUrl: applyMatch?.[1] || '',
        source:     'speedyapply',
      }));
    }
    console.log(`[speedyapply] returned ${results.length} results (markdown)`);
    return results;
  } catch (err) {
    console.error(`[speedyapply] failed — ${err.message}`);
    return [];
  }
}

async function scrapeInternList() {
  console.log('[internlist] started');
  for (const url of [
    'https://raw.githubusercontent.com/pittcsc/Summer2026-Internships/dev/.github/scripts/listings.json',
    'https://raw.githubusercontent.com/pittcsc/Summer2025-Internships/dev/.github/scripts/listings.json',
  ]) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (res.ok) {
        const data = await res.json();
        const results = parseSimplifyJSON(data, 'internlist');
        if (results.length > 0) {
          console.log(`[internlist] returned ${results.length} results`);
          return results;
        }
      }
    } catch {}
  }
  console.warn('[internlist] all URLs failed or returned 0 results');
  return [];
}

// ─── Tier 3: Apify actors ─────────────────────────────────────────────────────

async function scrapeLinkedInJobs(searchTerms = []) {
  console.log('[linkedin] started');
  const query = searchTerms[0] || 'Intern 2026';

  // Apify made breaking changes:
  //  - bebity/linkedin-jobs-scraper went paid-only (free trial expired)
  //  - curious_coder changed input schema to require `urls`, not keyword
  // valig still works on FREE plans with the keyword schema. Keep
  // curious_coder as a fallback with the new `urls` schema. Drop bebity.
  const searchUrl = `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(query)}&location=United%20States`;
  const attempts = [
    { id: 'valig/linkedin-jobs-scraper',          input: { keyword: query, location: 'United States', limit: 100 } },
    { id: 'curious_coder/linkedin-jobs-scraper',  input: { urls: [searchUrl], maxJobs: 100 } },
  ];

  for (const { id, input } of attempts) {
    try {
      const items = await runApifyActor(id, input, 'linkedin jobs scraper', 90);
      if (items.length === 0) continue;
      const results = items
        .filter(i => i.companyName || i.company)
        .filter(i => INTERN_RE.test(i.jobTitle || i.title || ''))
        .map(i => norm({
          name:           (i.companyName || i.company || '').trim(),
          jobTitle:       i.jobTitle || i.title || 'SWE Intern',
          jobDescription: (i.description || '').slice(0, 500),
          location:       i.location || i.jobLocation || 'USA',
          careersUrl:     i.jobUrl || i.url || '',
          source:         'linkedin',
        }))
        .filter(r => r.name.length > 1)
        .filter(r => isUSLocation(r.location));
      if (results.length === 0) {
        // Actor ignored the intern keyword and returned unrelated roles — try
        // the next actor (which uses LinkedIn's own search URL and honors
        // keywords) instead of returning [] and skipping the Greenhouse fallback.
        const sample = (items[0]?.jobTitle || items[0]?.title || '').slice(0, 80);
        console.warn(`[linkedin] ${id}: ${items.length} items returned but 0 matched intern filter (sample: "${sample}") — trying next actor`);
        continue;
      }
      console.log(`[linkedin] returned ${results.length} results (${id})`);
      return results;
    } catch (err) {
      noteApifyError(id, err);
      console.warn(`[linkedin] attempt "${id}" failed: ${err.message}`);
    }
  }

  console.error('[linkedin] all attempts failed — falling back to direct Greenhouse scan');
  const fallback = [];
  await Promise.allSettled(GREENHOUSE_TOKENS.map(async (slug) => {
    try {
      const res = await fetch(`https://boards-api.greenhouse.io/v1/boards/${slug}/jobs?content=false`, {
        signal: AbortSignal.timeout(6000),
      });
      if (!res.ok) return;
      const data = await res.json();
      for (const job of (data.jobs || [])) {
        const title = job.title || '';
        if (!INTERN_RE.test(title) || !CS_DEPTS.test(title)) continue;
        fallback.push(norm({
          name:       slug.charAt(0).toUpperCase() + slug.slice(1),
          jobTitle:   title,
          location:   job.location?.name || 'USA',
          careersUrl: job.absolute_url || `https://boards.greenhouse.io/${slug}`,
          source:     'linkedin',
        }));
      }
    } catch (_) {}
  }));

  console.log(`[linkedin] Greenhouse fallback returned ${fallback.length} results`);
  return fallback;
}

async function scrapeWellfound(searchTerms = []) {
  console.log('[wellfound] started');
  const query = searchTerms[0] || 'intern 2026';

  const attempts = [
    { id: 'misceres/wellfound-scraper',            input: { role: query, type: 'internship' } },
    { id: 'katerinahronik/wellfound-jobs-scraper', input: { query, jobType: 'internship' } },
    { id: 'apify/wellfound-scraper',               input: { searchUrl: `https://wellfound.com/jobs?role=software-engineer&jobType=intern` } },
  ];

  for (const { id, input } of attempts) {
    try {
      const items = await runApifyActor(id, input, 'wellfound angellist scraper', 90);
      if (items.length === 0) continue;
      const results = items
        .filter(i => i.companyName || i.company)
        .map(i => norm({
          name:           (i.companyName || i.company || '').trim(),
          jobTitle:       i.title || i.role || 'SWE Intern',
          jobDescription: (i.description || '').slice(0, 500),
          location:       i.location || 'USA',
          careersUrl:     i.url || i.applyUrl || '',
          source:         'wellfound',
        }))
        .filter(r => r.name.length > 1)
        .filter(r => isUSLocation(r.location));
      console.log(`[wellfound] returned ${results.length} results`);
      return results;
    } catch (err) {
      noteApifyError(id, err);
      console.warn(`[wellfound] attempt "${id}" failed: ${err.message}`);
    }
  }

  console.error('[wellfound] all attempts failed');
  return [];
}

async function scrapeIndeed(searchTerms = []) {
  console.log('[indeed] started');
  const position = searchTerms[0] || 'Intern 2026';

  const attempts = [
    { id: 'apify/indeed-scraper',            input: { country: 'US', position, maxItems: 100 } },
    { id: 'misceres/indeed-scraper',          input: { country: 'US', position, maxItems: 100 } },
    { id: 'vaclavrut/indeed-jobs-scraper',    input: { keyword: position, location: 'United States', maxItems: 100 } },
    { id: 'webscraper/indeed-job-scraper',    input: { query: position, location: 'United States' } },
  ];

  for (const { id, input } of attempts) {
    try {
      const items = await runApifyActor(id, input, 'indeed jobs scraper', 90);
      if (items.length === 0) continue;
      const results = items
        .filter(i => i.company || i.companyName)
        .filter(i => INTERN_RE.test(i.positionName || i.title || ''))
        .map(i => norm({
          name:           (i.company || i.companyName || '').trim(),
          jobTitle:       i.positionName || i.title || 'SWE Intern',
          jobDescription: (i.description || '').slice(0, 500),
          location:       i.location || 'USA',
          careersUrl:     i.url || i.externalApplyLink || '',
          source:         'indeed',
        }))
        .filter(r => r.name.length > 1)
        .filter(r => isUSLocation(r.location));
      if (results.length === 0) {
        const sample = (items[0]?.positionName || items[0]?.title || '').slice(0, 80);
        console.warn(`[indeed] ${id}: ${items.length} items returned but 0 matched intern filter (sample: "${sample}") — trying next actor`);
        continue;
      }
      console.log(`[indeed] returned ${results.length} results`);
      return results;
    } catch (err) {
      noteApifyError(id, err);
      console.warn(`[indeed] attempt "${id}" failed: ${err.message}`);
    }
  }

  console.error('[indeed] all attempts failed');
  return [];
}

async function scrapeDice(searchTerms = []) {
  console.log('[dice] started');
  const query = searchTerms[0] || 'Intern 2026';

  // Try Dice's internal API first (no auth required)
  try {
    const url = `https://job-search-api.svc.dhigroupinc.com/v1/dice/search?q=${encodeURIComponent(query)}&location=United+States&countryCode=US&radius=30&radiusUnit=mi&page=1&pageSize=100&filters.employmentType=INTERN&language=en`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'application/json',
        'x-api-key': 'j1QnWIpEfHGBHKS0uo1XBmjGWJFOCfLHf0ECUIXRM1qYuE5GEA==',
      },
      signal: AbortSignal.timeout(10000),
    });
    if (res.ok) {
      const data = await res.json();
      const hits = data.data || [];
      const results = hits
        .filter(i => i.company || i.companyName)
        .filter(i => INTERN_RE.test(i.title || i.jobTitle || ''))
        .map(i => norm({
          name:       (i.company || i.companyName || '').trim(),
          jobTitle:   i.title || i.jobTitle || 'SWE Intern',
          location:   i.location || 'USA',
          careersUrl: i.jobDetailUrl ? `https://www.dice.com/job-detail/${i.jobDetailUrl}` : i.applyUrl || '',
          source:     'dice',
        }))
        .filter(r => r.name.length > 1)
        .filter(r => isUSLocation(r.location));
      if (results.length > 0) {
        console.log(`[dice] returned ${results.length} results (direct API)`);
        return results;
      }
    }
  } catch (err) {
    console.warn(`[dice] direct API failed: ${err.message}`);
  }

  // Fallback: Apify store
  try {
    const items = await runApifyActor(
      'webscraper/dice-scraper',
      { query, location: 'United States' },
      'dice jobs scraper',
      90
    );
    const results = items
      .filter(i => i.company || i.companyName)
      .filter(i => INTERN_RE.test(i.title || ''))
      .map(i => norm({
        name:       (i.company || i.companyName || '').trim(),
        jobTitle:   i.title || 'SWE Intern',
        location:   i.location || 'USA',
        careersUrl: i.url || '',
        source:     'dice',
      }))
      .filter(r => r.name.length > 1)
        .filter(r => isUSLocation(r.location));
    console.log(`[dice] returned ${results.length} results (Apify)`);
    return results;
  } catch (err) {
    console.error(`[dice] all attempts failed: ${err.message}`);
    return [];
  }
}

async function scrapeGoogleJobs(searchTerms = []) {
  console.log('[google_jobs] started');
  const query = searchTerms[0] || 'Internship 2026 United States';

  const attempts = [
    { id: 'bebity/google-jobs-scraper', input: { queries: [query], countryCode: 'us', languageCode: 'en', maxPagesPerQuery: 3 } },
    { id: 'bebity/google-jobs-scraper', input: { query, country: 'US' } },
    { id: 'apify/google-jobs-scraper',  input: { queries: [query], countryCode: 'us' } },
  ];

  for (const { id, input } of attempts) {
    try {
      const items = await runApifyActor(id, input, 'google jobs scraper', 90);
      if (items.length === 0) continue;
      const results = items
        .filter(i => i.company || i.companyName || i.employerName)
        .filter(i => INTERN_RE.test(i.title || i.jobTitle || ''))
        .map(i => norm({
          name:           (i.company || i.companyName || i.employerName || '').trim(),
          jobTitle:       i.title || i.jobTitle || 'SWE Intern',
          jobDescription: (i.description || '').slice(0, 500),
          location:       i.location || i.jobLocation || 'USA',
          careersUrl:     i.url || i.applyLink || '',
          source:         'google_jobs',
        }))
        .filter(r => r.name.length > 1)
        .filter(r => isUSLocation(r.location));
      if (results.length === 0) {
        const sample = (items[0]?.title || items[0]?.jobTitle || '').slice(0, 80);
        console.warn(`[google_jobs] ${id}: ${items.length} items returned but 0 matched intern filter (sample: "${sample}") — trying next actor`);
        continue;
      }
      console.log(`[google_jobs] returned ${results.length} results`);
      return results;
    } catch (err) {
      noteApifyError(id, err);
      console.warn(`[google_jobs] attempt "${id}" failed: ${err.message}`);
    }
  }

  console.error('[google_jobs] all attempts failed');
  return [];
}

// ─── Handshake (school portal — requires session cookie) ────────────────────
// Handshake is school-locked. Per user ask #6 option A: the user pastes their
// session cookie into the VM .env as HANDSHAKE_SESSION_COOKIE (the value of
// the `_session_id` cookie from app.joinhandshake.com). Optionally
// HANDSHAKE_BASE_URL can override the default to point at a school-specific
// subdomain (e.g. https://uic.joinhandshake.com).
//
// Cookies expire — when this returns 0 the user re-pastes a fresh cookie.
async function scrapeHandshake(searchTerms = []) {
  console.log('[handshake] started');
  const cookie = process.env.HANDSHAKE_SESSION_COOKIE;
  if (!cookie) {
    console.warn('[handshake] HANDSHAKE_SESSION_COOKIE not set — skipping');
    return [];
  }
  const baseUrl = process.env.HANDSHAKE_BASE_URL || 'https://app.joinhandshake.com';
  const query = (searchTerms[0] || 'intern 2026').toLowerCase();
  const isIntern = /intern/.test(query);
  const params = new URLSearchParams({ keyword: query, 'locations[]': 'United States' });
  if (isIntern) params.append('employmentTypeIds[]', 'intern');
  const searchUrl = `${baseUrl}/job-search?${params.toString()}`;

  let browser;
  try {
    const { chromium } = await import('playwright');
    browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const context = await browser.newContext();
    // Set the session cookie on the Handshake domain.
    const url = new URL(baseUrl);
    await context.addCookies([
      { name: '_session_id', value: cookie, domain: url.hostname, path: '/', httpOnly: true, secure: true, sameSite: 'Lax' },
    ]);
    const page = await context.newPage();
    await page.goto(searchUrl, { waitUntil: 'load', timeout: 25000 });
    // Detect login redirect (cookie expired) — Handshake bounces to /login or /students/sign_in
    if (/\/(login|sign_in)/i.test(page.url())) {
      console.warn('[handshake] cookie appears expired (redirected to login) — paste a fresh HANDSHAKE_SESSION_COOKIE');
      return [];
    }
    // Wait for job cards. Handshake's markup changes; we use a few selector candidates.
    await page.waitForSelector('a[href*="/jobs/"], [data-test*="job-card"], [data-hook*="job"]', { timeout: 12000 }).catch(() => {});
    const items = await page.evaluate(() => {
      const out = [];
      const cards = document.querySelectorAll('a[href*="/jobs/"], [data-test*="job-card"], [data-hook*="job"]');
      const seen = new Set();
      for (const card of cards) {
        const href = card.getAttribute('href') || card.querySelector('a[href*="/jobs/"]')?.getAttribute('href') || '';
        if (!/\/jobs\//.test(href)) continue;
        const url = href.startsWith('http') ? href : `https://app.joinhandshake.com${href}`;
        if (seen.has(url)) continue;
        seen.add(url);
        const text = (card.innerText || card.textContent || '').trim();
        const lines = text.split('\n').map(s => s.trim()).filter(Boolean);
        // First line = title, second line = company, third line = location (best-effort)
        out.push({
          url,
          title:    lines[0] || '',
          company:  lines[1] || '',
          location: lines[2] || 'USA',
        });
        if (out.length >= 100) break;
      }
      return out;
    });
    const results = items
      .filter(i => i.company)
      .filter(i => INTERN_RE.test(i.title || ''))
      .map(i => norm({
        name:       i.company.trim(),
        jobTitle:   i.title || 'Intern',
        location:   i.location || 'USA',
        careersUrl: i.url || '',
        source:     'handshake',
      }))
      .filter(r => r.name.length > 1)
      .filter(r => isUSLocation(r.location));
    console.log(`[handshake] returned ${results.length} results from ${items.length} cards`);
    return results;
  } catch (err) {
    console.error(`[handshake] failed: ${err.message}`);
    return [];
  } finally {
    if (browser) { try { await browser.close(); } catch {} }
  }
}

// ─── Tier 4: Direct fetch ─────────────────────────────────────────────────────

async function scrapeAIJobs() {
  console.log('[ai_jobs] started');

  // Try JSON endpoints
  for (const url of [
    'https://ai-jobs.net/jobs.json',
    'https://ai-jobs.net/feed/json/',
    'https://aijobs.net/feed/json/',
    'https://ai-jobs.net/api/v1/jobs?type=internship',
  ]) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' },
        signal: AbortSignal.timeout(10000),
      });
      console.log(`[ai_jobs] ${url} → ${res.status}`);
      if (!res.ok) continue;
      const ct = res.headers.get('content-type') || '';
      if (!ct.includes('json')) continue;
      const data = await res.json();
      const items = data.items || data.jobs || data.data || data.results || [];
      if (!Array.isArray(items) || items.length === 0) continue;
      const results = items
        .filter(i => INTERN_RE.test(i.title || '') || !i.title)
        .map(i => {
          const nameGuess = (i.company || i.company_name || i.author || '').trim();
          if (!nameGuess || nameGuess.length < 2) return null;
          return norm({
            name:           nameGuess,
            jobTitle:       i.title || 'AI/ML Intern',
            jobDescription: (i.content_text || i.description || '').slice(0, 500),
            location:       i.location || 'USA',
            careersUrl:     i.url || i.link || '',
            source:         'ai_jobs',
          });
        })
        .filter(Boolean)
        .filter(r => r.name.length > 1)
        .filter(r => isUSLocation(r.location));
      if (results.length > 0) {
        console.log(`[ai_jobs] returned ${results.length} results (${url})`);
        return results;
      }
    } catch (err) {
      console.warn(`[ai_jobs] ${url} — ${err.message}`);
    }
  }

  // Fallback: RSS feed with basic XML parsing
  try {
    const res = await fetch('https://ai-jobs.net/feed/', {
      headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/rss+xml, application/xml, text/xml' },
      signal: AbortSignal.timeout(10000),
    });
    if (res.ok) {
      const xml = await res.text();
      const results = [];
      const itemRe = /<item>([\s\S]*?)<\/item>/g;
      let m;
      while ((m = itemRe.exec(xml)) !== null) {
        const block = m[1];
        const title = block.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/)?.[1]
          || block.match(/<title>(.*?)<\/title>/)?.[1] || '';
        if (!INTERN_RE.test(title)) continue;
        const company = block.match(/<company><!\[CDATA\[(.*?)\]\]><\/company>/)?.[1]
          || block.match(/<company>(.*?)<\/company>/)?.[1] || '';
        const link = block.match(/<link>(.*?)<\/link>/)?.[1] || '';
        if (!company || company.length < 2) continue;
        results.push(norm({ name: company.trim(), jobTitle: title.trim(), careersUrl: link, source: 'ai_jobs' }));
      }
      if (results.length > 0) {
        console.log(`[ai_jobs] returned ${results.length} results (RSS)`);
        return results;
      }
    }
  } catch (err) {
    console.warn(`[ai_jobs] RSS failed: ${err.message}`);
  }

  console.warn('[ai_jobs] all endpoints returned 0 results');
  return [];
}

async function scrapeProsple() {
  console.log('[prosple] started');

  for (const url of [
    'https://prosple.com/api/v1/graduate-jobs?country=us&type=internship&discipline=technology',
    'https://prosple.com/api/jobs?country=us&type=intern',
    'https://gradaustralia.com.au/api/jobs?type=internship&country=US',
  ]) {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'application/json, text/html',
          'Accept-Language': 'en-US,en;q=0.9',
          'Referer': 'https://prosple.com/',
        },
        signal: AbortSignal.timeout(10000),
      });
      console.log(`[prosple] ${url} → ${res.status}`);
      if (!res.ok) continue;
      const data = await res.json();
      const items = data.data || data.jobs || data.results || [];
      const results = items
        .filter(i => i.company || i.employer)
        .filter(i => INTERN_RE.test(i.title || ''))
        .map(i => norm({
          name:       (i.company?.name || i.employer?.name || i.company || '').trim(),
          jobTitle:   i.title || 'Intern',
          location:   i.location || 'USA',
          careersUrl: i.url || i.applyUrl || '',
          source:     'prosple',
        }))
        .filter(r => r.name.length > 1)
        .filter(r => isUSLocation(r.location));
      if (results.length > 0) {
        console.log(`[prosple] returned ${results.length} results`);
        return results;
      }
    } catch (err) {
      console.warn(`[prosple] ${url} — ${err.message}`);
    }
  }

  console.warn('[prosple] all endpoints failed');
  return [];
}

// ─── aijobs.ai ────────────────────────────────────────────────────────────────
async function scrapeAIJobsAI() {
  console.log('[aijobs.ai] started');
  try {
    const res = await fetch('https://aijobs.ai/api/jobs?type=internship&location=USA&limit=100', {
      headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' },
      signal: AbortSignal.timeout(10000),
    });
    if (res.ok) {
      const data = await res.json();
      const items = data.jobs || data.data || data.results || [];
      const results = items
        .filter(i => INTERN_RE.test(i.title || ''))
        .map(i => norm({ name: (i.company || i.company_name || '').trim(), jobTitle: i.title, location: i.location || 'USA', careersUrl: i.url || i.apply_url || '', source: 'aijobs_ai' }))
        .filter(r => r.name.length > 1)
        .filter(r => isUSLocation(r.location));
      if (results.length) { console.log(`[aijobs.ai] ${results.length} results`); return results; }
    }
  } catch (_) {}
  // RSS fallback
  try {
    const res = await fetch('https://aijobs.ai/feed/', { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(10000) });
    if (res.ok) {
      const xml = await res.text();
      const results = [];
      const itemRe = /<item>([\s\S]*?)<\/item>/g;
      let m;
      while ((m = itemRe.exec(xml)) !== null) {
        const b = m[1];
        const title   = b.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/)?.[1] || b.match(/<title>(.*?)<\/title>/)?.[1] || '';
        const company = b.match(/<company><!\[CDATA\[(.*?)\]\]><\/company>/)?.[1] || b.match(/<company>(.*?)<\/company>/)?.[1] || b.match(/<dc:creator><!\[CDATA\[(.*?)\]\]><\/dc:creator>/)?.[1] || '';
        const link    = b.match(/<link>(.*?)<\/link>/)?.[1] || '';
        if (!INTERN_RE.test(title) || company.length < 2) continue;
        results.push(norm({ name: company.trim(), jobTitle: title.trim(), careersUrl: link, source: 'aijobs_ai' }));
      }
      if (results.length) { console.log(`[aijobs.ai] RSS ${results.length} results`); return results; }
    }
  } catch (_) {}
  console.warn('[aijobs.ai] all endpoints returned 0');
  return [];
}

// ─── startup.jobs ─────────────────────────────────────────────────────────────
async function scrapeStartupJobs() {
  console.log('[startup.jobs] started');
  for (const url of [
    'https://startup.jobs/api/v1/jobs?tags=internship&remote=true',
    'https://startup.jobs/api/jobs?type=intern',
  ]) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' }, signal: AbortSignal.timeout(10000) });
      if (!res.ok) continue;
      const data = await res.json();
      const items = data.jobs || data.data || data.results || [];
      const results = items
        .filter(i => INTERN_RE.test(i.title || ''))
        .map(i => norm({ name: (i.startup?.name || i.company || '').trim(), jobTitle: i.title, location: i.location || i.remote ? 'Remote' : 'USA', careersUrl: i.url || i.link || '', source: 'startup_jobs' }))
        .filter(r => r.name.length > 1)
        .filter(r => isUSLocation(r.location));
      if (results.length) { console.log(`[startup.jobs] ${results.length} results`); return results; }
    } catch (_) {}
  }
  // RSS fallback
  try {
    const res = await fetch('https://startup.jobs/feed', { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(10000) });
    if (res.ok) {
      const xml = await res.text();
      const results = [];
      const itemRe = /<item>([\s\S]*?)<\/item>/g;
      let m;
      while ((m = itemRe.exec(xml)) !== null) {
        const b = m[1];
        const title   = b.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/)?.[1] || b.match(/<title>(.*?)<\/title>/)?.[1] || '';
        const company = b.match(/<company>(.*?)<\/company>/)?.[1] || b.match(/<dc:creator><!\[CDATA\[(.*?)\]\]><\/dc:creator>/)?.[1] || '';
        const link    = b.match(/<link>(.*?)<\/link>/)?.[1] || '';
        if (!INTERN_RE.test(title) || company.length < 2) continue;
        results.push(norm({ name: company.trim(), jobTitle: title.trim(), careersUrl: link, source: 'startup_jobs' }));
      }
      if (results.length) { console.log(`[startup.jobs] RSS ${results.length} results`); return results; }
    }
  } catch (_) {}
  console.warn('[startup.jobs] all endpoints returned 0');
  return [];
}

// ─── remoteai.io ──────────────────────────────────────────────────────────────
async function scrapeRemoteAI() {
  console.log('[remoteai.io] started');
  for (const url of [
    'https://remoteai.io/api/jobs?type=internship',
    'https://remoteai.io/api/v1/jobs?category=intern',
  ]) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' }, signal: AbortSignal.timeout(10000) });
      if (!res.ok) continue;
      const data = await res.json();
      const items = data.jobs || data.data || data.results || [];
      const results = items
        .filter(i => INTERN_RE.test(i.title || ''))
        .map(i => norm({ name: (i.company || i.company_name || '').trim(), jobTitle: i.title, location: i.location || 'Remote', careersUrl: i.url || i.apply_url || '', source: 'remoteai' }))
        .filter(r => r.name.length > 1)
        .filter(r => isUSLocation(r.location));
      if (results.length) { console.log(`[remoteai.io] ${results.length} results`); return results; }
    } catch (_) {}
  }
  // RSS fallback
  try {
    const res = await fetch('https://remoteai.io/feed', { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(10000) });
    if (res.ok) {
      const xml = await res.text();
      const results = [];
      const itemRe = /<item>([\s\S]*?)<\/item>/g;
      let m;
      while ((m = itemRe.exec(xml)) !== null) {
        const b = m[1];
        const title   = b.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/)?.[1] || b.match(/<title>(.*?)<\/title>/)?.[1] || '';
        const company = b.match(/<company>(.*?)<\/company>/)?.[1] || b.match(/<dc:creator><!\[CDATA\[(.*?)\]\]><\/dc:creator>/)?.[1] || '';
        const link    = b.match(/<link>(.*?)<\/link>/)?.[1] || '';
        if (!INTERN_RE.test(title) || company.length < 2) continue;
        results.push(norm({ name: company.trim(), jobTitle: title.trim(), careersUrl: link, location: 'Remote', source: 'remoteai' }));
      }
      if (results.length) { console.log(`[remoteai.io] RSS ${results.length} results`); return results; }
    }
  } catch (_) {}
  console.warn('[remoteai.io] all endpoints returned 0');
  return [];
}

// ─── arc.dev ──────────────────────────────────────────────────────────────────
async function scrapeArcDev() {
  console.log('[arc.dev] started');
  for (const url of [
    'https://arc.dev/remote-jobs/api/v1/jobs?type=internship&location=USA',
    'https://arc.dev/api/v1/jobs?experience_level=intern',
  ]) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' }, signal: AbortSignal.timeout(10000) });
      if (!res.ok) continue;
      const data = await res.json();
      const items = data.jobs || data.data || data.results || [];
      const results = items
        .filter(i => INTERN_RE.test(i.title || ''))
        .map(i => norm({ name: (i.company?.name || i.company || '').trim(), jobTitle: i.title, location: i.location || 'Remote', careersUrl: i.url || i.apply_url || '', source: 'arc_dev' }))
        .filter(r => r.name.length > 1)
        .filter(r => isUSLocation(r.location));
      if (results.length) { console.log(`[arc.dev] ${results.length} results`); return results; }
    } catch (_) {}
  }
  console.warn('[arc.dev] all endpoints returned 0');
  return [];
}

// ─── aijobs.net ───────────────────────────────────────────────────────────────
async function scrapeAIJobsNet() {
  console.log('[aijobs.net] started');
  for (const url of [
    'https://aijobs.net/api/v1/jobs?type=internship',
    'https://aijobs.net/jobs.json',
    'https://aijobs.net/feed/json/',
  ]) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' }, signal: AbortSignal.timeout(10000) });
      if (!res.ok) continue;
      const ct = res.headers.get('content-type') || '';
      if (!ct.includes('json')) continue;
      const data = await res.json();
      const items = data.items || data.jobs || data.data || data.results || [];
      const results = items
        .filter(i => INTERN_RE.test(i.title || ''))
        .map(i => norm({ name: (i.company || i.company_name || '').trim(), jobTitle: i.title, location: i.location || 'USA', careersUrl: i.url || i.link || '', source: 'aijobs_net' }))
        .filter(r => r.name.length > 1)
        .filter(r => isUSLocation(r.location));
      if (results.length) { console.log(`[aijobs.net] ${results.length} results`); return results; }
    } catch (_) {}
  }
  // RSS fallback
  try {
    const res = await fetch('https://aijobs.net/feed/', { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(10000) });
    if (res.ok) {
      const xml = await res.text();
      const results = [];
      const itemRe = /<item>([\s\S]*?)<\/item>/g;
      let m;
      while ((m = itemRe.exec(xml)) !== null) {
        const b = m[1];
        const title   = b.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/)?.[1] || b.match(/<title>(.*?)<\/title>/)?.[1] || '';
        const company = b.match(/<company><!\[CDATA\[(.*?)\]\]><\/company>/)?.[1] || b.match(/<company>(.*?)<\/company>/)?.[1] || '';
        const link    = b.match(/<link>(.*?)<\/link>/)?.[1] || '';
        if (!INTERN_RE.test(title) || company.length < 2) continue;
        results.push(norm({ name: company.trim(), jobTitle: title.trim(), careersUrl: link, source: 'aijobs_net' }));
      }
      if (results.length) { console.log(`[aijobs.net] RSS ${results.length} results`); return results; }
    }
  } catch (_) {}
  console.warn('[aijobs.net] all endpoints returned 0');
  return [];
}

// ─── hiring.cafe ──────────────────────────────────────────────────────────────
async function scrapeHiringCafe() {
  console.log('[hiring.cafe] started');
  for (const url of [
    'https://hiring.cafe/api/jobs?type=internship&country=US',
    'https://hiring.cafe/api/v1/jobs?level=intern',
  ]) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' }, signal: AbortSignal.timeout(10000) });
      if (!res.ok) continue;
      const data = await res.json();
      const items = data.jobs || data.data || data.results || [];
      const results = items
        .filter(i => INTERN_RE.test(i.title || ''))
        .map(i => norm({ name: (i.company || i.company_name || '').trim(), jobTitle: i.title, location: i.location || 'USA', careersUrl: i.url || i.apply_url || '', source: 'hiring_cafe' }))
        .filter(r => r.name.length > 1)
        .filter(r => isUSLocation(r.location));
      if (results.length) { console.log(`[hiring.cafe] ${results.length} results`); return results; }
    } catch (_) {}
  }
  console.warn('[hiring.cafe] all endpoints returned 0');
  return [];
}

// ─── Scraper health check ─────────────────────────────────────────────────────

export async function scraperHealth() {
  const health = {};

  // Greenhouse
  try {
    const res = await fetch('https://boards-api.greenhouse.io/v1/boards/stripe/jobs?content=false', { signal: AbortSignal.timeout(5000) });
    const data = res.ok ? await res.json() : null;
    health.greenhouse = { status: res.ok ? 'ok' : 'failed', testCompany: 'stripe', jobsReturned: (data?.jobs || []).length };
  } catch (err) { health.greenhouse = { status: 'failed', error: err.message }; }

  // Lever
  try {
    const res = await fetch('https://api.lever.co/v0/postings/netflix?mode=json', { signal: AbortSignal.timeout(5000) });
    const data = res.ok ? await res.json() : [];
    health.lever = { status: res.ok ? 'ok' : 'failed', testCompany: 'netflix', jobsReturned: (Array.isArray(data) ? data : []).length };
  } catch (err) { health.lever = { status: 'failed', error: err.message }; }

  // Ashby (fixed endpoint)
  try {
    const res = await fetch('https://api.ashbyhq.com/posting-api/job-board/linear', { signal: AbortSignal.timeout(5000) });
    const data = res.ok ? await res.json() : null;
    health.ashby = { status: res.ok ? 'ok' : 'failed', testCompany: 'linear', jobsReturned: (data?.jobs || data?.jobPostings || []).length };
  } catch (err) { health.ashby = { status: 'failed', error: err.message }; }

  // GitHub Simplify
  try {
    const res = await fetch('https://raw.githubusercontent.com/SimplifyJobs/Summer2026-Internships/dev/.github/scripts/listings.json', { signal: AbortSignal.timeout(10000) });
    const data = res.ok ? await res.json() : [];
    health.simplify = { status: res.ok ? 'ok' : 'failed', jobsReturned: (Array.isArray(data) ? data : []).length };
  } catch (err) { health.simplify = { status: 'failed', error: err.message }; }

  // SpeedyApply
  try {
    const res = await fetch('https://raw.githubusercontent.com/speedyapply/2026-SWE-College-Jobs/main/.github/scripts/listings.json', { signal: AbortSignal.timeout(8000) });
    const data = res.ok ? await res.json() : [];
    health.speedyapply = { status: res.ok ? 'ok' : 'failed', jobsReturned: (Array.isArray(data) ? data : []).length };
  } catch (err) { health.speedyapply = { status: 'failed', error: err.message }; }

  // InternList
  try {
    const res = await fetch('https://raw.githubusercontent.com/pittcsc/Summer2026-Internships/dev/.github/scripts/listings.json', { signal: AbortSignal.timeout(8000) });
    const data = res.ok ? await res.json() : [];
    health.internlist = { status: res.ok ? 'ok' : 'failed', jobsReturned: (Array.isArray(data) ? data : []).length };
  } catch (err) { health.internlist = { status: 'failed', error: err.message }; }

  // Dice direct API
  try {
    const res = await fetch(
      'https://job-search-api.svc.dhigroupinc.com/v1/dice/search?q=software+intern&countryCode=US&page=1&pageSize=5&filters.employmentType=INTERN&language=en',
      { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json', 'x-api-key': 'j1QnWIpEfHGBHKS0uo1XBmjGWJFOCfLHf0ECUIXRM1qYuE5GEA==' }, signal: AbortSignal.timeout(6000) }
    );
    const data = res.ok ? await res.json() : null;
    health.dice = { status: res.ok ? 'ok' : 'failed', source: 'direct API', jobsReturned: (data?.data || []).length, error: res.ok ? undefined : `HTTP ${res.status}` };
  } catch (err) { health.dice = { status: 'failed', error: err.message }; }

  // AI Jobs
  try {
    const res = await fetch('https://ai-jobs.net/jobs.json', { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(5000) });
    health.ai_jobs = { status: res.ok ? 'ok' : 'failed', url: 'ai-jobs.net/jobs.json', error: res.ok ? undefined : `HTTP ${res.status}` };
  } catch (err) { health.ai_jobs = { status: 'failed', error: err.message }; }

  // Prosple
  try {
    const res = await fetch('https://prosple.com/api/v1/graduate-jobs?country=us&type=internship&discipline=technology', {
      headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' }, signal: AbortSignal.timeout(5000)
    });
    health.prosple = { status: res.ok ? 'ok' : 'failed', error: res.ok ? undefined : `HTTP ${res.status}` };
  } catch (err) { health.prosple = { status: 'failed', error: err.message }; }

  // Apify-dependent sources
  const token = getApifyToken();
  if (!token) {
    const noToken = { status: 'failed', error: 'APIFY_API_TOKEN not set' };
    ['linkedin', 'wellfound', 'indeed', 'google_jobs'].forEach(k => { health[k] = noToken; });
  } else {
    health.apify_token = { status: 'ok', note: 'Apify token configured — individual actor health not probed (would cost credits)' };
  }

  return health;
}

// ─── Main export ──────────────────────────────────────────────────────────────

export const SOURCES = [
  { key: 'greenhouse',   fn: ()      => scrapeGreenhouse() },
  { key: 'lever',        fn: ()      => scrapeLever() },
  { key: 'ashby',        fn: ()      => scrapeAshby() },
  { key: 'simplify',     fn: ()      => scrapeSimplify() },
  { key: 'speedyapply',  fn: ()      => scrapeSpeedyApply() },
  { key: 'internlist',   fn: ()      => scrapeInternList() },
  { key: 'linkedin',     fn: (terms) => scrapeLinkedInJobs(terms) },
  { key: 'wellfound',    fn: (terms) => scrapeWellfound(terms) },
  { key: 'indeed',       fn: (terms) => scrapeIndeed(terms) },
  { key: 'dice',         fn: (terms) => scrapeDice(terms) },
  { key: 'google_jobs',  fn: (terms) => scrapeGoogleJobs(terms) },
  { key: 'ai_jobs',      fn: ()      => scrapeAIJobs() },
  { key: 'prosple',      fn: ()      => scrapeProsple() },
  { key: 'handshake',    fn: (terms) => scrapeHandshake(terms) },
];

const SOURCE_ALIASES = {
  google:      ['google_jobs'],
  google_jobs: ['google_jobs'],
  github:      ['simplify', 'speedyapply', 'internlist'],
};

function selectSources(sourceFilter = '') {
  if (!sourceFilter) return SOURCES;
  const requested = String(sourceFilter)
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
  const keys = requested.flatMap(key => SOURCE_ALIASES[key] || [key]);
  const selected = SOURCES.filter(source => keys.includes(source.key));
  if (selected.length === 0) {
    throw new Error(`Unknown scrape source: ${sourceFilter}`);
  }
  return selected;
}

/**
 * Run all scraping sources in parallel, normalize, and deduplicate.
 * category/subcategory are used ONLY for search query construction —
 * they are never written to the DB (classification sets DB values).
 *
 * @returns {{ results: NormalizedCompany[], bySource: Record<string,number>, errors: Record<string,string> }}
 */
export async function scrapeAllSources(subcategory = '', category = '', sourceFilter = '') {
  const searchTerms = getSearchTerms(category, subcategory);
  const selectedSources = selectSources(sourceFilter);
  console.log(`[scraper] starting ${selectedSources.length} sources${sourceFilter ? ` (${sourceFilter})` : ''} — subcategory="${subcategory}" terms=[${searchTerms.slice(0, 2).join(', ')}]`);

  const settled = await Promise.allSettled(selectedSources.map(s => s.fn(searchTerms)));

  const bySource = {};
  const errors   = {};
  const allRaw   = [];

  for (let i = 0; i < selectedSources.length; i++) {
    const { key } = selectedSources[i];
    const result  = settled[i];
    if (result.status === 'fulfilled') {
      bySource[key] = result.value.length;
      allRaw.push(...result.value);
    } else {
      bySource[key] = 0;
      errors[key]   = result.reason?.message || 'unknown error';
      console.error(`[scraper] ${key} rejected — ${errors[key]}`);
    }
  }

  const results = dedupe(allRaw);
  console.log(`[scraper] done — raw=${allRaw.length} deduped=${results.length}`);
  return { results, bySource, errors };
}

/**
 * Scrape a single source by key and return normalized, deduped results.
 */
export async function scrapeOneSource(key, subcategory = '', category = '') {
  const src = SOURCES.find(s => s.key === key);
  if (!src) throw new Error(`unknown source: ${key}`);
  const searchTerms = getSearchTerms(category, subcategory);
  const raw = await src.fn(searchTerms);
  return { results: dedupe(raw), count: raw.length };
}
