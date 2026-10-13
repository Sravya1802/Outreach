import assert from 'node:assert/strict'
import test from 'node:test'
import { APPLIED, FAILED, IN_FLIGHT, OUTREACH_SENT, RESPONDED, sqlList } from '../services/applyStatus.js'

test('funnel stages are disjoint where they must be', () => {
  for (const s of IN_FLIGHT) assert.ok(!APPLIED.includes(s), `${s} is in flight, not applied`)
  for (const s of FAILED) assert.ok(!APPLIED.includes(s) && !IN_FLIGHT.includes(s), s)
  for (const s of RESPONDED) assert.ok(APPLIED.includes(s), `${s} implies applied`)
  assert.ok(!APPLIED.includes('queued') && !APPLIED.includes('opened'))
  assert.ok(OUTREACH_SENT.includes('replied'), 'a reply implies the message was sent')
})

test('sqlList renders constants and refuses anything else', () => {
  assert.equal(sqlList(['a_b', 'c']), "('a_b','c')")
  assert.throws(() => sqlList(["x'); DROP TABLE jobs;--"]))
})
