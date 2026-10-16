import { describe, expect, it } from 'vitest'
import { integrationCards } from './overview'

describe('integrationCards', () => {
  it('is loading until every status has answered', () => {
    const cards = integrationCards({})
    expect(cards.map(c => c.state)).toEqual(['loading', 'loading', 'loading', 'loading'])
  })

  it('reports connected with a detail line', () => {
    const cards = integrationCards({
      gmail: { connected: true, email: 'me@gmail.com', status: 'ok' },
      linkedin: { total: 312, imported: null, topCompanies: [] },
      whatsapp: { configured: true, businessNumber: null, linked: true, phone: '+14155550100', enabled: true, prefs: {} as never, verifiedAt: null, pending: null },
      github: { configured: true, connected: true, login: 'octo' },
    })
    expect(cards.map(c => [c.state, c.detail])).toEqual([
      ['on', 'me@gmail.com'], ['on', '312 connections imported'], ['on', '+14155550100'], ['on', '@octo'],
    ])
  })

  it('flags problems and paused links', () => {
    const cards = integrationCards({
      gmail: { connected: true, status: 'error', last_error: 'x' },
      linkedin: { total: 0, imported: null, topCompanies: [] },
      whatsapp: { configured: true, businessNumber: null, linked: true, phone: '+1', enabled: false, prefs: {} as never, verifiedAt: null, pending: null },
      github: { configured: true, connected: false },
      errors: { github: true },
    })
    expect(cards.map(c => c.state)).toEqual(['problem', 'off', 'off', 'problem'])
    expect(cards[2]?.detail).toBe('Linked but paused')
  })
})
