import { describe, expect, it } from 'vitest'
import type { DashboardRole } from '@/lib/api'
import { NO_FILTERS, countGroups, emailState, matches, nextStep, noteState, notesText, peopleLink, sendLine } from './dashboard'

const card = (over: Partial<DashboardRole> = {}): DashboardRole => ({
  id: '1', company: 'Acme', title: 'Software Engineer Intern', location: 'Chicago, IL', deadline: null, posted_at: null, kind: 'intern',
  status: 'ready', stage: null, closed_reason: null, ats: 92, callback: 40, version: 1, version_id: '9', check_status: 'passed', pdf_pending: false,
  evaluation_id: null, apply_url: null, referral_mode: 'recruiters_engineers', people: 0, to_approve: 0, writing: 0, in_outbox: 0, scheduled: 0, sent: 0,
  first_send: null, last_send: null, notes_to_send: 0, notes_sent: 0, replies: 0, bounces: 0, submit: null, chip: 'Review', groups: ['review'],
  open_gaps: 0, version_at: null, unseen: false, no_outreach: false, revising: false, ...over,
})
const now = new Date('2026-11-20T12:00:00')

describe('dashboard filters', () => {
  it('counts and the count filter', () => {
    const cards = [card(), card({ id: '2', chip: 'Emailed', groups: ['approved', 'emailed'] }), card({ id: '3', chip: 'Closed', groups: [] })]
    expect(countGroups(cards)).toMatchObject({ review: 1, approved: 1, emailed: 1, replies: 0 })
    expect(cards.filter(c => matches(c, { ...NO_FILTERS, group: 'emailed' }, now)).map(c => c.id)).toEqual(['2'])
  })
  it('closed roles only when asked', () => {
    const closed = card({ chip: 'Closed', groups: [] })
    expect(matches(closed, NO_FILTERS, now)).toBe(false)
    expect(matches(closed, { ...NO_FILTERS, closed: true }, now)).toBe(true)
  })
  it('search, type, deadline and ATS', () => {
    expect(matches(card(), { ...NO_FILTERS, search: 'acme' }, now)).toBe(true)
    expect(matches(card(), { ...NO_FILTERS, search: 'globex' }, now)).toBe(false)
    expect(matches(card(), { ...NO_FILTERS, kind: 'new_grad' }, now)).toBe(false)
    expect(matches(card({ deadline: '2026-11-25' }), { ...NO_FILTERS, deadline: 'week' }, now)).toBe(true)
    expect(matches(card({ deadline: '2026-12-25' }), { ...NO_FILTERS, deadline: 'week' }, now)).toBe(false)
    expect(matches(card(), { ...NO_FILTERS, deadline: 'none' }, now)).toBe(true)
    expect(matches(card({ ats: 85 }), { ...NO_FILTERS, ats: '90' }, now)).toBe(false)
    expect(matches(card({ ats: 85 }), { ...NO_FILTERS, ats: 'under90' }, now)).toBe(true)
  })
})

describe('outreach on a card', () => {
  it('the planned send day', () => {
    expect(sendLine(card({ scheduled: 8, first_send: '2026-11-20T14:02:00Z', last_send: '2026-11-21T15:30:00Z' }))).toBe('8 emails go Fri, Nov 20 – Sat, Nov 21')
    expect(sendLine(card({ scheduled: 1, first_send: '2026-11-23T14:02:00Z', last_send: '2026-11-23T14:02:00Z' }))).toBe('1 email goes Mon, Nov 23')
    expect(sendLine(card({ to_approve: 3 }))).toBe('3 emails to approve')
    expect(sendLine(card({ writing: 2 }))).toBe('Claude is writing 2 emails')
    expect(sendLine(card({ sent: 7 }))).toBe('7 emails sent')
    expect(sendLine(card())).toBeNull()
  })
  const person = { email: 'a@x.com', email_check: 'valid', outbox_status: null, send_after: null, recipient_tz: null, reply: null, writing: false, body: 'Dear Ana,', draft_status: 'draft' as const }
  it('each person’s email', () => {
    expect(emailState(person).text).toBe('Written')
    expect(emailState({ ...person, email_check: 'guessed' }).text).toBe('Address not verified')
    expect(emailState({ ...person, email_check: 'invalid' }).text).toBe('Bounced')
    expect(emailState({ ...person, outbox_status: 'sent' }).text).toBe('Sent')
    expect(emailState({ ...person, outbox_status: 'sent', reply: { kind: 'reply', snippet: 'Happy to', subject: null, at: '' } }).text).toBe('Replied')
    expect(emailState({ ...person, outbox_status: 'scheduled', send_after: '2026-11-23T14:02:00Z', recipient_tz: 'America/Chicago' }).text).toBe('Scheduled Mon 8:02 AM')
    expect(emailState({ ...person, body: '', writing: true }).text).toBe('Claude is writing')
    expect(emailState({ ...person, email: null }).text).toBe('No email address')
  })
  it('notes and next steps', () => {
    expect(noteState({ note_status: 'to_send', note_text: 'Hi', linkedin_url: null })?.text).toBe('Note to send')
    expect(noteState({ note_status: null, note_text: null, linkedin_url: null })).toBeNull()
    expect(nextStep({ name: 'Ana Ruiz', reply: { kind: 'bounce', snippet: null, subject: null, at: '' }, email_check: 'valid' })).toMatch(/^The address bounced. Send Ana the LinkedIn note/)
    expect(nextStep({ name: 'Ana Ruiz', reply: { kind: 'reply', snippet: null, subject: null, at: '' }, email_check: 'valid' })).toMatch(/^Read Ana’s reply in Gmail/)
    expect(nextStep({ name: 'Ana', reply: null, email_check: 'valid' })).toBeNull()
  })
  it('copies the notes still to send', () => {
    expect(notesText([
      { name: 'Ana', note_text: 'Hello Ana', linkedin_url: 'https://www.linkedin.com/in/ana', note_status: 'to_send' },
      { name: 'Bo', note_text: 'Hello Bo', linkedin_url: null, note_status: 'marked_sent' },
      { name: 'Cy', note_text: 'Hello Cy', linkedin_url: null, note_status: null },
    ])).toBe('Ana\nhttps://www.linkedin.com/in/ana\nHello Ana\n\nCy\nHello Cy')
    expect(peopleLink(' Netic ')).toBe('/people/contacts?company=netic')
  })
})
