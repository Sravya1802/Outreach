import { describe, expect, it } from 'vitest'
import { linkLabel, matchesFilter, matchesQuery, referralTone, statusTone, trackerCounts } from './trackerSheet'

const row = (apply_status: 'not_started' | 'submitted' | 'responded' | 'interview' | 'offer' | 'rejected', referral: 'yes' | 'no' | null = null) =>
  ({ apply_status, submitted: apply_status !== 'not_started', referral, company_name: 'Optiver', job_title: 'Graduate Software Engineer' })

describe('tracker sheet', () => {
  it('colors match the sheet', () => {
    expect(statusTone('rejected')).toBe('danger')
    expect(statusTone('submitted')).toBe('warning')
    expect(statusTone('responded')).toBe('info')
    expect(referralTone('yes')).toBe('success')
    expect(referralTone(null)).toBe('none')
  })
  it('filters and counts', () => {
    const rows = [row('submitted'), row('rejected', 'yes'), row('responded', 'yes'), row('not_started')]
    expect(rows.filter(r => matchesFilter(r, 'applied'))).toHaveLength(3)
    expect(rows.filter(r => matchesFilter(r, 'active'))).toHaveLength(1)
    expect(rows.filter(r => matchesFilter(r, 'not_applied'))).toHaveLength(1)
    expect(trackerCounts(rows)).toEqual({ applied: 3, waiting: 1, active: 1, offers: 0, rejected: 1, referred: 2, notApplied: 1 })
  })
  it('search and link labels', () => {
    expect(matchesQuery(row('submitted'), 'optiv')).toBe(true)
    expect(matchesQuery(row('submitted'), 'jane')).toBe(false)
    expect(linkLabel('https://www.jobs.ashbyhq.com/netic/1')).toBe('jobs.ashbyhq.com')
    expect(linkLabel(null)).toBe('')
  })
})
