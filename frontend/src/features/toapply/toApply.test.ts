import { describe, expect, it } from 'vitest'
import type { ResumeJob } from '@/lib/api'
import { NO_FILTERS, dayLabel, isMissed, jobState, matchesRoleFilters, matchesToApply, roleCategory, roleLevel, sortToApply, stateLabel, tally } from './toApply'

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

describe('role filters', () => {
  it('reads the field from the title', () => {
    expect(roleCategory({ job_title: 'Machine Learning Engineer, New Grad' })).toBe('ai')
    expect(roleCategory({ job_title: 'Data Scientist Intern', tracks: ['ai'] })).toBe('data')
    expect(roleCategory({ job_title: 'Software Engineering Intern, Backend (Summer 2027)' })).toBe('swe')
    expect(roleCategory({ job_title: 'Finance Intern (Summer 2027)', tracks: ['swe'] })).toBe('other')
    expect(roleCategory({ job_title: 'Member of Technical Staff', tracks: ['ai'] })).toBe('ai')
  })

  it('reads the level from the title, then the listing', () => {
    expect(roleLevel({ job_title: 'Summer 2027 Undergraduate Internship - Software' })).toBe('intern')
    expect(roleLevel({ job_title: 'Software Engineer, University Graduate 2027' })).toBe('new_grad')
    expect(roleLevel({ job_title: 'Software Engineer I' })).toBe('new_grad')
    expect(roleLevel({ job_title: 'Entry Level AI/ML Engineer' })).toBe('new_grad')
    expect(roleLevel({ job_title: 'Backend Engineer', role_type: 'new_grad' })).toBe('new_grad')
    expect(roleLevel({ job_title: 'Senior Backend Engineer' })).toBe('other')
  })

  it('combines filters', () => {
    const ng = job({ job_title: 'ML Engineer, New Grad', grad_years: ['2027'], sponsorship: 'no_sponsorship', resume: { ats: 93 } as ResumeJob['resume'] })
    expect(matchesRoleFilters(ng, { ...NO_FILTERS, category: 'ai', level: 'new_grad', year: '2027' })).toBe(true)
    expect(matchesRoleFilters(ng, { ...NO_FILTERS, year: '2026' })).toBe(false)
    expect(matchesRoleFilters(ng, { ...NO_FILTERS, visa: 'open' })).toBe(false)
    expect(matchesRoleFilters(ng, { ...NO_FILTERS, ats: 'pass' })).toBe(true)
    expect(matchesRoleFilters(ng, { ...NO_FILTERS, ats: 'under' })).toBe(false)
  })

  it('tallies values, most first', () => {
    expect(tally(['2027', '2026', '2027', null])).toEqual([{ value: '2027', n: 2 }, { value: '2026', n: 1 }])
  })
})
