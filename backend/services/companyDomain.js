// ── Company email-domain resolution ──────────────────────────────────────────
//
// The single source of truth for "what domain do this company's people have
// email addresses on?" Used by Find People, bulk Find Emails and per-contact
// Find Email. Getting this wrong is expensive twice: paid lookups run against
// the wrong company, and that company's staff get saved as contacts.
//
// Rules:
//   • A job board / ATS host (greenhouse.io, wellfound.com, linkedin.com …)
//     is never a company domain.
//   • Known-company overrides match the WHOLE normalised name — "HubSpot"
//     must not match the "ubs" entry.
//   • A domain the user typed or one we already verified wins over guesses.
//   • A domain derived from the name ("acme.com") is only used after a free
//     MX lookup proves it receives mail, and is reported as a guess.
import dns from 'node:dns';
import { parse as parseDomain } from 'tldts';

// Registrable domains (eTLD+1) that host job posts or profiles for many
// companies. Subdomains (boards.greenhouse.io, acme.wd1.myworkdayjobs.com)
// collapse to these via tldts before the check.
export const JOB_BOARD_DOMAINS = new Set([
  // ATS
  'greenhouse.io', 'lever.co', 'ashbyhq.com', 'workable.com', 'myworkdayjobs.com', 'myworkdaysite.com',
  'workday.com', 'smartrecruiters.com', 'jobvite.com', 'icims.com', 'taleo.net', 'brassring.com',
  'bamboohr.com', 'recruitee.com', 'breezy.hr', 'applytojob.com', 'teamtailor.com', 'jazzhr.com',
  'pinpointhq.com', 'comeet.com', 'personio.de', 'personio.com', 'freshteam.com', 'zohorecruit.com',
  'recruiterbox.com', 'hirehive.com', 'homerun.co', 'join.com', 'polymer.co', 'careers-page.com',
  'rippling.com', 'rippling-ats.com', 'gem.com', 'dover.com', 'dover.io', 'eightfold.ai', 'phenompeople.com',
  'oraclecloud.com', 'successfactors.com', 'successfactors.eu', 'ultipro.com', 'adp.com',
  'dayforcehcm.com', 'paylocity.com', 'paycomonline.net', 'trinethire.com', 'hire.trakstar.com',
  'workforcenow.adp.com', 'avature.net', 'jobs2web.com', 'csod.com', 'kenexa.com',
  // Job boards & aggregators
  'linkedin.com', 'indeed.com', 'glassdoor.com', 'dice.com', 'wellfound.com', 'angel.co',
  'ziprecruiter.com', 'monster.com', 'careerbuilder.com', 'simplyhired.com', 'simplify.jobs',
  'jobright.ai', 'ai-jobs.net', 'levels.fyi', 'levelsfyi.com', 'builtin.com', 'otta.com',
  'welcometothejungle.com', 'hired.com', 'joinhandshake.com', 'handshake.com', 'ycombinator.com',
  'workatastartup.com', 'prosple.com', 'jobspresso.co', 'remoterocketship.com', 'remoteok.com',
  'weworkremotely.com', 'internships.com', 'wayup.com', 'ripplematch.com', 'speedyapply.com',
  'crunchbase.com', 'google.com', 'github.com', 'githubusercontent.com', 'notion.site', 'notion.so',
  'medium.com', 'substack.com', 'twitter.com', 'x.com', 'facebook.com', 'instagram.com',
])

// Companies whose email domain isn't "<name>.com". Keyed by normalised name
// (see normalizeCompanyName) and matched exactly.
const KNOWN_DOMAINS = new Map(Object.entries({
  'goldman sachs': 'gs.com', 'jp morgan': 'jpmorgan.com', 'jpmorgan': 'jpmorgan.com',
  'jpmorgan chase': 'jpmorgan.com', 'j p morgan': 'jpmorgan.com', 'bank of america': 'bankofamerica.com',
  'merrill lynch': 'ml.com', 'morgan stanley': 'morganstanley.com', 'citibank': 'citi.com',
  'citigroup': 'citi.com', 'citi': 'citi.com', 'wells fargo': 'wellsfargo.com', 'hsbc': 'hsbc.com',
  'barclays': 'barclays.com', 'ubs': 'ubs.com', 'deutsche bank': 'db.com', 'nomura': 'nomura.com',
  'mckinsey': 'mckinsey.com', 'mckinsey and company': 'mckinsey.com', 'deloitte': 'deloitte.com',
  'pwc': 'pwc.com', 'pricewaterhousecoopers': 'pwc.com', 'ernst and young': 'ey.com', 'ey': 'ey.com',
  'kpmg': 'kpmg.com', 'two sigma': 'twosigma.com', 'citadel': 'citadel.com',
  'citadel securities': 'citadelsecurities.com', 'jane street': 'janestreet.com', 'de shaw': 'deshaw.com',
  'd e shaw': 'deshaw.com', 'jump trading': 'jumptrading.com', 'virtu financial': 'virtu.com',
  'hudson river trading': 'hudsonrivertrading.com', 'optiver': 'optiver.com',
  'akuna capital': 'akunacapital.com', 'tower research capital': 'tower-research.com',
  'blackrock': 'blackrock.com', 'vanguard': 'vanguard.com', 'fidelity': 'fidelity.com',
  'fidelity investments': 'fidelity.com', 'pimco': 'pimco.com', 'lockheed martin': 'lmco.com',
  'northrop grumman': 'ngc.com', 'raytheon': 'rtx.com', 'rtx': 'rtx.com', 'boeing': 'boeing.com',
  'general dynamics': 'gd.com', 'l3harris': 'l3harris.com', 'spacex': 'spacex.com', 'at and t': 'att.com',
  'w w grainger': 'grainger.com', 'grainger': 'grainger.com', 'general motors': 'gm.com',
  'general electric': 'ge.com', 'procter and gamble': 'pg.com', 'johnson and johnson': 'jnj.com',
  'coca cola': 'coca-cola.com', 'ibm': 'ibm.com', 'meta': 'meta.com', 'facebook': 'meta.com',
  'alphabet': 'google.com', 'google': 'google.com', 'netflix': 'netflix.com', 'uber': 'uber.com',
  'lyft': 'lyft.com', 'airbnb': 'airbnb.com', 'stripe': 'stripe.com', 'coinbase': 'coinbase.com',
  'palantir': 'palantir.com', 'snowflake': 'snowflake.com', 'databricks': 'databricks.com',
  'datadog': 'datadoghq.com', 'github': 'github.com', 'linkedin': 'linkedin.com', 'scale ai': 'scale.com',
  'openai': 'openai.com', 'anthropic': 'anthropic.com', 'x': 'x.com',
}))

const LEGAL_SUFFIX = /\b(incorporated|inc|llc|l\s*l\s*c|ltd|limited|corp|corporation|co|company|plc|gmbh|ag|sa|holdings?)\b/g
// Words dropped when guessing "<name>.com"; kept in normalizeCompanyName so
// exact KNOWN_DOMAINS matches stay precise.
const GENERIC_WORDS = /\b(the|technologies|technology|solutions|services|systems|software|group|labs?|hq|global|international)\b/g

/** "Ernst & Young LLP, Inc." → "ernst and young llp". Used for exact matching. */
export function normalizeCompanyName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[.'’]/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(LEGAL_SUFFIX, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Bare, lowercase hostname from a URL, hostname or email domain — or null if
 * it isn't a public internet name (IPs, localhost, single labels). This is
 * also the SSRF guard for anything we later fetch as https://<domain>/…
 */
export function normalizeHost(input) {
  let raw = String(input || '').trim().toLowerCase()
  if (!raw) return null
  if (raw.includes('@')) raw = raw.slice(raw.lastIndexOf('@') + 1)
  if (!/^[a-z][a-z0-9+.-]*:\/\//.test(raw)) raw = `https://${raw}`
  let host
  try { host = new URL(raw).hostname } catch { return null }
  host = host.replace(/^www\d?\./, '').replace(/\.$/, '')
  const info = parseDomain(host)
  if (info.isIp || !info.domain || !info.publicSuffix || info.isPrivate) return null
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) return null
  return host
}

/** acme.wd1.myworkdayjobs.com → myworkdayjobs.com; careers.acme.co.uk → acme.co.uk */
export function registrableDomain(host) {
  const h = normalizeHost(host)
  return h ? parseDomain(h).domain : null
}

export function isJobBoardDomain(host) {
  const d = registrableDomain(host)
  return !d || JOB_BOARD_DOMAINS.has(d)
}

/** The company's own email domain from a careers/website URL, or null for job boards. */
export function companyDomainFromUrl(url) {
  const d = registrableDomain(url)
  return d && !JOB_BOARD_DOMAINS.has(d) ? d : null
}

export function knownDomainFor(name) {
  return KNOWN_DOMAINS.get(normalizeCompanyName(name)) || null
}

/** Primary slug for guesses: "Rocket Lab Inc." → "rocketlab" (never "rocket"). */
export function companySlug(name) {
  return normalizeCompanyName(name).replace(/\s+/g, '')
}

/** Slugs to try, most specific first: "Acme Labs" → ["acmelabs", "acme"]. */
export function companySlugCandidates(name) {
  const full = companySlug(name)
  const stripped = normalizeCompanyName(name).replace(GENERIC_WORDS, ' ').replace(/\s+/g, '')
  return [...new Set([full, stripped])].filter(s => s.length >= 2)
}

/**
 * Is `domain` plausibly this company's? Guards provider lookups ("company →
 * domain") that sometimes return a different company.
 */
export function isDomainPlausibleForCompany(domain, companyName) {
  const base = (registrableDomain(domain) || '').split('.')[0]
  if (!base) return false
  const tokens = normalizeCompanyName(companyName).replace(GENERIC_WORDS, ' ').split(' ').filter(t => t.length >= 3)
  if (!tokens.length) return true
  const joined = tokens.join('')
  if (base === joined || base.includes(joined) || joined.includes(base) && base.length >= 4) return true
  return tokens.some(t => base === t || (base.startsWith(t) && base.length - t.length <= 3) || (base.endsWith(t) && base.length - t.length <= 3))
}

/** Default verifier: does the domain have MX records? Free, ~50 ms, 3 s cap. */
export async function hasMailServer(domain, timeoutMs = 3000) {
  const lookup = dns.promises.resolveMx(domain).then(r => r.length > 0, () => false)
  const timeout = new Promise(resolve => setTimeout(() => resolve(false), timeoutMs))
  return Promise.race([lookup, timeout])
}

/**
 * Resolve the email domain for a company.
 *
 * @param {{name?: string, domain?: string|null, url?: string|null, domain_source?: string|null}} job
 * @param {object} [opts]
 * @param {string} [opts.override]           domain the user typed
 * @param {(d: string) => Promise<boolean>} [opts.verify]  MX check (injectable for tests)
 * @returns {Promise<{domain: string, source: string, verified: boolean} | null>}
 */
export async function resolveCompanyDomain(job, { override = null, verify = hasMailServer } = {}) {
  if (override) {
    const d = registrableDomain(override)
    if (d && !JOB_BOARD_DOMAINS.has(d)) return { domain: d, source: 'override', verified: true }
  }

  const known = knownDomainFor(job?.name)
  if (known) return { domain: known, source: 'known', verified: true }

  // A stored domain is trusted unless it was itself only a guess or is a job board.
  const stored = registrableDomain(job?.domain)
  if (stored && !JOB_BOARD_DOMAINS.has(stored) && job?.domain_source !== 'guess') {
    return { domain: stored, source: 'stored', verified: true }
  }

  const fromUrl = companyDomainFromUrl(job?.url)
  if (fromUrl) return { domain: fromUrl, source: 'careers', verified: true }

  // Last resort: guess from the name, but only keep a guess that receives mail.
  for (const slug of companySlugCandidates(job?.name)) {
    for (const tld of ['com', 'io', 'ai', 'co']) {
      const candidate = `${slug}.${tld}`
      if (await verify(candidate)) return { domain: candidate, source: 'mx', verified: false }
    }
  }
  return null
}
