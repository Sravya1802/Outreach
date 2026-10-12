// Home happy-path: page renders for an authenticated user.
import { test, expect } from '@playwright/test'
import { skipWithoutAuthEnv } from './auth-env.js'

skipWithoutAuthEnv()

test('home renders for authed user', async ({ page }) => {
  await page.goto('/home')
  await expect(page.getByRole('heading', { name: /^(Good (morning|afternoon|evening)|Working late),/, level: 1 })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Pipeline' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Needs attention' })).toBeVisible()
})

test('old /dashboard bookmark lands on home', async ({ page }) => {
  await page.goto('/dashboard')
  await expect(page).toHaveURL(/\/home$/)
})
