import { describe, expect, it } from 'vitest'
import type { DailyPlanOverview, EvaluationSummary, OutboxItem, ReplyItem, WhatsAppStatus } from '@/lib/api'
import { emailSteps, flowSettingsLine, flowSteps, whatsappSteps } from './queueFlow'

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
    expect(by.referral?.explain).toContain('1 business day after the email goes')
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

describe('emailSteps', () => {
  it('asks for Gmail first when it is not connected', () => {
    const steps = emailSteps({ contactsWithEmail: 0 })
    expect(steps.map(s => s.id)).toEqual(['gmail', 'linkedin', 'people', 'write', 'approve', 'send', 'notes', 'followups', 'replies'])
    expect(steps[0]?.state).toBe('you')
    expect(steps[0]?.countLabel).toBe('not connected')
  })
  it('counts the outbox by step and status', () => {
    const outbox = [
      { step: 0, status: 'scheduled' }, { step: 0, status: 'sent' }, { step: 0, status: 'sent' },
      { step: 1, status: 'scheduled' }, { step: 2, status: 'cancelled' }, { step: 0, status: 'failed' }, { step: 0, status: 'draft' },
    ] as OutboxItem[]
    const replies = [{ kind: 'reply' }, { kind: 'bounce' }] as ReplyItem[]
    const steps = emailSteps({ gmail: { connected: true, status: 'ok', email: 'me@gmail.com', daily_cap: 15 }, contactsWithEmail: 12, connections: 340, outbox, replies })
    const by = Object.fromEntries(steps.map(s => [s.id, s])) as Record<string, (typeof steps)[number]>
    expect(by.gmail?.countLabel).toBe('connected as me@gmail.com')
    expect(by.write?.countLabel).toBe('1 email scheduled')
    expect(by.approve?.countLabel).toBe('1 waiting')
    expect(by.approve?.state).toBe('you')
    expect(by.linkedin?.countLabel).toBe('340 connections')
    expect(by.send?.countLabel).toBe('2 sent')
    expect(by.send?.alert).toBe('1 failed')
    expect(by.send?.explain).toContain('at most 15 a day')
    expect(by.followups?.countLabel).toBe('1 scheduled')
    expect(by.replies?.countLabel).toBe('1 reply')
  })
})

describe('whatsappSteps', () => {
  const base: WhatsAppStatus = { configured: true, businessNumber: '+15550100', linked: false, phone: null, enabled: true, prefs: { list: true, replies: true, needs: true, summary: false }, verifiedAt: null, pending: null }
  it('asks to link the phone first', () => {
    const steps = whatsappSteps(base)
    expect(steps[0]?.state).toBe('you')
    expect(steps[1]?.countLabel).toBe('link your phone first')
  })
  it('shows each message type as on or off once linked', () => {
    const steps = whatsappSteps({ ...base, linked: true, phone: '+1 555 0100' })
    const by = Object.fromEntries(steps.map(s => [s.id, s.countLabel]))
    expect(by['wa-link']).toBe('linked · +1 555 0100')
    expect(by['wa-list']).toBe('on')
    expect(by['wa-summary']).toBe('off')
  })
  it('says when WhatsApp is not set up on the server', () => {
    expect(whatsappSteps({ ...base, configured: false })[0]?.countLabel).toBe('not available yet')
  })
})
