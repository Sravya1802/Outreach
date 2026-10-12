// ─────────────────────────────────────────────────────────────────────────────
// auth.setup.js — runs once before the e2e suite and stashes a logged-in
// session in storageState. Subsequent specs reuse it via Playwright's
// dependsOn project relationship (see playwright.config.js).
//
// Reads E2E_TEST_EMAIL/E2E_TEST_PASSWORD from env in CI to mint a fresh
// session. E2E_REFRESH_TOKEN remains as a local fallback, but refresh tokens
// rotate and are too brittle for repeated scheduled GitHub runs.
//
// Supabase URL + publishable key are public, but keep them in env so the
// harness keeps working after legacy JWT anon keys are disabled or rotated.
// ─────────────────────────────────────────────────────────────────────────────

import { test as setup, expect } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SUPABASE_URL =
  process.env.E2E_SUPABASE_URL ||
  process.env.VITE_SUPABASE_URL ||
  'https://dkifhfqgoremdjhkcojc.supabase.co'
const SUPABASE_PUBLISHABLE_KEY = (
  process.env.E2E_SUPABASE_PUBLISHABLE_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY ||
  ''
).trim()
const STORAGE_KEY   = 'sb-dkifhfqgoremdjhkcojc-auth-token'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const STORAGE_PATH = path.join(__dirname, '.auth', 'storage.json')

setup('sign in and save storage state', async ({ page }) => {
  const email = process.env.E2E_TEST_EMAIL
  const password = process.env.E2E_TEST_PASSWORD
  const rt = process.env.E2E_REFRESH_TOKEN

  if (!SUPABASE_PUBLISHABLE_KEY) {
    setup.skip(true, 'E2E_SUPABASE_PUBLISHABLE_KEY not set — use the Supabase sb_publishable_ key after disabling legacy API keys.')
  }
  if (!SUPABASE_PUBLISHABLE_KEY.startsWith('sb_publishable_')) {
    throw new Error('E2E_SUPABASE_PUBLISHABLE_KEY must start with sb_publishable_. The current GitHub secret appears to be the old legacy anon key.')
  }
  if ((!email || !password) && !rt) {
    setup.skip(true, 'Set E2E_TEST_EMAIL + E2E_TEST_PASSWORD for CI, or E2E_REFRESH_TOKEN as a local fallback.')
  }

  // Password auth gives CI a fresh session each run. Refresh-token fallback is
  // kept for local one-off runs, but should not be used for scheduled CI
  // because Supabase refresh tokens rotate.
  const grantType = email && password ? 'password' : 'refresh_token'
  const body = grantType === 'password'
    ? { email, password }
    : { refresh_token: rt }
  const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=${grantType}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SUPABASE_PUBLISHABLE_KEY },
    body: JSON.stringify(body),
  })
  if (!r.ok) {
    throw new Error(`Supabase ${grantType} auth failed (${r.status}): ${(await r.text()).slice(0, 200)}`)
  }
  const session = await r.json()

  // Visit the app once to let it set the supabase client up; then inject the
  // session into localStorage and persist storage state for downstream specs.
  await page.goto('/')
  await page.evaluate(([k, v]) => localStorage.setItem(k, JSON.stringify(v)), [STORAGE_KEY, session])

  // Reload so the supabase client picks up the session and the app routes to
  // the authenticated layout.
  await page.reload()

  // Sanity: the dashboard renders something only an authed user sees.
  // Use a reasonably-stable selector that doesn't depend on data presence.
  await expect(page).toHaveURL(/\/home/, { timeout: 10_000 })

  await page.context().storageState({ path: STORAGE_PATH })
})
