import assert from 'node:assert/strict'
import test from 'node:test'
import {
  companyDomainFromUrl, companySlug, isDomainPlausibleForCompany, isJobBoardDomain, knownDomainFor,
  companySlugCandidates, normalizeCompanyName, normalizeHost, registrableDomain, resolveCompanyDomain,
} from '../services/companyDomain.js'

const noMx = async () => false
const mxFor = (...domains) => async (d) => domains.includes(d)

test('known-company overrides match whole names only (audit regressions)', () => {
  assert.equal(knownDomainFor('HubSpot'), null)       // was ubs.com
  assert.equal(knownDomainFor('Disney'), null)        // was ey.com
  assert.equal(knownDomainFor('Honeywell'), null)     // was ey.com
  assert.equal(knownDomainFor('Metabase'), null)      // was meta.com
  assert.equal(knownDomainFor('Keystone Labs'), null) // was ey.com
  assert.equal(knownDomainFor('Citadel Securities'), 'citadelsecurities.com')
  assert.equal(knownDomainFor('Citadel'), 'citadel.com')
  assert.equal(knownDomainFor('Ernst & Young'), 'ey.com')
  assert.equal(knownDomainFor('Goldman Sachs Inc.'), 'gs.com')
  assert.equal(knownDomainFor('Meta'), 'meta.com')
})

test('name normalisation', () => {
  assert.equal(normalizeCompanyName('Procter & Gamble Co.'), 'procter and gamble')
  assert.equal(companySlug('Rocket Lab'), 'rocketlab')           // was rocket.com
  assert.equal(companySlug('Acme Technologies, Inc.'), 'acmetechnologies')
  assert.deepEqual(companySlugCandidates('Acme Technologies, Inc.'), ['acmetechnologies', 'acme'])
  assert.deepEqual(companySlugCandidates('Rocket Lab'), ['rocketlab', 'rocket'])
})

test('hosts: normalisation, registrable domain, SSRF-ish inputs', () => {
  assert.equal(normalizeHost('https://www.Acme.com/careers?x=1'), 'acme.com')
  assert.equal(normalizeHost('jane@acme.io'), 'acme.io')
  assert.equal(normalizeHost('acme.co.uk'), 'acme.co.uk')
  for (const bad of ['localhost', '127.0.0.1', 'http://10.0.0.1/x', 'intranet', 'foo.internal', '', null]) {
    assert.equal(normalizeHost(bad), null, String(bad))
  }
  assert.equal(registrableDomain('careers.acme.co.uk'), 'acme.co.uk')
  assert.equal(registrableDomain('acme.wd1.myworkdayjobs.com'), 'myworkdayjobs.com')
})

test('job boards and ATS hosts are never company domains', () => {
  for (const u of ['https://boards.greenhouse.io/acme', 'https://jobs.lever.co/acme', 'https://acme.wd1.myworkdaysite.com/x',
    'https://acme.breezy.hr', 'https://wellfound.com/role/r/software-engineer-intern', 'https://jobright.ai/jobs/internships',
    'https://www.linkedin.com/company/acme', 'https://github.com/acme', 'https://www.google.com/about/careers']) {
    assert.equal(isJobBoardDomain(u), true, u)
    assert.equal(companyDomainFromUrl(u), null, u)
  }
  assert.equal(companyDomainFromUrl('https://careers.acme.com/jobs/1'), 'acme.com')
})

test('plausibility check', () => {
  assert.equal(isDomainPlausibleForCompany('stripe.com', 'Stripe'), true)
  assert.equal(isDomainPlausibleForCompany('datadoghq.com', 'Datadog'), true)
  assert.equal(isDomainPlausibleForCompany('rocketlabusa.com', 'Rocket Lab'), true)
  assert.equal(isDomainPlausibleForCompany('ubs.com', 'HubSpot'), false)
  assert.equal(isDomainPlausibleForCompany('wellfound.com', 'Harvey'), false)
})

test('resolveCompanyDomain: precedence and verification', async () => {
  // override wins, but never a job board
  assert.deepEqual(await resolveCompanyDomain({ name: 'Acme' }, { override: 'https://acme.dev/x', verify: noMx }), { domain: 'acme.dev', source: 'override', verified: true })
  assert.equal((await resolveCompanyDomain({ name: 'Acme', url: 'https://acme.com' }, { override: 'greenhouse.io', verify: noMx })).source, 'careers')
  // known map before stored domain
  assert.equal((await resolveCompanyDomain({ name: 'Datadog', domain: 'datadog.com' }, { verify: noMx })).domain, 'datadoghq.com')
  // stored domain trusted unless it was a guess or a job board
  assert.equal((await resolveCompanyDomain({ name: 'HubSpot', domain: 'hubspot.com' }, { verify: noMx })).domain, 'hubspot.com')
  assert.equal((await resolveCompanyDomain({ name: 'Harvey', domain: 'wellfound.com', url: 'https://wellfound.com/x' }, { verify: noMx })), null)
  // careers URL used when it isn't an ATS
  assert.equal((await resolveCompanyDomain({ name: 'Acme', url: 'https://careers.acme.com/jobs' }, { verify: noMx })).domain, 'acme.com')
  // ATS URL → slug guesses, accepted only with MX, flagged unverified
  const guessed = await resolveCompanyDomain({ name: 'Harvey AI', url: 'https://boards.greenhouse.io/harvey' }, { verify: mxFor('harveyai.io', 'harvey.ai') })
  assert.deepEqual(guessed, { domain: 'harveyai.io', source: 'mx', verified: false })
  // known companies resolve without any guessing
  assert.equal((await resolveCompanyDomain({ name: 'Scale AI', url: 'https://boards.greenhouse.io/scaleai' }, { verify: noMx })).domain, 'scale.com')
  assert.equal(await resolveCompanyDomain({ name: 'Nonexistent Startup' }, { verify: noMx }), null)
  // a stored guess is not trusted next time — it's re-derived
  assert.equal((await resolveCompanyDomain({ name: 'Rocket Lab', domain: 'rocketlab.com', domain_source: 'guess' }, { verify: mxFor('rocketlab.com') })).source, 'mx')
})
