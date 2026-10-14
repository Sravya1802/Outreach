// Jobs → Roles: catalog list, filters in the URL, email-alerts dialog.
import { test, expect } from '@playwright/test'
import { skipWithoutAuthEnv } from './auth-env.js'

skipWithoutAuthEnv()

test('roles page: four lists, field switch, filters kept in the URL', async ({ page }) => {
  await page.goto('/jobs/roles/intern')
  await expect(page.getByRole('heading', { name: 'Roles', level: 1 })).toBeVisible()
  const lists = page.getByRole('navigation', { name: 'Lists' })
  await expect(lists.getByRole('link')).toHaveCount(4)
  await expect(lists.getByRole('link', { name: /Internships\s*USA/ })).toHaveAttribute('aria-current', 'page')
  await page.getByLabel('Search roles').fill('software')
  await expect(page).toHaveURL(/q=software/)
  await page.getByRole('radio', { name: 'AI / ML' }).click()
  await expect(page).toHaveURL(/field=ai/)
  await lists.getByRole('link', { name: /New grad\s*International/ }).click()
  await expect(page).toHaveURL(/\/jobs\/roles\/new-grad-intl\?.*q=software.*field=ai|\/jobs\/roles\/new-grad-intl\?.*field=ai.*q=software/)
})

test('email alerts dialog opens from roles', async ({ page }) => {
  await page.goto('/jobs/roles/intern')
  await page.getByRole('button', { name: 'Email alerts' }).click()
  const dialog = page.getByRole('dialog', { name: 'Email alerts' })
  await expect(dialog.getByText('Sent to')).toBeVisible()
  await expect(dialog.getByLabel('How often')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
})

test('old alerts URL lands on roles', async ({ page }) => {
  await page.goto('/discover/alerts')
  await expect(page).toHaveURL(/\/jobs\/roles\/intern/)
})
