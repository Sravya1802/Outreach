import { describe, expect, it } from 'vitest'
import { approvedLine, atsOk, backlog, isRunning, readReport, reviewTab, runLine } from './review'

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
  it('shows roles before their first resume', () => {
    expect(reviewTab({ status: 'queued', open_comments: 0 })).toBe('waiting')
    expect(reviewTab({ status: 'in_progress', open_comments: 0 })).toBe('working')
  })
})

describe('backlog', () => {
  it('counts written and closed roles as done', () => {
    const row = (status: 'queued' | 'in_progress' | 'ready' | 'closed') => ({ status, open_comments: 0 })
    expect(backlog([row('ready'), row('closed'), row('queued'), row('in_progress')])).toEqual({ done: 2, total: 4, percent: 50 })
  })
  it('is empty without roles', () => {
    expect(backlog([])).toEqual({ done: 0, total: 0, percent: 0 })
  })
})

describe('runLine', () => {
  const now = Date.parse('2026-11-05T12:00:00Z')
  const run = { id: '5', started_at: '2026-11-05T11:50:00Z', finished_at: null, roles_done: 0, roles_failed: 0 }
  it('says when no run has happened', () => {
    expect(runLine(null, now)).toBe('No run has started yet.')
    expect(isRunning(null, now)).toBe(false)
  })
  it('shows a run still going', () => {
    expect(runLine(run, now)).toBe('Run 5 started 10m ago.')
    expect(isRunning(run, now)).toBe(true)
  })
  it('shows how a finished run went', () => {
    const done = { ...run, finished_at: '2026-11-05T11:30:00Z', roles_done: 12 }
    expect(runLine(done, now)).toBe('Run 5 finished 30m ago: 12 roles done.')
    expect(runLine({ ...done, roles_done: 1, roles_failed: 2 }, now)).toBe('Run 5 finished 30m ago: 1 role done, 2 failed.')
    expect(isRunning(done, now)).toBe(false)
  })
  it('stops calling a run active after the 2 hours', () => {
    const stuck = { ...run, started_at: '2026-11-05T09:00:00Z' }
    expect(isRunning(stuck, now)).toBe(false)
    expect(runLine(stuck, now)).toBe('Run 5 started 3h ago and never finished. Its roles go back in line on the next run.')
  })
})

describe('approvedLine', () => {
  const result = { emails: 2, inGmail: 2, notes: 2, skipped: [] }
  it('says where the emails went', () => {
    expect(approvedLine(result)).toBe('Approved. 2 emails in Gmail Drafts. OK each one in Outbox to send it.')
    expect(approvedLine({ ...result, emails: 1, inGmail: 1 })).toBe('Approved. 1 email in Gmail Drafts. OK each one in Outbox to send it.')
  })
  it('says when Gmail missed one', () => {
    expect(approvedLine({ ...result, inGmail: 1 })).toBe('Approved. 2 emails in Outbox, but 1 didn’t reach Gmail Drafts. OK each one in Outbox.')
  })
  it('says when there is nothing to draft', () => {
    expect(approvedLine({ ...result, emails: 0, inGmail: 0 })).toBe('Approved. This role has no emails to draft.')
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
