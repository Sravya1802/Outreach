// Edge-case routing for an authenticated session — PR-D of audit fix #6.
//
// Runs in the `chromium-authed` project. Confirms the catch-all route
// redirects unknown paths to /home while logged in, instead of
// rendering a 404 page or the login form.
import { test, expect } from '@playwright/test'
import { skipWithoutAuthEnv } from './auth-env.js'

skipWithoutAuthEnv()

test('unknown URL redirects to /home when authenticated', async ({ page }) => {
  await page.goto('/this-route-does-not-exist')
  await expect(page).toHaveURL(/\/home$/, { timeout: 5_000 })
  await expect(page.getByRole('heading', { name: /^(Good (morning|afternoon|evening)|Working late),/, level: 1 })).toBeVisible()
})
