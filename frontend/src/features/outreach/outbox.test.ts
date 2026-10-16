import { describe, expect, it } from 'vitest'
import type { OutboxItem } from '@/lib/api'
import { cityOf, draftsOf, groupThreads, inZone, itemStatus, replyText } from './outbox'

const item = (p: Partial<OutboxItem>): OutboxItem => ({
  id: 1, contact_id: 1, step: 0, thread_root_id: null, to_email: 'a@x.com', to_name: 'Ana', subject: 's', body: 'b', recipient_tz: 'America/New_York',
  send_after: '2026-10-15T13:30:00Z', status: 'scheduled', cancel_reason: null, error: null, sent_at: null, created_at: '2026-10-14T00:00:00Z',
  company_name: 'Ramp', company_id: 9, contact_status: 'pending', ...p,
})

describe('outbox', () => {
  it('groups follow-ups under their first email', () => {
    const t = groupThreads([item({ id: 5 }), item({ id: 7, step: 2, thread_root_id: 5 }), item({ id: 6, step: 1, thread_root_id: 5 }), item({ id: 3 })])
    expect(t.map(x => x.root.id)).toEqual([5, 3])
    expect(t[0]?.followups.map(f => f.step)).toEqual([1, 2])
  })
  it('says when and where an email goes', () => {
    expect(inZone('2026-10-15T13:30:00Z', 'America/New_York')).toBe('Thu, Oct 15, 9:30 AM')
    expect(cityOf('America/Los_Angeles')).toBe('Los Angeles')
    expect(itemStatus(item({})).text).toBe('Goes Thu, Oct 15, 9:30 AM (New York time)')
    expect(itemStatus(item({ status: 'cancelled', cancel_reason: 'They replied' })).text).toBe('Not sent: they replied')
    expect(itemStatus(item({ status: 'failed', error: 'boom' })).tone).toBe('danger')
    expect(itemStatus(item({ error: 'Waiting for you to reconnect Gmail in Settings' })).text).toMatch(/· held: Waiting for you to reconnect/)
  })
  it('lists drafts waiting for an OK, oldest first', () => {
    const d = draftsOf([item({ id: 9, status: 'draft' }), item({ id: 4, status: 'draft' }), item({ id: 5 }), item({ id: 6, status: 'cancelled' })])
    expect(d.map(x => x.id)).toEqual([4, 9])
    expect(itemStatus(item({ status: 'draft' }))).toEqual({ text: 'Waiting for your OK', tone: 'accent' })
  })
  it('describes replies', () => {
    expect(replyText({ id: 1, contact_id: 1, channel: 'linkedin', kind: 'linkedin_accept', from_email: null, from_name: null, subject: null, snippet: null, received_at: '', contact_name: 'Ana Lee', company_name: null, company_id: null }))
      .toBe('Ana Lee accepted your LinkedIn invitation')
  })
})
