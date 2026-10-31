import { describe, expect, it } from 'vitest'
import { pickPageSize } from './pageSize'

describe('page size', () => {
  it('takes the address, then the saved choice, then 50', () => {
    expect(pickPageSize('100', '200')).toBe(100)
    expect(pickPageSize(null, '200')).toBe(200)
    expect(pickPageSize(null, null)).toBe(50)
    expect(pickPageSize('7', 'abc')).toBe(50)
    expect(pickPageSize('5000', '100')).toBe(100)
  })
})
