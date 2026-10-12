// exercises services/claude.js against a mocked Anthropic API.
import assert from 'node:assert/strict'
import test from 'node:test'
import { CLAUDE_MODEL, ClaudeRefusalError, claudeText, hasClaudeKey } from '../services/claude.js'

process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key'

function mockFetch(body, capture) {
  return async (url, init) => {
    capture.url = String(url)
    capture.headers = Object.fromEntries(new Headers(init.headers).entries())
    capture.body = JSON.parse(init.body)
    return new Response(JSON.stringify({
      id: 'msg_test', type: 'message', role: 'assistant', model: CLAUDE_MODEL,
      usage: { input_tokens: 10, output_tokens: 5 }, stop_details: null, ...body,
    }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
}

test('sends the current request shape and returns text', async () => {
  const cap = {}
  const text = await claudeText({
    system: 'rubric', user: 'evaluate', effort: 'high', cacheSystem: true,
    clientOptions: { fetch: mockFetch({ stop_reason: 'end_turn', content: [{ type: 'text', text: ' {"ok":true} ' }] }, cap) },
  })
  assert.equal(text, '{"ok":true}')
  assert.match(cap.url, /\/v1\/messages\?beta=true$/)
  assert.match(cap.headers['anthropic-beta'], /server-side-fallback-2026-07-01/)
  assert.equal(cap.body.model, 'claude-opus-5-5')
  assert.equal(cap.body.fallbacks, 'default')
  assert.deepEqual(cap.body.output_config, { effort: 'high' })
  assert.equal(cap.body.max_tokens, 16000)
  assert.deepEqual(cap.body.system, [{ type: 'text', text: 'rubric', cache_control: { type: 'ephemeral' } }])
  for (const banned of ['temperature', 'top_p', 'top_k', 'thinking', 'betas']) assert.ok(!(banned in cap.body), `${banned} must not be sent`)
})

test('reads text by block type when thinking comes first', async () => {
  const text = await claudeText({
    user: 'hi', effort: 'low',
    clientOptions: { fetch: mockFetch({ stop_reason: 'end_turn', content: [
      { type: 'thinking', thinking: '', signature: 'sig' },
      { type: 'text', text: 'Hello' }, { type: 'text', text: ' there' },
    ] }, {}) },
  })
  assert.equal(text, 'Hello there')
})

test('omits system when none is given', async () => {
  const cap = {}
  await claudeText({ user: 'hi', effort: 'medium', clientOptions: { fetch: mockFetch({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'x' }] }, cap) } })
  assert.ok(!('system' in cap.body))
})

test('throws a typed error on refusal', async () => {
  await assert.rejects(
    claudeText({ user: 'x', effort: 'low', clientOptions: { fetch: mockFetch({ stop_reason: 'refusal', stop_details: { type: 'refusal', category: 'cyber' }, content: [] }, {}) } }),
    err => err instanceof ClaudeRefusalError && err.category === 'cyber',
  )
})

test('throws when the reply is truncated or empty', async () => {
  await assert.rejects(
    claudeText({ user: 'x', effort: 'low', clientOptions: { fetch: mockFetch({ stop_reason: 'max_tokens', content: [{ type: 'text', text: '{"partial' }] }, {}) } }),
    /cut off at max_tokens/,
  )
  await assert.rejects(
    claudeText({ user: 'x', effort: 'low', clientOptions: { fetch: mockFetch({ stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '', signature: 's' }] }, {}) } }),
    /no text/,
  )
})

test('requires an explicit effort', async () => {
  await assert.rejects(claudeText({ user: 'x' }), /effort is required/)
})

test('treats placeholder keys as missing', () => {
  process.env.ANTHROPIC_API_KEY = 'optional_fallback'
  assert.equal(hasClaudeKey(), false)
  process.env.ANTHROPIC_API_KEY = ''
  assert.equal(hasClaudeKey(), false)
  process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key'
  assert.equal(hasClaudeKey(), true)
})
