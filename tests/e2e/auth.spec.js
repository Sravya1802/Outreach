// ─────────────────────────────────────────────────────────────────────────────
// auth.spec.js — PR-A smoke test.
//
// Loads the unauthenticated landing page and asserts the login form is
// rendered. Doesn't actually sign in — that needs a test account, and PR-A's
// goal is to prove the harness works end-to-end. Login-flow tests land in
// PR-B once test-user provisioning is wired up.
// ─────────────────────────────────────────────────────────────────────────────

import { test, expect } from '@playwright/test'

test('landing page shows login form', async ({ page }) => {
  await page.goto('/')

  await expect(page.getByRole('heading', { name: 'Sign in to OutreachOS', level: 1 })).toBeVisible()

  // Email + password inputs are labelled and interactable.
  const email = page.getByLabel('Email')
  await expect(email).toBeVisible()
  await email.fill('test@example.com')
  await expect(email).toHaveValue('test@example.com')
  await expect(page.getByLabel('Password')).toBeVisible()
})

test('login validates input before calling Supabase', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel('Email').fill('not-an-email')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('alert')).toHaveText('Enter a valid email address.')

  await page.getByLabel('Email').fill('someone@example.com')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('alert')).toHaveText('Enter your password.')
})

test('login switches between sign-in modes', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Create an account' }).click()
  await expect(page.getByRole('heading', { name: 'Create your account' })).toBeVisible()
  await page.getByRole('button', { name: 'Sign in' }).last().click()
  await page.getByRole('button', { name: 'Forgot password?' }).click()
  await expect(page.getByRole('heading', { name: 'Reset your password' })).toBeVisible()
  await expect(page.getByLabel('Password')).toHaveCount(0)
  await page.getByRole('button', { name: 'Back to sign in' }).click()
  await expect(page.getByRole('heading', { name: 'Sign in to OutreachOS' })).toBeVisible()
})
