import { describe, expect, it } from 'vitest'
import type { AiUsage } from '@/lib/api'
import { aiUsageLine } from './aiUsage'

const u = (mine: number, cap: number): AiUsage => ({ since: '', caps: { site: 40, user: cap }, spent: { site: 0, mine }, byTask: [] })

describe('aiUsageLine', () => {
  it('shows spend against the monthly limit', () => {
    expect(aiUsageLine(u(3.2, 30))).toEqual({ text: '$3.20 of $30 this month', tone: 'success', pct: 11 })
  })
  it('warns near the limit and flags it when almost used up', () => {
    expect(aiUsageLine(u(22, 30))?.tone).toBe('warning')
    expect(aiUsageLine(u(29, 30))?.tone).toBe('danger')
    expect(aiUsageLine(u(45, 30))?.pct).toBe(100)
  })
  it('handles no limit and no data', () => {
    expect(aiUsageLine(u(1, 0))).toEqual({ text: '$1.00 this month', tone: 'neutral', pct: 0 })
    expect(aiUsageLine(undefined)).toBeNull()
  })
})
