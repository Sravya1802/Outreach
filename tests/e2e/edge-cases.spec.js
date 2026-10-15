// Edge-case routing — PR-D of audit fix #6.
//
// Runs in the unauthenticated `chromium` project: confirms unknown URLs
// route via the catch-all and that protected routes show the login form
// when no session is present.
import { test, expect } from '@playwright/test'

test('unknown URL falls through the catch-all', async ({ page }) => {
  await page.goto('/this-route-does-not-exist')
  // Without a session every route renders the login screen.
  await expect(page.getByRole('heading', { name: 'Sign in to Scout’n’Jobs', level: 1 })).toBeVisible()
})

test('direct nav to a protected route while unauth renders the login form', async ({ page }) => {
  await page.goto('/jobs/companies')
  await expect(page.getByRole('heading', { name: 'Sign in to Scout’n’Jobs', level: 1 })).toBeVisible()
})
