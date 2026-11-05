import { describe, expect, it } from 'vitest'
import { atsOk, backlog, readReport, reviewTab } from './review'

describe('reviewTab', () => {
  it('puts each status in its tab', () => {
    expect(reviewTab({ status: 'ready', open_comments: 0 })).toBe('ready')
    expect(reviewTab({ status: 'revision_requested', open_comments: 1 })).toBe('revising')
    expect(reviewTab({ status: 'approved', open_comments: 0 })).toBe('approved')
    expect(reviewTab({ status: 'applied', open_comments: 0 })).toBe('applied')
    expect(reviewTab({ status: 'closed', open_comments: 0 })).toBe('closed')
  })
  it('keeps a role in Revising while a run answers its comments', () => {
    expect(reviewTab({ status: 'in_progress', open_comments: 2 })).toBe('revising')
  })
  it('leaves out roles still waiting for their first run', () => {
    expect(reviewTab({ status: 'queued', open_comments: 0 })).toBeNull()
    expect(reviewTab({ status: 'in_progress', open_comments: 0 })).toBeNull()
  })
})

describe('backlog', () => {
  it('counts written and closed roles as done', () => {
    const row = (status: 'queued' | 'ready' | 'closed') => ({ status, open_comments: 0 })
    expect(backlog([row('ready'), row('closed'), row('queued'), row('queued')])).toEqual({ done: 2, total: 4, percent: 50 })
  })
  it('is empty without roles', () => {
    expect(backlog([])).toEqual({ done: 0, total: 0, percent: 0 })
  })
})

describe('atsOk', () => {
  it('needs more than 90', () => {
    expect(atsOk(91)).toBe(true)
    expect(atsOk(90)).toBe(false)
    expect(atsOk(null)).toBe(false)
  })
})

describe('readReport', () => {
  it('reads what a run wrote', () => {
    const r = readReport({
      top_5_hiring_needs: ['Ship agents'], gaps: ['Monitoring'], changes_made: ['Led with the chatbot'], verdict: 'Apply with a referral',
      keyword_table: [{ keyword: 'Python', where: 'Projects' }, { where: 'Nowhere' }, null], eligibility_flag: 'No sponsorship',
      scores: { ats_reason: 'Covers the core skills' },
    })
    expect(r.needs).toEqual(['Ship agents'])
    expect(r.keywords).toEqual([{ keyword: 'Python', where: 'Projects' }])
    expect(r.eligibility).toBe('No sponsorship')
    expect(r.atsReason).toBe('Covers the core skills')
  })
  it('survives a missing or odd report', () => {
    for (const bad of [null, undefined, 'x', { gaps: 'not a list', keyword_table: 7, scores: 3 }]) {
      expect(readReport(bad)).toMatchObject({ needs: [], gaps: [], changes: [], keywords: [], verdict: null })
    }
  })
})
