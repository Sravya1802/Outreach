// New app shell: sidebar navigation, section tabs, command palette, theme,
// settings, and old-URL redirects.
import { test, expect } from '@playwright/test'
import { skipWithoutAuthEnv } from './auth-env.js'

skipWithoutAuthEnv()

test('sidebar navigates between sections and highlights the current one', async ({ page }) => {
  await page.goto('/home')
  const nav = page.getByRole('navigation', { name: 'Main' })
  for (const [label, url] of [['Jobs', /\/jobs\/roles\/intern$/], ['Applications', /\/applications\/evaluate$/], ['Outreach', /\/outreach\/contacts$/], ['Home', /\/home$/]]) {
    await nav.getByRole('link', { name: label }).click()
    await expect(page).toHaveURL(url)
    await expect(nav.getByRole('link', { name: label })).toHaveAttribute('aria-current', 'page')
  }
})

test('section tabs switch views within a section', async ({ page }) => {
  await page.goto('/jobs/roles/intern')
  await page.getByRole('link', { name: 'Companies', exact: true }).click()
  await expect(page).toHaveURL(/\/jobs\/companies$/)
  await expect(page.getByRole('link', { name: 'Companies', exact: true })).toHaveAttribute('aria-current', 'page')
  await expect(page.getByRole('heading', { name: 'Companies', level: 1 })).toBeVisible()
})

test('old category links open Companies filtered to that industry', async ({ page }) => {
  await page.goto('/category/AI%20%26%20Research')
  await expect(page).toHaveURL(/\/jobs\/companies\?category=AI/)
  await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Jobs' })).toHaveAttribute('aria-current', 'page')
})

test('command palette opens with the keyboard and navigates', async ({ page }) => {
  await page.goto('/home')
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible() // shortcut listener is mounted with the shell
  await page.keyboard.press('ControlOrMeta+k')
  const dialog = page.getByRole('dialog', { name: 'Command palette' })
  await expect(dialog).toBeVisible()
  const input = dialog.getByRole('textbox', { name: 'Search' })
  await expect(input).toBeFocused()
  await input.fill('templates')
  await expect(dialog.getByRole('option').first()).toHaveText(/Outreach › Templates/)
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/outreach\/templates$/)
  await expect(dialog).toBeHidden()
})

test('command palette closes on Escape and shows an empty state', async ({ page }) => {
  await page.goto('/home')
  await page.getByRole('button', { name: /Search/ }).click()
  const dialog = page.getByRole('dialog', { name: 'Command palette' })
  await dialog.getByRole('textbox', { name: 'Search' }).fill('zzqqxxnothing')
  await expect(dialog.getByText('No results for “zzqqxxnothing”')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
})

test('theme toggle switches and persists across reloads', async ({ page }) => {
  await page.goto('/home')
  await expect(page.locator('html')).not.toHaveAttribute('data-theme', 'light')
  await page.getByRole('button', { name: 'Switch to light theme' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await page.getByRole('button', { name: 'Switch to dark theme' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
})

test('settings tabs route and highlight', async ({ page }) => {
  await page.goto('/settings')
  await expect(page).toHaveURL(/\/settings\/account$/)
  const nav = page.getByRole('navigation', { name: 'Settings' })
  await nav.getByRole('link', { name: 'Integrations' }).click()
  await expect(page).toHaveURL(/\/settings\/integrations$/)
  await expect(nav.getByRole('link', { name: 'Integrations' })).toHaveAttribute('aria-current', 'page')
  await expect(page.getByText('Apify', { exact: true })).toBeVisible()
  await nav.getByRole('link', { name: 'Privacy' }).click()
  await expect(page.getByRole('button', { name: 'Export data' })).toBeVisible()
})

test('password form validates before submitting', async ({ page }) => {
  await page.goto('/settings/account')
  await page.getByLabel('New password', { exact: true }).fill('short')
  await page.getByLabel('Confirm new password').fill('short')
  await page.getByRole('button', { name: 'Update password' }).click()
  await expect(page.getByText('Use at least 8 characters.')).toBeVisible()
  await page.getByLabel('New password', { exact: true }).fill('longenough1')
  await page.getByLabel('Confirm new password').fill('different12')
  await page.getByRole('button', { name: 'Update password' }).click()
  await expect(page.getByText('Passwords don’t match.')).toBeVisible()
})

test('old URLs redirect and keep their query string', async ({ page }) => {
  for (const [from, to] of [
    ['/discover/companies', /\/jobs\/companies$/],
    ['/apply/auto-apply', /\/applications\/auto-apply$/],
    ['/apply/new-grad-roles', /\/jobs\/roles\/new-grad$/],
    ['/outreach/messages', /\/people\/contacts$/],
    ['/outreach/templates', /\/people\/templates$/],
    ['/career?evalId=42', /\/applications\/evaluate\?evalId=42$/],
  ]) {
    await page.goto(from)
    await expect(page).toHaveURL(to)
  }
})
