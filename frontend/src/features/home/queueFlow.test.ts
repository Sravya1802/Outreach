import { describe, expect, it } from 'vitest'
import type { DailyPlanOverview, EvaluationSummary } from '@/lib/api'
import { flowSettingsLine, flowSteps } from './queueFlow'

const NOW = new Date('2026-10-15T15:00:00Z').getTime()
const row = (p: Partial<EvaluationSummary>): EvaluationSummary => ({
  id: 1, job_title: 'SWE Intern', company_name: 'Ramp', grade: null, score: 80, apply_mode: 'manual',
  apply_status: 'submitted', created_at: '2026-09-01T00:00:00Z', ...p,
})

describe('flowSteps', () => {
  it('has eight stages in order and works with no plan', () => {
    const steps = flowSteps({ newToday: 0, now: NOW })
    expect(steps.map(s => s.id)).toEqual(['find', 'score', 'list', 'tailor', 'referral', 'apply', 'track', 'follow'])
    expect(steps.every(s => s.state === 'idle')).toBe(true)
    expect(steps.find(s => s.id === 'list')?.explain).toContain('10 PM Central')
  })

  it('counts each stage from the plan and the tracker', () => {
    const plan = {
      settings: { enabled: true, listHour: 21, timezone: 'America/New_York', minScore: 8.5, maxPerDay: 10, referralFirst: true, referralWaitDays: 1 },
      plan: { status: 'ready', stats: { scored: 40 } },
      items: [{ tier: 'top', decision: 'pending' }, { tier: 'top', decision: 'approved' }, { tier: 'worth', decision: 'pending' }],
      active: [{ stage: 'tailoring' }, { stage: 'waiting_referral' }, { stage: 'ready_to_apply' }, { stage: 'needs_you' }],
      gmailConnected: true,
    } as unknown as DailyPlanOverview
    const tracked = [
      row({ id: 1, applied_at: '2026-10-01T00:00:00Z' }),
      row({ id: 2, apply_status: 'interview', applied_at: '2026-10-01T00:00:00Z' }),
      row({ id: 3, apply_status: 'not_started' }),
      row({ id: 4, apply_status: 'rejected' }),
    ]
    const steps = flowSteps({ newToday: 59, plan, tracked, now: NOW })
    const by = Object.fromEntries(steps.map(s => [s.id, s])) as Record<string, (typeof steps)[number]>
    expect(by.find?.countLabel).toBe('59 today')
    expect(by.score?.countLabel).toBe('40 scored')
    expect(by.list?.countLabel).toBe('1 need your OK')
    expect(by.list?.state).toBe('you')
    expect(by.list?.explain).toContain('9 PM Eastern')
    expect(by.list?.explain).toContain('8.5')
    expect(by.tailor?.count).toBe(1)
    expect(by.referral?.explain).toContain('1 business day,')
    expect(by.apply?.state).toBe('stuck')
    expect(by.apply?.alert).toBe('1 needs you')
    expect(by.track?.countLabel).toBe('1 of 2 heard back')
    expect(by.follow?.countLabel).toBe('1 to follow up')
  })
})

describe('flowSettingsLine', () => {
  it('says when the list is off', () => {
    expect(flowSettingsLine()).toMatch(/off/)
  })
})
