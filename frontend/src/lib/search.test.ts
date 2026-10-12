import { expect, it } from 'vitest'
import { matches } from './search'

it('matches every word in any order, case-insensitively', () => {
  expect(matches('auto queue', 'Applications Auto-apply queue run')).toBe(true)
  expect(matches('APPLY', 'auto-apply')).toBe(true)
  expect(matches('board offer', 'Applications Board pipeline')).toBe(false)
  expect(matches('   ', 'anything')).toBe(true)
})
