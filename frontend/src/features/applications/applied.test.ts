import { describe, expect, it } from 'vitest'
import { appliedLabel, isApplied, matchesApplied } from './applied'

describe('applied', () => {
  it('counts sent resumes and any status past evaluated', () => {
    expect(isApplied({ apply_status: 'not_started', sent: false })).toBe(false)
    expect(isApplied({ apply_status: null, sent: true })).toBe(true)
    expect(isApplied({ apply_status: 'submitted' })).toBe(true)
    expect(isApplied({ apply_status: 'rejected' })).toBe(true)
  })
  it('filters applied from ready to apply', () => {
    const a = { apply_status: 'submitted' }, r = { apply_status: 'queued' }
    expect([a, r].filter(x => matchesApplied(x, 'applied'))).toEqual([a])
    expect([a, r].filter(x => matchesApplied(x, 'ready'))).toEqual([r])
    expect([a, r].filter(x => matchesApplied(x, 'all'))).toHaveLength(2)
  })
  it('says when', () => {
    const now = Date.parse('2026-10-27T15:00:00')
    expect(appliedLabel('2026-10-27T09:00:00', now)).toBe('Applied today')
    expect(appliedLabel('2026-10-14T09:00:00', now)).toBe('Applied Oct 14')
    expect(appliedLabel(null, now)).toBe('Applied')
  })
})
