// ─────────────────────────────────────────────────────────────────────────────
// Playwright config — Scout’n’Jobs e2e tests.
//
// PR-A landed the harness + landing page smoke test (auth.spec.js).
// PR-B adds:
//   - auth.setup.js   — runs once, stashes storageState via Supabase refresh
//   - 6 happy-path specs that reuse the storageState (chromium-authed project)
//
// PLAYWRIGHT_BASE_URL overrides the target (default: prod Vercel).
// E2E_REFRESH_TOKEN is required for any spec under chromium-authed; the
// chromium project (unauthenticated) runs without it.
//
// Browsers: `npm run test:e2e:install` (chromium only).
// ─────────────────────────────────────────────────────────────────────────────

import { defineConfig, devices } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const STORAGE_PATH = path.join(__dirname, 'tests/e2e/.auth/storage.json')

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  fullyParallel: false,
  retries: process.env.CI ? 2 : 0,
  reporter: [['list']],
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'https://scoutnjobs.vercel.app',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    // 1. Setup — runs first, stashes storageState. Skipped if no refresh token.
    {
      name: 'setup',
      testMatch: /auth\.setup\.js/,
      use: { ...devices['Desktop Chrome'] },
    },

    // 2. Unauthenticated specs: landing-page smoke (PR-A) + the auth-required
    //    regression suite (PR-C) which probes protected endpoints without
    //    credentials and asserts 401, plus PR-D edge-case routing.
    {
      name: 'chromium',
      testMatch: [/auth\.spec\.js$/, /auth-required\.spec\.js$/, /edge-cases\.spec\.js$/],
      use: { ...devices['Desktop Chrome'] },
    },

    // 3. Authenticated specs (PR-B + PR-D edge-cases-authed). Reuses storageState.
    {
      name: 'chromium-authed',
      testIgnore: [/auth\.spec\.js$/, /auth-required\.spec\.js$/, /^.*edge-cases\.spec\.js$/, /auth\.setup\.js$/, /\.mobile\.spec\.js$/],
      use: {
        ...devices['Desktop Chrome'],
        storageState: STORAGE_PATH,
      },
      dependencies: ['setup'],
    },

    // 4. Mobile viewport (PR-C). Runs only specs ending in .mobile.spec.js
    //    against a Pixel 7 emulation (chromium-based — keeps the browser
    //    install footprint small; webkit isn't required).
    {
      name: 'mobile-pixel',
      testMatch: /\.mobile\.spec\.js$/,
      use: {
        ...devices['Pixel 7'],
        storageState: STORAGE_PATH,
      },
      dependencies: ['setup'],
    },
  ],
})
