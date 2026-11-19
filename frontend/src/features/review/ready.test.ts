import { describe, expect, it } from 'vitest'
import { answersLine as answersLine2, apiOrigin, closesLabel, daysLeft, fillLine, fillerVersion, hasFiller } from './ready'

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

describe('prepared answers and the extension version', () => {
  it('counts what last night prepared', () => {
    expect(answersLine2({ prepared_at: '2026-11-19T07:00:00Z', posting_closed: false, answers: { ready: 4, writing: 2, needs_you: 1, profile: 9 } })).toBe('Answers: 4 ready · Claude is writing 2 · 1 needs you')
    expect(answersLine2({ prepared_at: '2026-11-19T07:00:00Z', posting_closed: true, answers: { ready: 4, writing: 0, needs_you: 0, profile: 9 } })).toBeNull()
    expect(answersLine2({ prepared_at: null, posting_closed: false, answers: null })).toBeNull()
  })
  it('reads the version the extension stamps on the page', () => {
    document.documentElement.dataset.snjFiller = '1.1.0'
    expect(fillerVersion()).toBe('1.1.0')
    delete document.documentElement.dataset.snjFiller
    expect(fillerVersion()).toBe('')
  })
})
