import assert from 'node:assert/strict'
import test from 'node:test'

process.env.DATABASE_URL ||= 'postgres://x:y@127.0.0.1:1/z' // github.js imports db.js; no queries here
const env = { TOKEN_ENC_KEY: 'a'.repeat(64) }
process.env.TOKEN_ENC_KEY = env.TOKEN_ENC_KEY
const { open, seal, signState, verifyState } = await import('../services/secretBox.js')
const { readmeText, tokenColumns } = await import('../services/github.js')

test('sealed tokens round-trip and are not readable', () => {
  const s = seal('gho_secret', env)
  assert.ok(!s.includes('gho_secret'))
  assert.equal(open(s, env), 'gho_secret')
  assert.notEqual(seal('gho_secret', env), s, 'fresh IV each time')
  const tampered = s.slice(0, -2) + (s.endsWith('A') ? 'B' : 'A') + s.slice(-1)
  assert.throws(() => open(tampered, env))
  assert.throws(() => open(s, { TOKEN_ENC_KEY: 'b'.repeat(64) }), 'wrong key')
})

test('OAuth state is bound to the user, signed and expiring', () => {
  const now = 1_000_000
  const st = signState('user-1', { now, env })
  assert.equal(verifyState(st, { now: now + 1000, env }), 'user-1')
  assert.equal(verifyState(st, { now: now + 11 * 60_000, env }), null, 'expired')
  const [body, sig] = st.split('.')
  const forged = Buffer.from(JSON.stringify({ u: 'attacker', n: 'x', e: now + 60_000 })).toString('base64url')
  assert.equal(verifyState(`${forged}.${sig}`, { now, env }), null, 'body swap')
  assert.equal(verifyState(`${body}.x${sig.slice(1)}`, { now, env }), null, 'bad signature')
  assert.equal(verifyState('', { now, env }), null)
  assert.equal(verifyState('garbage', { now, env }), null)
})

test('token expiry becomes absolute; refresh token is optional', () => {
  const cols = tokenColumns({ access_token: 'a', expires_in: 28800, refresh_token: 'r', refresh_token_expires_in: 15897600, scope: '' }, 0)
  assert.equal(cols.access_expires_at, new Date(28_800_000).toISOString())
  assert.ok(cols.refresh_token.startsWith('v1.'))
  const noExpiry = tokenColumns({ access_token: 'a', scope: '' }, 0)
  assert.equal(noExpiry.access_expires_at, null)
  assert.equal(noExpiry.refresh_token, null)
})

test('README text drops badges, images, code and link targets', () => {
  const md = '# KafkaFlow\n[![build](https://x/badge.svg)](https://ci)\n![shot](img.png)\nStreams **500GB/day** with [Spark](https://spark.apache.org).\n```bash\nnpm i\n```\n<p align="center">hi</p>'
  const t = readmeText(md)
  assert.ok(t.startsWith('KafkaFlow'))
  assert.ok(t.includes('Streams 500GB/day with Spark.'))
  assert.ok(!/badge|img\.png|npm i|https?:|<p/.test(t), t)
})
