// Jobs → Find companies: the old scraper page is now a dialog on Companies.
// Doesn't run a scrape (Apify quota / time) — checks the dialog and its modes.
import { test, expect } from '@playwright/test'
import { skipWithoutAuthEnv } from './auth-env.js'

skipWithoutAuthEnv()

test('old scraper URL opens the Find companies dialog', async ({ page }) => {
  await page.goto('/discover/scraper')
  await expect(page).toHaveURL(/\/jobs\/companies/)
  const dialog = page.getByRole('dialog', { name: 'Find companies' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('radio', { name: /Job boards/ }).click()
  await expect(dialog.getByLabel('Category')).toBeVisible()
  await expect(dialog.getByLabel('Search for')).toHaveValue(/intern \d{4}$/)
  await dialog.getByRole('radio', { name: /YC directory/ }).click()
  await expect(dialog.getByRole('button', { name: 'Add YC companies' })).toBeVisible()
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  await expect(dialog).toBeHidden()
})
