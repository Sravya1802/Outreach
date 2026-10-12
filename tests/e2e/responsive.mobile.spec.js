// Mobile viewport coverage — PR-C of audit fix #6.
//
// Runs in the `mobile-iphone` Playwright project (iPhone 13 emulation).
// Asserts that key pages render without horizontal overflow and that the
// primary heading is still visible at mobile width.
import { test, expect } from '@playwright/test'
import { skipWithoutAuthEnv } from './auth-env.js'

skipWithoutAuthEnv()

const ROUTES = [
  { path: '/home',               heading: /^(Good (morning|afternoon|evening)|Working late),/ },
  { path: '/discover/companies', heading: 'Companies' },
  { path: '/apply/auto-apply',   heading: 'Auto Apply' },
]

for (const { path, heading } of ROUTES) {
  test(`mobile: ${path} renders without horizontal scroll`, async ({ page }) => {
    await page.goto(path)
    await expect(page.getByRole('heading', { name: heading, level: 1 })).toBeVisible()

    // No content should overflow the viewport horizontally — that's the
    // single most common mobile regression in inline-style-heavy components.
    const overflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth - document.documentElement.clientWidth
    })
    expect(overflow, `${path} has ${overflow}px of horizontal overflow`).toBeLessThanOrEqual(0)
  })
}
