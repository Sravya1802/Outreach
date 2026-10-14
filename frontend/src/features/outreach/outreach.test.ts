import { describe, expect, it } from 'vitest'
import { contactMatches, emailLabel, statusLabel } from './contacts'

describe('contacts', () => {
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
