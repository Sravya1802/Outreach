import assert from 'node:assert/strict'
import test from 'node:test'
import { prospeoEnrich, prospeoSearchPeople } from '../services/emailProviders.js'
import { resetCooldowns } from '../services/providerGuard.js'

process.env.PROSPEO_API_KEY = 'test-key-1234567890'
const realFetch = globalThis.fetch
function answer(status, body, seen = []) {
  globalThis.fetch = async (url, init) => { seen.push({ url, body: JSON.parse(init.body) }); return { ok: status < 400, status, text: async () => JSON.stringify(body) } }
  return seen
}
test.afterEach(() => { globalThis.fetch = realFetch; resetCooldowns() })

test('Prospeo search: US recruiters at the company, emails stay hidden but "verified" is kept', async () => {
  const seen = answer(200, { error: false, results: [
    { person: { full_name: 'Lisa Mauro', current_job_title: 'Recruiter', linkedin_url: 'https://www.linkedin.com/in/lisa', person_id: 'p1', email: { status: 'VERIFIED', revealed: false, email: 'l****@ibm.com' } } },
    { person: { full_name: 'Sean Jett', current_job_title: 'Recruiter', linkedin_url: 'https://www.linkedin.com/in/sean', person_id: 'p2', email: { status: 'UNAVAILABLE' } } },
  ] })
  const people = await prospeoSearchPeople('ibm.com', ['recruiter'])
  assert.equal(seen[0].url, 'https://api.prospeo.io/search-person')
  assert.deepEqual(seen[0].body.filters.company.websites.include, ['ibm.com'])
  assert.deepEqual(seen[0].body.filters.person_location_search.include, ['United States'])
  assert.deepEqual(people.map(p => [p.name, p.verified]), [['Lisa Mauro', true], ['Sean Jett', false]])
})

test('Prospeo enrich: a revealed verified email is valid; NO_MATCH is a miss, not an error', async () => {
  answer(200, { error: false, person: { first_name: 'Lisa', last_name: 'Mauro', email: { status: 'VERIFIED', revealed: true, email: 'lisa.mauro@ibm.com' } } })
  const hit = await prospeoEnrich({ personId: 'p1' })
  assert.equal(hit.email, 'lisa.mauro@ibm.com')
  assert.equal(hit.status, 'valid')
  answer(400, { error: true, error_code: 'NO_MATCH' })
  assert.equal(await prospeoEnrich({ personId: 'p2' }), null)
  answer(400, { error: true, error_code: 'INSUFFICIENT_CREDITS' })
  await assert.rejects(prospeoEnrich({ personId: 'p3' }), e => e.code === 'QUOTA')
})
