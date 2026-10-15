import { describe, expect, it } from 'vitest'
import { formatPhone } from './phone'

describe('formatPhone', () => {
  it('formats US, India and others', () => {
    expect(formatPhone('15550102000')).toBe('+1 (555) 010-2000')
    expect(formatPhone('919876543210')).toBe('+91 98765 43210')
    expect(formatPhone('447911123456')).toBe('+447911123456')
    expect(formatPhone(null)).toBe('')
  })
})
