import { describe, expect, it } from 'vitest'
import { appCouldNotSend, appliedLabel, autoSite, isApplied, isApplying, matchesApplied } from './applied'

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

describe('apply for me', () => {
  it('knows which sites the app can submit to', () => {
    expect(autoSite('https://boards.greenhouse.io/robinhood/jobs/1')).toBe('Greenhouse')
    expect(autoSite('https://job-boards.greenhouse.io/gusto/jobs/2')).toBe('Greenhouse')
    expect(autoSite('https://jobs.lever.co/x/y')).toBe('Lever')
    expect(autoSite('https://jobs.ashbyhq.com/x')).toBe('Ashby')
    expect(autoSite('https://www.linkedin.com/jobs/view/1')).toBeNull()
    expect(autoSite('http://169.254.169.254/?greenhouse.io')).toBeNull()
    expect(autoSite(null)).toBeNull()
  })
  it('reads the app’s progress', () => {
    expect(isApplying('queued')).toBe(true)
    expect(isApplying('submitted')).toBe(false)
    expect(appCouldNotSend('captcha_needed')).toBe(true)
    expect(appCouldNotSend('not_started')).toBe(false)
  })
})
