import assert from 'node:assert/strict'
import test from 'node:test'
import { assertPublicUrl, isPrivateAddress, safeFetch, UnsafeUrlError } from '../services/safeFetch.js'

const publicLookup = async () => ['93.184.216.34']

test('classifies private and public addresses', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.9', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', '::', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1', '224.0.0.1']) {
    assert.equal(isPrivateAddress(ip), true, ip)
  }
  for (const ip of ['93.184.216.34', '8.8.8.8', '172.32.0.1', '2606:4700::1111']) {
    assert.equal(isPrivateAddress(ip), false, ip)
  }
})

test('rejects unsafe URLs', async () => {
  const bad = [
    'file:///etc/passwd', 'ftp://example.com', 'http://localhost:3001/api', 'http://127.0.0.1/',
    'http://169.254.169.254/opc/v1/instance/', 'http://[::1]/', 'http://user:pw@example.com/',
    'http://example.com:22/', 'http://intranet.internal/', 'not a url',
  ]
  for (const u of bad) await assert.rejects(assertPublicUrl(u, { lookup: publicLookup }), UnsafeUrlError, u)
  // A public-looking name that resolves to a private IP (DNS rebinding style).
  await assert.rejects(assertPublicUrl('https://evil.example/', { lookup: async () => ['10.0.0.5'] }), UnsafeUrlError)
  // Mixed answers are rejected too.
  await assert.rejects(assertPublicUrl('https://evil.example/', { lookup: async () => ['93.184.216.34', '127.0.0.1'] }), UnsafeUrlError)
})

test('accepts public http(s) URLs', async () => {
  const u = await assertPublicUrl('https://boards.greenhouse.io/acme/jobs/1?x=1', { lookup: publicLookup })
  assert.equal(u.hostname, 'boards.greenhouse.io')
})

test('re-checks every redirect hop', async () => {
  const realFetch = globalThis.fetch
  globalThis.fetch = async (url) => {
    if (String(url).startsWith('https://public.example')) {
      return new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data' } })
    }
    return new Response('secret', { status: 200 })
  }
  try {
    await assert.rejects(safeFetch('https://public.example/job', { lookup: async (h) => (h === 'public.example' ? ['93.184.216.34'] : ['169.254.169.254']) }), UnsafeUrlError)
  } finally { globalThis.fetch = realFetch }
})

test('caps the body size', async () => {
  const realFetch = globalThis.fetch
  globalThis.fetch = async () => new Response('x'.repeat(5000), { status: 200 })
  try {
    const { res, text } = await safeFetch('https://public.example/', { lookup: publicLookup, maxBytes: 1000 })
    assert.equal(res.status, 200)
    assert.ok((await text()).length <= 1000)
  } finally { globalThis.fetch = realFetch }
})
