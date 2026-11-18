import { describe, expect, it } from 'vitest'
import { apiOrigin, closesLabel, daysLeft, fillLine, hasFiller } from './ready'

describe('ready to submit', () => {
  const now = new Date(2026, 10, 17, 18, 0)
  it('counts days to a date-only deadline in the local day', () => {
    expect(daysLeft('2026-11-20', now)).toBe(3)
    expect(daysLeft('2026-11-17', now)).toBe(0)
    expect(daysLeft(null, now)).toBeNull()
  })
  it('says when it closes', () => {
    expect(closesLabel('2026-11-20', now)).toBe('Closes Fri, Nov 20')
    expect(closesLabel('2026-11-18', now)).toBe('Closes tomorrow')
    expect(closesLabel('2026-11-17', now)).toBe('Closes today')
    expect(closesLabel('2026-11-15', now)).toBe('Closed Nov 15')
    expect(closesLabel(null, now)).toBeNull()
  })
  it('sums up the last fill', () => {
    expect(fillLine({ filled_at: null, filled: null, unanswered: [], resume_attached: null })).toBeNull()
    expect(fillLine({ filled_at: '2026-11-17', filled: 14, unanswered: ['Why us?', 'Start date'], resume_attached: true })).toBe('Filled 14 · resume attached · 2 questions need you')
  })
  it('finds the extension and the API origin', () => {
    expect(hasFiller()).toBe(false)
    document.documentElement.dataset.snjFiller = '1.0.0'
    expect(hasFiller()).toBe(true)
    expect(apiOrigin('https://outreach-jt.duckdns.org/api', 'https://scoutnjobs.vercel.app/review/ready')).toBe('https://outreach-jt.duckdns.org')
    expect(apiOrigin('/api', 'http://localhost:5173/review/ready')).toBe('http://localhost:5173')
  })
})
