import { describe, expect, it } from 'vitest'
import type { ResumeJob } from '@/lib/api'
import { dayLabel, isMissed, jobState, matchesToApply, sortToApply, stateLabel } from './toApply'

const job = (p: Partial<ResumeJob>): ResumeJob => ({
  id: 1, company_name: 'Acme', job_title: 'SWE', job_url: null, eval_score: 9, list_date: '2026-10-27',
  decision: 'pending', stage: 'proposed', apply_status: 'not_started', resume: null, sending: null, ...p,
} as ResumeJob)

describe('to apply', () => {
  it('reads each role’s state', () => {
    expect(jobState(job({ apply_status: 'submitted' }))).toBe('applied')
    expect(jobState(job({ apply_status: 'queued' }))).toBe('applying')
    expect(jobState(job({ decision: 'approved', stage: 'needs_you', needs_reason: 'resume' }))).toBe('review')
    expect(jobState(job({ decision: 'approved', stage: 'needs_you', needs_reason: 'apply' }))).toBe('needs')
    expect(jobState(job({ decision: 'approved', stage: 'waiting_referral' }))).toBe('working')
    expect(stateLabel(job({ decision: 'approved', stage: 'waiting_referral' }))).toBe('Waiting on a referral')
    expect(jobState(job({ decision: 'skipped' }))).toBe('skipped')
    expect(stateLabel(job({ decision: 'expired' }))).toBe('Not approved')
    expect(stateLabel(job({ decision: null, list_date: null }))).toBe('Not applied')
  })
  it('flags roles from earlier lists nobody acted on as missed', () => {
    expect(isMissed(job({ list_date: '2026-10-25', decision: 'expired' }), '2026-10-27')).toBe(true)
    expect(isMissed(job({ list_date: '2026-10-27' }), '2026-10-27')).toBe(false)
    expect(isMissed(job({ list_date: '2026-10-25', decision: 'approved', stage: 'waiting_referral' }), '2026-10-27')).toBe(false)
    expect(isMissed(job({ list_date: '2026-10-25', apply_status: 'submitted' }), '2026-10-27')).toBe(false)
    expect(isMissed(job({ list_date: null }), '2026-10-27')).toBe(false)
  })
  it('filters and sorts', () => {
    const a = job({ id: 1, list_date: '2026-10-26', decision: 'expired' })
    const b = job({ id: 2, list_date: '2026-10-27', apply_status: 'submitted' })
    const c = job({ id: 3, list_date: '2026-10-27', decision: 'approved', stage: 'needs_you', needs_reason: 'resume' })
    expect([a, b, c].filter(j => matchesToApply(j, 'todo', '2026-10-27')).map(j => j.id)).toEqual([1, 3])
    expect([a, b, c].filter(j => matchesToApply(j, 'missed', '2026-10-27')).map(j => j.id)).toEqual([1])
    expect(sortToApply([a, b, c]).map(j => j.id)).toEqual([3, 2, 1])
    expect(dayLabel('2026-10-27', '2026-10-27')).toBe('Latest list · Tue, Oct 27')
    expect(dayLabel(null, '2026-10-27')).toBe('Not from a list')
  })
})
