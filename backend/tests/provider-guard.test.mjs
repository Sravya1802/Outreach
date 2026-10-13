import assert from 'node:assert/strict'
import test from 'node:test'
import { ProviderError, errorFromHttp, guarded, providerStatus, resetCooldowns, toReason } from '../services/providerGuard.js'

test('maps HTTP failures to codes', () => {
  assert.equal(errorFromHttp('hunter', 401).code, 'AUTH')
  assert.equal(errorFromHttp('hunter', 402).code, 'QUOTA')
  assert.equal(errorFromHttp('prospeo', 400, '{"error":"INSUFFICIENT_CREDITS"}').code, 'QUOTA')
  assert.equal(errorFromHttp('apollo', 403).code, 'AUTH')
  assert.equal(errorFromHttp('serper', 429).code, 'RATE_LIMIT')
  assert.equal(errorFromHttp('hunter', 500).code, 'HTTP')
})

test('quota errors put the provider on cooldown; later calls are skipped without calling', async () => {
  resetCooldowns()
  let calls = 0
  const quota = async () => { calls++; const e = new Error('Request failed'); e.response = { status: 402, data: {} }; throw e }
  await assert.rejects(guarded('hunter', quota), (e) => e instanceof ProviderError && e.code === 'QUOTA')
  await assert.rejects(guarded('hunter', quota), (e) => e.code === 'SKIPPED' && /out of credits/.test(e.message) && Boolean(e.retryAt))
  assert.equal(calls, 1)
  assert.equal(providerStatus('hunter').available, false)
  assert.equal(providerStatus('prospeo').available, true)
  assert.deepEqual(Object.keys(toReason(new ProviderError('hunter', 'QUOTA', 'x'))), ['provider', 'code', 'message'])
})

test('transient errors do not trip a cooldown', async () => {
  resetCooldowns()
  await assert.rejects(guarded('serper', async () => { throw new Error('socket hang up') }), (e) => e.code === 'NETWORK')
  assert.equal(providerStatus('serper').available, true)
  assert.equal(await guarded('serper', async () => 42), 42)
})
