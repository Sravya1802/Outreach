import { expect, it } from 'vitest'
import { validatePassword } from './password'

it('validates length and confirmation', () => {
  expect(validatePassword('short', 'short')).toMatch(/at least 8/)
  expect(validatePassword('longenough', 'different1')).toMatch(/match/)
  expect(validatePassword('longenough', 'longenough')).toBeNull()
})
