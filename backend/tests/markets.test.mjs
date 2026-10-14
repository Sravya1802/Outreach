import assert from 'node:assert/strict'
import test from 'node:test'

process.env.DATABASE_URL ||= 'postgres://x:y@127.0.0.1:1/z' // markets.js imports db.js; no queries here
const { isIndiaLocation, isMarket, regionForMarket, regionForRole } = await import('../services/markets.js')
const { toCatalogRow } = await import('../services/jobSpy.js')

test('India is matched by whole place names only', () => {
  for (const loc of ['Bengaluru, India', 'Remote - India', 'Pune, Maharashtra', 'New Delhi', 'Gurugram, India +2', 'HYDERABAD']) assert.ok(isIndiaLocation(loc), loc)
  for (const loc of ['Indianapolis, IN', 'Remote - Indiana, USA', 'Punxsutawney, PA', '', null]) assert.ok(!isIndiaLocation(loc), String(loc))
})

test('international rows in India become india; USA rows stay USA', () => {
  assert.equal(regionForRole({ region: 'intl', location: 'Bengaluru, India' }), 'india')
  assert.equal(regionForRole({ region: 'intl', location: 'London, UK' }), 'intl')
  assert.equal(regionForRole({ region: 'usa', location: 'Seattle, WA; Hyderabad, India' }), 'usa')
  assert.equal(regionForRole({ region: 'india', location: null }), 'india')
  assert.equal(regionForRole({ location: 'Austin, TX' }), 'usa')
})

test('markets map to catalog regions', () => {
  assert.equal(regionForMarket('usa'), 'usa')
  assert.equal(regionForMarket('india'), 'india')
  assert.equal(regionForMarket('other'), 'intl')
  assert.equal(regionForMarket(undefined), 'usa')
  assert.ok(isMarket('india') && !isMarket('intl') && !isMarket(''))
})

test('JobSpy India rows carry the india region', () => {
  const r = toCatalogRow({ site: 'indeed', title: 'Software Engineer Fresher', company: 'Zoho', job_url: 'https://in.indeed.com/viewjob?jk=1', location: 'Chennai, Tamil Nadu' }, 'new_grad', 'india')
  assert.equal(r.region, 'india')
})
