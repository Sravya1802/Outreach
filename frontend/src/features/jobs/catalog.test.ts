import { describe, expect, it } from 'vitest'
import { countsByList, listForKind, postedDate, postedWords, sourceLabel } from './catalog'

describe('catalog helpers', () => {
  it('labels sources', () => {
    expect(sourceLabel('ai_jobs')).toBe('ai-jobs.net')
    expect(sourceLabel('remote_rocketship')).toBe('Remote Rocketship')
    expect(sourceLabel('some_new-source')).toBe('Some New Source')
  })
  it('maps URL kinds to the lists in the account’s market', () => {
    expect(listForKind('intern', 'usa')).toMatchObject({ roleType: 'intern', region: 'usa', region_label: 'USA' })
    expect(listForKind('new-grad', 'india')).toMatchObject({ roleType: 'new_grad', region: 'india' })
    expect(listForKind('intern', 'other')).toMatchObject({ region: 'intl', region_label: 'International' })
    // Old region-specific links still land on the right role type, in your market.
    expect(listForKind('new-grad-intl', 'india')).toMatchObject({ roleType: 'new_grad', region: 'india' })
    expect(listForKind('other', 'usa')).toBeNull()
  })
  it('says the date in words where there is no Posted column', () => {
    expect(postedWords({ date: 'Oct 13', known: true })).toBe('Posted Oct 13')
    expect(postedWords({ date: 'Oct 12', known: false })).toBe('First seen Oct 12')
  })
  it('gives the opening date for the Posted column', () => {
    const now = new Date('2026-10-13T18:00:00Z').getTime()
    expect(postedDate('2026-10-13T08:00:00Z', '2026-10-13T09:00:00Z', now)).toEqual({ date: 'Oct 13', ago: 'today', known: true })
    expect(postedDate('2026-09-21T12:00:00Z', '2026-10-01T12:00:00Z', now)).toEqual({ date: 'Sep 21', ago: '22d ago', known: true })
    // No posting date from the source: the day we first found it, marked as such.
    expect(postedDate(null, '2026-10-12T12:00:00Z', now)).toEqual({ date: 'Oct 12', ago: 'yesterday', known: false })
    expect(postedDate('2025-12-30T12:00:00Z', '', now)?.date).toBe('Dec 30, 2025')
    expect(postedDate('garbage', 'garbage', now)).toBeNull()
  })
  it('sums counts per list', () => {
    const rows = [
      { role_type: 'intern', region: 'usa', n: 3 }, { role_type: 'new_grad', region: 'usa', n: 2 },
      { role_type: 'intern', region: 'intl', n: 4 }, { role_type: 'intern', region: 'india', n: 7 }, { role_type: 'intern', n: 1 },
    ] as const
    expect(countsByList([...rows], 'usa')).toEqual({ intern: 4, 'new-grad': 2 })
    expect(countsByList([...rows], 'india')).toEqual({ intern: 7, 'new-grad': 0 })
    expect(countsByList([...rows], 'other')).toEqual({ intern: 4, 'new-grad': 0 })
    expect(countsByList([{ role_type: 'intern', region: 'usa', n: 5, swe: 4, ai: 2 }], 'usa', 'ai').intern).toBe(2)
  })
})

import { defaultScrapeQuery, recruitingSeasonYear } from './categories'

describe('recruiting season', () => {
  it('rolls to next year from August', () => {
    expect(recruitingSeasonYear(new Date(2026, 9, 13))).toBe(2027)
    expect(recruitingSeasonYear(new Date(2026, 6, 31))).toBe(2026)
    expect(recruitingSeasonYear(new Date(2026, 7, 1))).toBe(2027)
  })
  it('builds the default scrape query', () => {
    expect(defaultScrapeQuery('AI & Research', new Date(2026, 9, 13))).toBe('AI machine learning intern 2027')
    expect(defaultScrapeQuery('Robotics', new Date(2026, 1, 1))).toBe('Robotics intern 2026')
  })
})

import { visaLabel } from './catalog'

describe('visa labels', () => {
  it('labels what the description says', () => {
    expect(visaLabel('sponsors', true)?.text).toBe('Sponsors visas')
    expect(visaLabel('no_sponsorship', true)?.tone).toBe('warning')
    expect(visaLabel('citizens_only', false)?.text).toBe('US citizens only')
    expect(visaLabel(null, true)?.text).toBe('Visa not stated')
    expect(visaLabel(null, false)).toBeNull()
  })
})
