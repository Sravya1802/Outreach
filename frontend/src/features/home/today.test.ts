import { describe, expect, it } from 'vitest'
import type { DailyPlanOverview, EvaluationSummary, OutboxItem, ReplyItem } from '@/lib/api'
import { nameList, needsYouCount, todayItems } from './today'

const NOW = new Date('2026-10-15T15:00:00Z').getTime()
const TODAY = new Date(2026, 9, 15, 10)

const row = (p: Partial<EvaluationSummary>): EvaluationSummary => ({
  id: 1, job_title: 'SWE Intern', company_name: 'Ramp', grade: null, score: 80, apply_mode: 'manual',
  apply_status: 'submitted', created_at: '2026-09-01T00:00:00Z', ...p,
})

describe('nameList', () => {
  it('joins and truncates', () => {
    expect(nameList(['Ramp'])).toBe('Ramp')
    expect(nameList(['Ramp', 'Stripe'])).toBe('Ramp and Stripe')
    expect(nameList(['A', 'B', 'C', 'D', 'E'])).toBe('A, B, C and 2 more')
    expect(nameList(['Ramp', 'Ramp', null])).toBe('Ramp')
    expect(nameList([])).toBe('')
  })
})

describe('todayItems', () => {
  it('is empty when nothing is going on', () => {
    expect(todayItems({ now: NOW, today: TODAY })).toEqual([])
  })

  it('puts problems first, then to-dos, then what runs on its own', () => {
    const plan = {
      settings: {} as DailyPlanOverview['settings'], plan: null, gmailConnected: true,
      items: [
        { id: 1, tier: 'top', decision: 'pending', company_name: 'Figma' },
        { id: 2, tier: 'top', decision: 'approved', company_name: 'Notion' },
        { id: 3, tier: 'worth', decision: 'pending', company_name: 'Linear' },
      ],
      active: [
        { id: 4, stage: 'waiting_referral', company_name: 'Vercel' },
        { id: 5, stage: 'needs_you', company_name: 'Plaid' },
      ],
    } as unknown as DailyPlanOverview
    const items = todayItems({
      now: NOW, today: TODAY, plan,
      gmail: { connected: true, status: 'error' },
      tracked: [
        row({ id: 1, company_name: 'Stripe', applied_at: '2026-10-01T00:00:00Z' }),
        row({ id: 2, company_name: 'Datadog', apply_status: 'responded', next_step: 'Thank-you note', next_step_at: '2026-10-14' }),
      ],
      replies: [
        { id: 1, kind: 'reply', company_name: 'Ramp', received_at: '2026-10-15T09:00:00Z' },
        { id: 2, kind: 'bounce', company_name: 'Nope', received_at: '2026-10-15T09:00:00Z' },
        { id: 3, kind: 'reply', company_name: 'Old', received_at: '2026-10-01T09:00:00Z' },
      ] as ReplyItem[],
      outbox: [{ id: 1, status: 'scheduled', send_after: '2026-10-16T13:00:00Z', company_name: 'Gusto' }] as OutboxItem[],
    })
    expect(items.map(t => t.id)).toEqual(['gmail', 'needs-you', 'approve', 'follow-up', 'next-steps', 'replies', 'going-out', 'emails'])
    expect(items.find(t => t.id === 'approve')?.title).toBe('1 role is waiting for your OK')
    expect(items.find(t => t.id === 'replies')?.detail).toBe('Ramp')
    expect(items.find(t => t.id === 'going-out')?.detail).toBe('1 waiting on a referral first')
    expect(items.find(t => t.id === 'follow-up')?.to).toBe('/dashboard?stage=followup#tracker')
    expect(needsYouCount(items)).toBe(6)
  })
})
