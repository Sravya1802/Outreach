import assert from 'node:assert/strict'
import test from 'node:test'

process.env.DATABASE_URL ||= 'postgres://x:y@127.0.0.1:1/z' // llm.js imports db.js; these tests make no queries
const { BudgetExceededError, ROUTES, caps, costOf, estimateCost } = await import('../services/llm.js')

test('routes follow the agreed split', () => {
  for (const t of ['score', 'evaluate', 'email', 'categorize']) {
    assert.equal(ROUTES[t][0].provider, 'groq', t)
    assert.ok(ROUTES[t].every(s => s.provider !== 'anthropic'), `${t} must never reach Opus`)
  }
  for (const t of ['resume', 'cover_letter']) {
    assert.deepEqual(ROUTES[t].map(s => s.model), ['claude-opus-5-5'], `${t} is Opus only, no silent downgrade`)
  }
  assert.ok(ROUTES.evaluate.every(s => s.model !== 'gpt-4o'), 'backup stays on the cheap model')
  for (const t of ['keywords', 'evaluate']) assert.equal(ROUTES[t][1].provider, 'gemini', `${t} falls back to Gemini before OpenAI`)
})

test('costs per call', () => {
  // 9k in / 3.5k out evaluation on Groq gpt-oss-120b ≈ $0.0035
  assert.equal(costOf('groq:openai/gpt-oss-120b', { input: 9000, output: 3500 }).toFixed(5), '0.00345')
  // Opus resume 7.5k in / 6k out (incl. thinking) ≈ $0.15
  assert.equal(costOf('anthropic:claude-opus-5-5', { input: 7500, output: 6000 }).toFixed(2), '0.15')
  // cached input is billed at the cached rate
  assert.ok(costOf('anthropic:claude-opus-5-5', { cachedInput: 10000 }) < costOf('anthropic:claude-opus-5-5', { input: 10000 }) / 5)
  assert.equal(costOf('nope:model', { input: 1e6 }), 0)
  // Worst case uses the full output ceiling
  assert.equal(estimateCost('anthropic:claude-opus-5-5', { user: 'x'.repeat(4000), maxTokens: 16000 }).toFixed(3), '0.324')
})

test('caps come from env with safe defaults', () => {
  assert.deepEqual(caps({}), { site: 40, user: 30 })
  assert.deepEqual(caps({ AI_MONTHLY_CAP_USD: '25', AI_USER_MONTHLY_CAP_USD: 'oops' }), { site: 25, user: 30 })
  const e = new BudgetExceededError('user', 29.9, 30)
  assert.equal(e.status, 402)
  assert.match(e.message, /\$29\.90 of \$30\.00/)
})
