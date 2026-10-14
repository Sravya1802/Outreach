import { describe, expect, it } from 'vitest'
import { countsByType, kindToRoleType, postedLabel, roleTypeToKind, sourceLabel } from './catalog'

describe('catalog helpers', () => {
  it('labels sources', () => {
    expect(sourceLabel('ai_jobs')).toBe('ai-jobs.net')
    expect(sourceLabel('remote_rocketship')).toBe('Remote Rocketship')
    expect(sourceLabel('some_new-source')).toBe('Some New Source')
  })
  it('maps URL kinds', () => {
    expect(kindToRoleType('intern')).toBe('intern')
    expect(kindToRoleType('new-grad')).toBe('new_grad')
    expect(kindToRoleType('other')).toBeNull()
    expect(roleTypeToKind('new_grad')).toBe('new-grad')
  })
  it('formats posted dates', () => {
    const now = new Date('2026-10-13T12:00:00Z').getTime()
    expect(postedLabel('2026-10-13T08:00:00Z', '2026-10-13T09:00:00Z', now)).toBe('today')
    expect(postedLabel(null, '2026-10-12T08:00:00Z', now)).toBe('yesterday')
    expect(postedLabel('2026-10-08T08:00:00Z', '', now)).toBe('5d ago')
    expect(postedLabel('garbage', 'garbage', now)).toBe('')
  })
  it('sums counts per role type', () => {
    expect(countsByType([{ role_type: 'intern', n: 3 }, { role_type: 'new_grad', n: 2 }, { role_type: 'intern', n: 4 }])).toEqual({ intern: 7, new_grad: 2 })
  })
})
