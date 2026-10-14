import { describe, expect, it } from 'vitest'
import { applyNote, followUpDays, funnel, matchesSearch, nextStepDue, parseTime } from './pipeline'

const NOW = new Date('2026-10-14T12:00:00Z').getTime()

describe('follow-up nudges', () => {
  it('reads Postgres text timestamps', () => {
    expect(parseTime('2026-10-04 12:00:00.5+00')).toBe(new Date('2026-10-04T12:00:00.5Z').getTime())
    expect(parseTime('2026-10-04T12:00:00Z')).toBe(new Date('2026-10-04T12:00:00Z').getTime())
    expect(parseTime('nonsense')).toBeNull()
    expect(parseTime(null)).toBeNull()
  })
  it('flags applied roles quiet for a week or more', () => {
    expect(followUpDays({ apply_status: 'submitted', applied_at: '2026-10-04 12:00:00+00' }, NOW)).toBe(10)
    expect(followUpDays({ apply_status: 'submitted', applied_at: '2026-10-07T12:00:00Z' }, NOW)).toBe(7)
    expect(followUpDays({ apply_status: 'submitted', applied_at: '2026-10-10T12:00:00Z' }, NOW)).toBeNull()
    expect(followUpDays({ apply_status: 'interview', applied_at: '2026-09-01T12:00:00Z' }, NOW)).toBeNull()
    expect(followUpDays({ apply_status: 'submitted', applied_at: null }, NOW)).toBeNull()
  })
})

describe('next step dates', () => {
  const today = new Date(2026, 9, 14, 15, 30)
  it('labels relative to today', () => {
    expect(nextStepDue('2026-10-13', today)).toEqual({ state: 'overdue', label: 'Yesterday' })
    expect(nextStepDue('2026-10-14', today)).toEqual({ state: 'today', label: 'Today' })
    expect(nextStepDue('2026-10-15', today)).toEqual({ state: 'soon', label: 'Tomorrow' })
    expect(nextStepDue('2026-10-17', today)?.state).toBe('soon')
    expect(nextStepDue('2026-10-30', today)?.state).toBe('later')
    expect(nextStepDue(null, today)).toBeNull()
    expect(nextStepDue('soon', today)).toBeNull()
  })
})

describe('funnel', () => {
  it('counts only what reached the employer', () => {
    expect(funnel([
      { apply_status: 'not_started', applied_at: null },
      { apply_status: 'queued', applied_at: null },
      { apply_status: 'submitted', applied_at: 'x' },
      { apply_status: 'responded', applied_at: 'x' },
      { apply_status: 'interview', applied_at: 'x' },
      { apply_status: 'offer', applied_at: 'x' },
      { apply_status: 'rejected', applied_at: 'x' },
      { apply_status: 'rejected', applied_at: null },
    ])).toEqual({ applied: 5, heardBack: 4, interviews: 2, offers: 1 })
  })
})

describe('search and apply notes', () => {
  it('matches company, title, note and next step', () => {
    const r = { company_name: 'Stripe', job_title: 'SWE Intern', notes: 'Recruiter: Priya', next_step: null }
    expect(matchesSearch(r, 'stri')).toBe(true)
    expect(matchesSearch(r, 'priya')).toBe(true)
    expect(matchesSearch(r, '  ')).toBe(true)
    expect(matchesSearch(r, 'figma')).toBe(false)
  })
  it('says how it was sent or why auto-apply stopped', () => {
    expect(applyNote({ apply_mode: 'auto', apply_status: 'submitted', apply_error: null })).toEqual({ text: 'Auto-applied', tone: 'muted' })
    expect(applyNote({ apply_mode: 'manual', apply_status: 'interview', apply_error: null })?.text).toBe('Applied by hand')
    expect(applyNote({ apply_mode: 'auto', apply_status: 'not_started', apply_error: 'Login needed' })).toEqual({ text: 'Auto-apply stopped: Login needed', tone: 'danger' })
    expect(applyNote({ apply_mode: 'auto', apply_status: 'not_started', apply_error: null })).toBeNull()
  })
})
