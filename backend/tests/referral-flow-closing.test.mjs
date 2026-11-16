import assert from 'node:assert/strict'
import test from 'node:test'

process.env.DATABASE_URL ||= 'postgres://x'
const { closingEarly } = await import('../services/referralFlow.js')

test('closingEarly: within 3 days (today counts), or before the referral wait ends; never past or far away', () => {
  const now = new Date('2026-11-16T15:00:00Z') // Mon Nov 16, 9 AM Chicago
  assert.equal(closingEarly('2026-11-16', { now }), true)
  assert.equal(closingEarly('2026-11-19', { now }), true)
  assert.equal(closingEarly('2026-11-20', { now }), false)
  assert.equal(closingEarly('2026-11-21', { now, applyAfter: new Date('2026-11-23T14:00:00Z') }), true)
  assert.equal(closingEarly('2026-11-30', { now, applyAfter: new Date('2026-11-23T14:00:00Z') }), false)
  assert.equal(closingEarly('2026-11-15', { now }), false)
  assert.equal(closingEarly(null, { now }), false)
})

test('isOldPosting: 30 days or more', async () => {
  const { isOldPosting } = await import('../services/referralFlow.js')
  const now = new Date('2026-11-16T15:00:00Z')
  assert.equal(isOldPosting('2026-10-17T15:00:00Z', now), true)
  assert.equal(isOldPosting('2026-10-18T15:00:00Z', now), false)
  assert.equal(isOldPosting(null, now), false)
})
