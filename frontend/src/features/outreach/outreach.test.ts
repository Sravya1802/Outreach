import { describe, expect, it } from 'vitest'
import { contactMatches, emailLabel, needsYou, planSummary, statusLabel } from './contacts'

describe('contacts', () => {
  it('sums up a company: what waits on you first', () => {
    expect(planSummary({ waiting: 3, notesToSend: 1, scheduled: 0, sent: 2 })).toEqual([
      { text: '3 emails to approve', tone: 'accent' },
      { text: '1 LinkedIn note to send', tone: 'info' },
      { text: '2 emailed', tone: 'success' },
    ])
    expect(planSummary({ waiting: 0, notesToSend: 0, scheduled: 0, sent: 0 })).toEqual([])
    expect(needsYou({ waiting: 0, notesToSend: 2 })).toBe(true)
    expect(needsYou({ waiting: 0, notesToSend: 0 })).toBe(false)
  })
  it('labels email verification and outreach status', () => {
    expect(emailLabel('verified')?.text).toBe('verified')
    expect(emailLabel('catch_all')?.text).toBe('catch-all')
    expect(emailLabel('weird_status')?.text).toBe('weird status')
    expect(emailLabel(null)).toBeNull()
    expect(statusLabel(null).text).toBe('Not contacted')
    expect(statusLabel('replied').text).toBe('Replied')
  })
  it('searches every visible field', () => {
    const c = { name: 'Priya Natarajan', title: 'Engineering Manager', company_name: 'Ramp', email: 'priya@ramp.com' }
    expect(contactMatches(c, 'ramp')).toBe(true)
    expect(contactMatches(c, ' MANAGER ')).toBe(true)
    expect(contactMatches(c, 'stripe')).toBe(false)
    expect(contactMatches({ name: null, title: null, company_name: null, email: null }, '')).toBe(true)
  })
})

import { companyBlurb, gmailComposeUrl, websiteHost } from '@/features/jobs/company'

describe('company page helpers', () => {
  it('never shows a job board as the website', () => {
    expect(websiteHost({ website: 'https://www.ramp.com/careers', domain: null })).toBe('ramp.com')
    expect(websiteHost({ website: 'https://job-boards.greenhouse.io/ramp', domain: 'ramp.com' })).toBe('ramp.com')
    expect(websiteHost({ website: 'https://jobs.lever.co/x', domain: null })).toBeNull()
    expect(websiteHost({ website: null, domain: null })).toBeNull()
  })
  it('trims long or disambiguation descriptions', () => {
    expect(companyBlurb({ description: 'Ramp may refer to several things', wikipedia_summary: 'Ramp is a fintech.' })).toBe('Ramp is a fintech.')
    const long = 'Word '.repeat(80)
    expect(companyBlurb({ description: long, wikipedia_summary: null }).length).toBeLessThanOrEqual(262)
    expect(companyBlurb({ description: null, wikipedia_summary: null })).toBe('')
  })
  it('builds a Gmail compose link', () => {
    const u = new URL(gmailComposeUrl('priya@ramp.com', 'Hi & hello', 'Line 1\nLine 2'))
    expect(u.searchParams.get('to')).toBe('priya@ramp.com')
    expect(u.searchParams.get('su')).toBe('Hi & hello')
    expect(u.searchParams.get('body')).toBe('Line 1\nLine 2')
  })
})
