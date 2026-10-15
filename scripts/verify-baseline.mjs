#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// verify-baseline.mjs — re-runnable check for audit fixes #1–#4 against prod.
//
// Run before any fix deploys: every endpoint should return 401 ("pre-fix"),
// and the Vercel bundle should still contain the withAuthQuery pattern.
//
// Run after deploys: the four deprecated endpoints should return 410, and
// the Vercel bundle should no longer contain the withAuthQuery pattern in
// download/report URLs.
//
// Usage:
//   node scripts/verify-baseline.mjs
//   BACKEND_URL=https://staging.example.org FRONTEND_URL=... node scripts/verify-baseline.mjs
//
// Exits 0 — this is a *report*, not a CI gate. Read the table.
// ─────────────────────────────────────────────────────────────────────────────

const BACKEND_URL  = process.env.BACKEND_URL  || 'https://outreach-jt.duckdns.org'
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://scoutnjobs.vercel.app'

// Audit-flagged endpoints. Each entry says: how to call it, what the pre-fix
// status looks like, and what proves the fix is live.
const endpoints = [
  {
    label:    '#1 reclassify-unclassified',
    method:   'POST',
    path:     '/api/jobs/reclassify-unclassified',
    body:     {},
    preFix:   401,                  // endpoint reachable behind auth
    fixed:    'sql-scoping (only verifiable with two real JWTs)',
  },
  {
    label:    '#2a tracker/raw',
    method:   'GET',
    path:     '/api/career/tracker/raw',
    preFix:   401,
    fixed:    410,
  },
  {
    label:    '#2b reports list',
    method:   'GET',
    path:     '/api/career/reports',
    preFix:   401,
    fixed:    410,
  },
  {
    label:    '#2c reports/:filename',
    method:   'GET',
    path:     '/api/career/reports/anything.html',
    preFix:   401,
    fixed:    410,
  },
  {
    label:    '#3 legacy auto-apply',
    method:   'POST',
    path:     '/api/automations/auto-apply',
    body:     { jobs: [], mode: 'review' },
    preFix:   401,
    fixed:    410,
  },
  {
    label:    'health (sanity)',
    method:   'GET',
    path:     '/api/health',
    preFix:   200,
    fixed:    200,
  },
]

function classify(actual, e) {
  if (actual === e.fixed) return 'FIXED'
  if (actual === e.preFix) return 'pre-fix'
  return `unexpected (expected ${e.preFix} pre-fix or ${e.fixed} fixed)`
}

async function probeBackend() {
  console.log(`\n── Backend: ${BACKEND_URL} ──`)
  for (const e of endpoints) {
    try {
      const init = { method: e.method, headers: { 'Content-Type': 'application/json' } }
      if (e.body) init.body = JSON.stringify(e.body)
      const r = await fetch(BACKEND_URL + e.path, init)
      const verdict = typeof e.fixed === 'number' ? classify(r.status, e) : 'see notes'
      console.log(
        e.method.padEnd(4),
        String(r.status).padEnd(4),
        verdict.padEnd(10),
        e.label.padEnd(30),
        e.path,
      )
    } catch (err) {
      console.log(e.method.padEnd(4), 'ERR ', '         ', e.label.padEnd(30), e.path, '|', err.message)
    }
  }
}

// Audit fix #4: Vercel bundle should not include withAuthQuery's signature
// minified pattern. The function shape in api.js is:
//   url + (url.includes('?') ? '&' : '?') + 'access_token=' + encodeURIComponent(<token>)
// Minified, that compresses to something like:
//   "access_token="+encodeURIComponent(<id>)
// We grep for that fragment.
async function probeFrontend() {
  console.log(`\n── Frontend bundle: ${FRONTEND_URL} ──`)
  const html = await fetch(FRONTEND_URL).then(r => r.text())
  const m = html.match(/\/assets\/index-[\w-]+\.js/)
  if (!m) { console.log('no JS bundle in landing HTML — Vercel layout may have changed'); return }
  const bundleUrl = FRONTEND_URL + m[0]
  const js = await fetch(bundleUrl).then(r => r.text())

  // The withAuthQuery pattern. Match #1 (Supabase WS code) is excluded by
  // requiring `encodeURIComponent` adjacency.
  const withAuthMatches = [...js.matchAll(/access_token=`?\+\s*encodeURIComponent/g)]

  console.log('bundle:', m[0])
  console.log('size:  ', js.length, 'bytes')
  console.log('withAuthQuery pattern hits:', withAuthMatches.length, withAuthMatches.length === 0 ? '(FIXED)' : '(pre-fix)')

  // Show one context window so you can eyeball the verdict.
  const ctx = js.match(/.{50}access_token=`?\+\s*encodeURIComponent.{60}/)
  if (ctx) console.log('context:', ctx[0])
}

await probeBackend()
await probeFrontend()
console.log('\nDone. Re-run after each deploy to track progress.')
