import { describe, expect, it } from 'vitest'
import type { OutboxItem } from '@/lib/api'
import { approveAllLabel, approveAllText, approvedLine, notSent, scheduledDays, sendTimeLabel, skipLine } from './scheduled'

const item = (over: Partial<OutboxItem>): OutboxItem => ({
  id: 1, contact_id: 1, step: 0, thread_root_id: null, to_email: 'a@x.com', to_name: 'Ana', subject: 's', body: 'b',
  recipient_tz: 'America/Chicago', send_after: '2026-11-19T14:05:00Z', status: 'scheduled', cancel_reason: null, error: null,
  sent_at: null, created_at: '2026-11-18T00:00:00Z', company_name: 'Acme', company_id: 1, contact_status: null, ...over,
})

describe('Approve all text', () => {
  const r = { approved: 12, skipped: 3, reasons: [{ reason: 'writing', label: 'still empty or being written by Claude', count: 2, names: [] }, { reason: 'asked', label: 'already emailed or scheduled for another role', count: 1, names: [] }] }
  it('counts what is skipped, and why', () => {
    expect(skipLine(r)).toBe('3 skipped: 2 still empty or being written by Claude, 1 already emailed or scheduled for another role.')
    expect(skipLine({ skipped: 0, reasons: [] })).toBe('')
  })
  it('labels the button by what it schedules', () => {
    expect(approveAllLabel(r)).toBe('Approve all 12 emails')
    expect(approveAllLabel({ approved: 1 })).toBe('Approve all 1 email')
    expect(approveAllLabel({ approved: 0 })).toBe('No finished emails to approve')
  })
  it('says they are scheduled for the next business morning, not sent now', () => {
    const t = approveAllText(r, 40)
    expect(t).toMatch(/scheduled, not sent now/)
    expect(t).toMatch(/8–10 AM in the recipient’s time zone \(Chicago time if unknown\)/)
    expect(t).toMatch(/2 to 4 minutes apart, at most 40 a day/)
    expect(t).toMatch(/3 skipped/)
  })
  it('after approving: when the first and last go', () => {
    const line = approvedLine({ ...r, first: '2026-11-19T14:02:00Z', last: '2026-11-20T15:40:00Z' })
    expect(line).toMatch(/^Scheduled 12 emails\. The first goes Thu, Nov 19, 8:02 AM, the last Fri, Nov 20, 9:40 AM \(your time\)\. 3 skipped/)
    expect(approvedLine({ approved: 0, skipped: 3, reasons: r.reasons })).toMatch(/^Nothing approved\. 3 skipped/)
  })
})

describe('Scheduled list', () => {
  it('soonest first, by day in your time; cancelled and sent ones left out', () => {
    const days = scheduledDays([
      item({ id: 2, send_after: '2026-11-20T14:00:00Z' }),
      item({ id: 1, send_after: '2026-11-19T14:05:00Z' }),
      item({ id: 3, send_after: '2026-11-19T14:01:00Z' }),
      item({ id: 4, status: 'sent' }),
      item({ id: 5, status: 'cancelled' }),
    ])
    expect(days.map(d => [d.day, d.items.map(i => i.id)])).toEqual([['Thursday, November 19', [3, 1]], ['Friday, November 20', [2]]])
  })
  it('shows their time, and yours when it differs', () => {
    expect(sendTimeLabel(item({}))).toBe('8:05 AM Chicago time')
    expect(sendTimeLabel(item({ recipient_tz: 'America/New_York', send_after: '2026-11-19T13:30:00Z' }))).toBe('8:30 AM New York time · 7:30 AM yours')
    expect(sendTimeLabel(item({ status: 'sending' }))).toBe('Sending now…')
  })
  it('lists emails held back by the send check', () => {
    expect(notSent([item({ id: 1, status: 'failed', error: 'Not sent: The email is empty.' }), item({ id: 2, status: 'failed', error: 'SMTP down' })]).map(i => i.id)).toEqual([1])
  })
})
