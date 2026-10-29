import assert from 'node:assert/strict'
import test from 'node:test'
import { emailFromPattern, findCompanyEmails, findPersonEmail, nameFromEmailAddress, upsertContact } from '../services/contactFinder.js'
import { ProviderError } from '../services/providerGuard.js'

const noMx = async () => false
// No DB in unit tests: pass-through cache, unlimited budget.
const usage = { spend: async () => {}, cachedDomainSearch: async (_p, _d, fresh) => ({ result: await fresh(), cached: false }) }
const c = (email, extra = {}) => ({ email, name: null, title: '', linkedin_url: null, status: 'unverified', confidence: null, source: 'x', ...extra })

function fakeProviders(overrides = {}, configured = ['hunter', 'prospeo', 'serper', 'apollo']) {
  const calls = []
  const wrap = (name, fn) => async (...args) => { calls.push(name); return fn(...args) }
  return {
    calls,
    isConfigured: (p) => configured.includes(p),
    hunterDomainSearch: wrap('hunter', overrides.hunterDomainSearch || (async () => ({ emails: [], pattern: null }))),
    websiteEmails: wrap('website', overrides.websiteEmails || (async () => [])),
    serperEmails: wrap('serper', overrides.serperEmails || (async () => [])),
    apolloMatch: wrap('apollo', overrides.apolloMatch || (async () => null)),
    hunterEmailFinder: wrap('hunterFinder', overrides.hunterEmailFinder || (async () => null)),
    prospeoEmailFinder: wrap('prospeoFinder', overrides.prospeoEmailFinder || (async () => null)),
  }
}

test('company: stops after Hunter when it finds relevant people', async () => {
  const p = fakeProviders({ hunterDomainSearch: async () => ({ emails: [c('jane@acme.com', { title: 'Software Engineer', name: 'Jane Doe', status: 'valid' }), c('bob@acme.com', { title: 'Account Executive' })], pattern: '{first}' }) })
  const r = await findCompanyEmails({ name: 'Acme', url: 'https://acme.com/careers' }, { providers: p, verify: noMx, usage })
  assert.equal(r.domain, 'acme.com')
  assert.deepEqual(p.calls, ['hunter'])
  assert.deepEqual(r.candidates.map(x => x.email), ['jane@acme.com'])
  assert.equal(r.filteredOut, 1)
  assert.equal(r.pattern, '{first}')
})

test('company: quota error is reported and the waterfall continues', async () => {
  const p = fakeProviders({
    hunterDomainSearch: async () => { throw new ProviderError('hunter', 'QUOTA', 'Hunter is out of credits for this month') },
    websiteEmails: async () => [c('cto@acme.com', { source: 'website', status: 'risky' })],
  })
  const r = await findCompanyEmails({ name: 'Acme', domain: 'acme.com' }, { providers: p, verify: noMx, usage })
  assert.deepEqual(p.calls, ['hunter', 'website', 'serper']) // website rows have no title → keep looking
  assert.equal(r.reasons[0].code, 'QUOTA')
  assert.deepEqual(r.candidates.map(x => x.email), ['cto@acme.com']) // title-less kept
  assert.equal(r.candidates[0].name, 'cto')
})

test('company: no trustworthy domain → asks the user instead of guessing', async () => {
  const p = fakeProviders()
  const r = await findCompanyEmails({ name: 'Harvey', url: 'https://wellfound.com/company/harvey' }, { providers: p, verify: noMx, usage })
  assert.equal(r.domain, null)
  assert.equal(r.reasons[0].code, 'DOMAIN_NEEDED')
  assert.deepEqual(p.calls, [])
})

test('company: unconfigured providers are skipped, invalid emails dropped', async () => {
  const p = fakeProviders({ websiteEmails: async () => [c('x@acme.com', { status: 'invalid', title: 'Engineer' })] }, [])
  const r = await findCompanyEmails({ name: 'Acme', domain: 'acme.com' }, { providers: p, verify: noMx, usage })
  assert.deepEqual(p.calls, ['website'])
  assert.equal(r.candidates.length, 0)
})

test('person: LinkedIn match first; stops at a good result', async () => {
  const p = fakeProviders({ apolloMatch: async () => c('jane@acme.com', { status: 'valid', source: 'apollo' }) })
  const r = await findPersonEmail({ name: 'Jane Doe', linkedin_url: 'https://linkedin.com/in/jane' }, { name: 'Acme', domain: 'acme.com' }, { providers: p, verify: noMx, usage })
  assert.deepEqual(p.calls, ['apollo'])
  assert.equal(r.best.email, 'jane@acme.com')
})

test('person: invalid is a miss, unverified keeps searching, best wins', async () => {
  const p = fakeProviders({
    hunterEmailFinder: async () => c('jane@acme.com', { status: 'invalid' }),
    prospeoEmailFinder: async () => c('j.doe@acme.com', { status: 'unverified' }),
    websiteEmails: async () => [c('jane.doe@acme.com', { status: 'risky' })],
  })
  const r = await findPersonEmail({ name: 'Dr. Jane Doe, PhD' }, { name: 'Acme', domain: 'acme.com' }, { providers: p, verify: noMx, usage })
  assert.deepEqual(p.calls, ['hunterFinder', 'prospeoFinder', 'website'])
  assert.equal(r.best.email, 'jane.doe@acme.com')
})

test('person: needs a name or LinkedIn URL', async () => {
  const r = await findPersonEmail({ name: 'Cher' }, { name: 'Acme', domain: 'acme.com' }, { providers: fakeProviders(), verify: noMx, usage })
  assert.equal(r.reasons[0].code, 'NAME_NEEDED')
})

test('nameFromEmailAddress', () => {
  assert.equal(nameFromEmailAddress('jane.doe@acme.com'), 'Jane Doe')
  assert.equal(nameFromEmailAddress('jdoe@acme.com'), 'jdoe')
})

test('upsertContact enriches an existing LinkedIn-only person instead of dropping the email', async () => {
  const rows = [{ id: 7, name: 'Jane Doe', email: null, email_status: 'unknown', title: 'Engineer', linkedin_url: 'https://linkedin.com/in/jane' }]
  const runs = []
  const db = { all: async () => rows, run: async (sql, params) => { runs.push({ sql, params }); return { rowCount: 1 } } }
  const out = await upsertContact(db, { userId: 'u', jobId: 1, contact: { name: 'Jane Doe', email: 'Jane@Acme.com', status: 'valid', source: 'hunter' } })
  assert.equal(out, 'updated')
  assert.match(runs[0].sql, /^\s*UPDATE job_contacts/)
  assert.equal(runs[0].params[3], 'jane@acme.com')

  const out2 = await upsertContact(db, { userId: 'u', jobId: 1, contact: { name: 'Jane Doe', email: 'jane@acme.com', status: 'unverified' } })
  assert.equal(out2, 'updated') // rows fake still has email null; real DB would be 'unchanged'
  const db2 = { all: async () => [], run: async (sql) => { runs.push({ sql }); return { rowCount: 1 } } }
  assert.equal(await upsertContact(db2, { userId: 'u', jobId: 1, contact: { name: null, email: 'bob.smith@acme.com' } }), 'inserted')
  assert.match(runs.at(-1).sql, /INSERT INTO job_contacts/)
})

test('company: a cached domain search is reused and reported', async () => {
  const p = fakeProviders({ hunterDomainSearch: async () => { throw new Error('should not be called') } })
  const cachedUsage = { spend: async () => {}, cachedDomainSearch: async () => ({ result: { emails: [c('jane@acme.com', { title: 'Engineer', status: 'valid' })], pattern: null }, cached: true }) }
  const r = await findCompanyEmails({ name: 'Acme', domain: 'acme.com' }, { providers: p, verify: noMx, usage: cachedUsage })
  assert.deepEqual(r.cachedFrom, ['hunter'])
  assert.equal(r.candidates.length, 1)
})

test('person: an exhausted budget is a reason, not a crash, and skips the call', async () => {
  const p = fakeProviders({ hunterEmailFinder: async () => { throw new Error('should not be called') } })
  const budgetUsage = { ...usage, spend: async (_u, prov) => { if (prov === 'hunter') throw new ProviderError('hunter', 'BUDGET', 'used your 15 Hunter lookups') } }
  const r = await findPersonEmail({ name: 'Jane Doe' }, { name: 'Acme', domain: 'acme.com' }, { providers: p, verify: noMx, usage: budgetUsage, userId: 'u' })
  assert.equal(r.reasons[0].code, 'BUDGET')
  assert.ok(p.calls.includes('prospeoFinder'), 'falls through to the next provider')
  assert.ok(!p.calls.includes('hunterFinder'))
})

test('company: Hunter asks for engineering + HR first, everyone only when that comes back empty', async () => {
  const asked = []
  const p = fakeProviders({ hunterDomainSearch: async (_d, opts = {}) => {
    asked.push(opts.department || 'all')
    return opts.department ? { emails: [], pattern: '{first}.{last}' } : { emails: [c('jane@acme.com', { title: 'Software Engineer', status: 'valid' })], pattern: null }
  } })
  const r = await findCompanyEmails({ name: 'Acme', domain: 'acme.com' }, { providers: p, verify: noMx, usage })
  assert.deepEqual(asked, ['it,hr', 'all'])
  assert.equal(r.pattern, '{first}.{last}')
  assert.deepEqual(r.candidates.map(x => x.email), ['jane@acme.com'])
})

test('emailFromPattern builds the address from a name, skips initials', () => {
  assert.equal(emailFromPattern('{first}.{last}', 'Marie Laser Buzzetti', 'ibm.com'), 'marie.buzzetti@ibm.com')
  assert.equal(emailFromPattern('{f}{last}', 'Dr. José Núñez, PhD', 'acme.com'), 'jnunez@acme.com')
  assert.equal(emailFromPattern('{first}', 'Jane Doe', 'acme.com'), 'jane@acme.com')
  assert.equal(emailFromPattern('{first}.{last}', 'A B Vijay Kumar', 'ibm.com'), null)
  assert.equal(emailFromPattern('{first}.{last}', 'Cher', 'acme.com'), null)
  assert.equal(emailFromPattern(null, 'Jane Doe', 'acme.com'), null)
})
