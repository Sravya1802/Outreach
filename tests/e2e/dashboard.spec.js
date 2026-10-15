// Home happy-path: page renders for an authenticated user.
import { test, expect } from '@playwright/test'
import { skipWithoutAuthEnv } from './auth-env.js'

skipWithoutAuthEnv()

test('home renders for authed user', async ({ page }) => {
  await page.goto('/home')
  await expect(page.getByRole('heading', { name: /^(Good (morning|afternoon|evening)|Working late),/, level: 1 })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'So far' })).toBeVisible()
})

test('dashboard shows the analytics', async ({ page }) => {
  await page.goto('/dashboard')
  await expect(page.getByRole('heading', { name: 'Dashboard', level: 1 })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Applications per week' })).toBeVisible()
})

test('old Pipeline links land on the Auto-apply tracker', async ({ page }) => {
  await page.goto('/applications/pipeline')
  await expect(page).toHaveURL(/\/applications\/auto-apply#tracker$/)
  await expect(page.getByRole('heading', { name: 'After you apply' })).toBeVisible()
})
