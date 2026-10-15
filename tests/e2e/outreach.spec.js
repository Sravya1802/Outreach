// People → Contacts happy-path: contacts page renders.
import { test, expect } from '@playwright/test'
import { skipWithoutAuthEnv } from './auth-env.js'

skipWithoutAuthEnv()

test('contacts page renders under People', async ({ page }) => {
  await page.goto('/people/contacts')
  await expect(page.getByRole('heading', { name: 'Contacts', level: 1 })).toBeVisible()
})
