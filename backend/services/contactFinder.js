// ── Find emails for a company / a person ─────────────────────────────────────
//
// Order is cheapest-and-most-accurate first, and stops as soon as the job is
// done, so credits aren't spent on lookups we don't need:
//
//   Company (bulk):  Hunter domain search (engineering + HR first, then
//                    everyone) → company website (free)
//                    → Prospeo domain search → Google (Serper)
//                    … stopping once there are relevant contacts.
//   Person:          Apollo match by LinkedIn URL (most accurate when we have
//                    it) → Hunter finder → Prospeo finder → website match
//                    … stopping at the first valid/risky email; an "invalid"
//                    result is a miss, never an answer.
//
// Every provider failure is collected as a user-facing reason ("Hunter is out
// of credits for this month") instead of turning into a silent "0 found".
import { resolveCompanyDomain } from './companyDomain.js';
import { betterCandidate, isGoodEnough, isRelevantContact, nameKey, splitName } from './contactRules.js';
import * as realProviders from './emailProviders.js';
import * as realUsage from './providerUsage.js';
import { providerStatus, toReason } from './providerGuard.js';

/** "jane.doe@acme.com" → "Jane Doe" (best effort) for emails that came without a name. */
export function nameFromEmailAddress(email) {
  const local = String(email || '').split('@')[0] || '';
  const parts = local.split(/[._-]+/).filter(p => /^[a-z]{2,}$/i.test(p));
  if (parts.length >= 2) return parts.slice(0, 3).map(p => p[0].toUpperCase() + p.slice(1).toLowerCase()).join(' ');
  return local || 'Unknown';
}

/**
 * An address built from the company's email pattern (Hunter's "{first}.{last}"),
 * e.g. Jane Doe at acme.com → jane.doe@acme.com. Null when the name doesn't fit
 * (initials only, one word).
 */
export function emailFromPattern(pattern, name, domain) {
  const n = splitName(name);
  if (!pattern || !n || !domain) return null;
  const ascii = s => s.toLowerCase().normalize('NFKD').replace(/[^a-z]/g, '');
  const first = ascii(n.first);
  const last = ascii(n.last);
  if (first.length < 2 || last.length < 2) return null;
  const local = String(pattern).toLowerCase()
    .replace(/\{first\}/g, first).replace(/\{last\}/g, last).replace(/\{f\}/g, first[0]).replace(/\{l\}/g, last[0]);
  return /^[a-z0-9][a-z0-9._-]*$/.test(local) ? `${local}@${domain}` : null;
}

function dedupeByEmail(list) {
  const out = new Map();
  for (const c of list) {
    const k = c.email.toLowerCase();
    out.set(k, betterCandidate(out.get(k), c));
  }
  return [...out.values()];
}

/**
 * @param {object} job  jobs row ({ name, domain, url, domain_source })
 * @param {object} [opts]
 * @param {string} [opts.override]  domain typed by the user
 * @param {object} [opts.providers] injectable for tests
 * @param {Function} [opts.verify]  MX check for guessed domains
 * @param {string} [opts.userId]    whose monthly provider budget to charge
 * @param {object} [opts.usage]     budget + shared cache (injectable for tests)
 */
export async function findCompanyEmails(job, { override = null, providers = realProviders, verify, userId = null, usage = realUsage } = {}) {
  const resolved = await resolveCompanyDomain(job, { override, ...(verify ? { verify } : {}) });
  if (!resolved) {
    return {
      domain: null, tried: [], candidates: [], filteredOut: 0,
      reasons: [{ provider: 'domain', code: 'DOMAIN_NEEDED', message: `Couldn't work out ${job.name}'s email domain — enter it (e.g. acme.com) and try again.` }],
    };
  }
  const { domain } = resolved;
  const tried = [];
  const reasons = [];
  let found = [];
  let pattern = null;
  const cachedFrom = [];
  // Domain searches are shared across users for CACHE_DAYS; only a cache
  // miss spends a credit (and the caller's monthly budget).
  const viaCache = async (provider, fetchFresh, variant = null) => {
    const { result, cached } = await usage.cachedDomainSearch(provider, variant ? `${domain}#${variant}` : domain, fetchFresh, { userId });
    if (cached) cachedFrom.push(provider);
    return result;
  };

  const steps = [
    ['hunter', async () => {
      // Engineering and HR people first; a plain search only when there are none.
      const focused = await viaCache('hunter', () => providers.hunterDomainSearch(domain, { department: 'it,hr' }), 'it,hr');
      pattern = focused.pattern;
      if (focused.emails.length) return focused.emails;
      const r = await viaCache('hunter', () => providers.hunterDomainSearch(domain));
      pattern = pattern || r.pattern;
      return r.emails;
    }],
    ['website', () => providers.websiteEmails(domain)],
    ['prospeo', () => viaCache('prospeo', () => providers.prospeoDomainSearch(domain))],
    ['serper', async () => { await usage.spend(userId, 'serper'); await usage.spend(userId, 'serper'); return providers.serperEmails(domain); }],
  ];
  for (const [name, run] of steps) {
    if (found.some(c => c.title && isRelevantContact(c.title))) break;
    if (name !== 'website' && !providers.isConfigured(name)) continue;
    tried.push(name);
    try {
      found.push(...await run());
    } catch (err) {
      reasons.push(toReason(err));
    }
  }

  found = dedupeByEmail(found).filter(c => c.status !== 'invalid');
  const relevant = found.filter(c => isRelevantContact(c.title));
  return {
    domain,
    domainSource: resolved.source,
    domainVerified: resolved.verified,
    pattern,
    tried,
    cachedFrom,
    reasons,
    candidates: relevant.map(c => ({ ...c, name: c.name || nameFromEmailAddress(c.email) })),
    filteredOut: found.length - relevant.length,
  };
}

/**
 * @param {object} contact job_contacts row ({ name, linkedin_url })
 * @param {object} job     jobs row
 */
export async function findPersonEmail(contact, job, { providers = realProviders, verify, userId = null, usage = realUsage } = {}) {
  const tried = [];
  const reasons = [];
  const person = splitName(contact.name);
  if (!person && !contact.linkedin_url) {
    return { best: null, tried, reasons: [{ provider: 'name', code: 'NAME_NEEDED', message: 'Need a first and last name (or a LinkedIn URL) to look up an email.' }] };
  }
  const resolved = await resolveCompanyDomain(job, verify ? { verify } : {});
  const domain = resolved?.domain || null;
  if (!domain) reasons.push({ provider: 'domain', code: 'DOMAIN_NEEDED', message: `Couldn't work out ${job.name}'s email domain — set it on the company to unlock Hunter and Prospeo.` });

  let best = null;
  const consider = (c) => { if (c && c.status !== 'invalid') best = betterCandidate(best, c); };

  const steps = [
    ['apollo', contact.linkedin_url ? () => providers.apolloMatch({ linkedinUrl: contact.linkedin_url }) : null],
    ['hunter', person && domain ? () => providers.hunterEmailFinder(domain, person.first, person.last) : null],
    ['prospeo', person && domain ? () => providers.prospeoEmailFinder(person.first, person.last, domain) : null],
    ['website', person && domain ? async () => {
      const list = await providers.websiteEmails(domain);
      const first = person.first.toLowerCase();
      const last = person.last.toLowerCase().replace(/\s+/g, '');
      return list.find(c => {
        const local = c.email.split('@')[0].replace(/[._-]/g, '');
        return local.includes(last) && (local.includes(first) || local.startsWith(first[0]));
      }) || null;
    } : null],
  ];
  for (const [name, run] of steps) {
    if (isGoodEnough(best)) break;
    if (!run) continue;
    if (name !== 'website' && !providers.isConfigured(name)) continue;
    // Cooling down (out of credits, or the plan doesn't allow it): don't spend the allowance on it.
    if (name !== 'website' && !providerStatus(name).available) { reasons.push({ provider: name, code: 'SKIPPED', message: providerStatus(name).message }); continue; }
    tried.push(name);
    try {
      if (name !== 'website') await usage.spend(userId, name);
      consider(await run());
    } catch (err) {
      reasons.push(toReason(err));
    }
  }
  return { best, tried, reasons, domain, domainSource: resolved?.source || null };
}

/**
 * Insert or enrich a contact without creating duplicates: matches an existing
 * row in the same company by email, LinkedIn URL or name, then fills in what
 * it was missing (an email for a LinkedIn-only person, a better status, a title).
 * @returns {Promise<'inserted'|'updated'|'unchanged'>}
 */
export async function upsertContact(db, { userId, jobId, contact, seniorityScore = 0 }) {
  const email = contact.email ? contact.email.toLowerCase() : null;
  const linkedin = contact.linkedin_url || null;
  const key = nameKey(contact.name);
  const rows = await db.all(
    `SELECT id, name, email, email_status, title, linkedin_url FROM job_contacts
      WHERE user_id = $1 AND job_id = $2
        AND (($3::text IS NOT NULL AND lower(email) = $3) OR ($4::text IS NOT NULL AND lower(linkedin_url) = lower($4)) OR $5::text <> '')`,
    [userId, jobId, email, linkedin, key],
  );
  const existing = rows.find(r => email && r.email?.toLowerCase() === email)
    || rows.find(r => linkedin && r.linkedin_url?.toLowerCase() === linkedin.toLowerCase())
    || rows.find(r => key && nameKey(r.name) === key);

  if (!existing) {
    const r = await db.run(
      `INSERT INTO job_contacts (job_id, user_id, name, title, linkedin_url, email, email_status, email_confidence, source, seniority_score, email_lookup_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, CASE WHEN $6::text IS NULL THEN NULL ELSE NOW() END)
       ON CONFLICT DO NOTHING`,
      [jobId, userId, contact.name || (email ? nameFromEmailAddress(email) : 'Unknown'), contact.title || '', linkedin, email,
        email ? contact.status || 'unverified' : 'unknown', contact.confidence ?? null, contact.source || 'unknown', seniorityScore],
    );
    return r.rowCount > 0 ? 'inserted' : 'unchanged';
  }

  const rank = { valid: 3, risky: 2, unverified: 1, unknown: 0, invalid: 0 };
  const upgradeEmail = email && (!existing.email || (existing.email.toLowerCase() !== email && (rank[contact.status] ?? 0) > (rank[existing.email_status] ?? 0)));
  const fillTitle = !existing.title && contact.title;
  const fillLinkedin = !existing.linkedin_url && linkedin;
  if (!upgradeEmail && !fillTitle && !fillLinkedin) return 'unchanged';
  await db.run(
    `UPDATE job_contacts SET
        email            = CASE WHEN $3 THEN $4 ELSE email END,
        email_status     = CASE WHEN $3 THEN $5 ELSE email_status END,
        email_confidence = CASE WHEN $3 THEN $6 ELSE email_confidence END,
        email_lookup_at  = CASE WHEN $3 THEN NOW() ELSE email_lookup_at END,
        title            = CASE WHEN $7 THEN $8 ELSE title END,
        linkedin_url     = CASE WHEN $9 THEN $10 ELSE linkedin_url END
      WHERE id = $1 AND user_id = $2`,
    [existing.id, userId, Boolean(upgradeEmail), email, contact.status || 'unverified', contact.confidence ?? null,
      Boolean(fillTitle), contact.title || '', Boolean(fillLinkedin), linkedin],
  );
  return 'updated';
}
