import { describe, expect, it } from 'vitest'
import { formatNumber, greeting, initials, lowerFirst, nameFromEmail, percent, timeAgo } from './format'

const NOW = new Date('2026-10-12T12:00:00Z').getTime()

describe('timeAgo', () => {
  it('handles empty and invalid input', () => {
    expect(timeAgo(null, NOW)).toBe('never')
    expect(timeAgo('not a date', NOW)).toBe('never')
  })
  it('buckets by unit', () => {
    expect(timeAgo('2026-10-12T11:59:40Z', NOW)).toBe('just now')
    expect(timeAgo('2026-10-12T11:15:00Z', NOW)).toBe('45m ago')
    expect(timeAgo('2026-10-12T07:00:00Z', NOW)).toBe('5h ago')
    expect(timeAgo('2026-10-09T12:00:00Z', NOW)).toBe('3d ago')
    expect(timeAgo('2026-09-21T12:00:00Z', NOW)).toBe('3w ago')
  })
  it('never reports negative time for future timestamps', () => {
    expect(timeAgo('2026-10-12T13:00:00Z', NOW)).toBe('just now')
  })
})

describe('percent', () => {
  it('avoids divide-by-zero', () => expect(percent(3, 0)).toBe(0))
  it('rounds', () => expect(percent(1, 3)).toBe(33))
})

describe('formatNumber', () => {
  it('formats numbers and falls back to 0', () => {
    expect(formatNumber(1499)).toBe((1499).toLocaleString())
    expect(formatNumber(undefined)).toBe('0')
    expect(formatNumber(Number.NaN)).toBe('0')
  })
})

describe('lowerFirst', () => {
  it('lowercases ordinary words but keeps proper nouns', () => {
    expect(lowerFirst('Role evaluation & message writing')).toBe('role evaluation & message writing')
    expect(lowerFirst('LinkedIn, Wellfound & Google Jobs scraping')).toBe('LinkedIn, Wellfound & Google Jobs scraping')
    expect(lowerFirst('')).toBe('')
  })
})

describe('names', () => {
  it('derives a display name from an email', () => {
    expect(nameFromEmail('jane.doe@x.com')).toBe('Jane Doe')
    expect(nameFromEmail('lakshmisravyar@gmail.com')).toBe('Lakshmisravyar')
    expect(nameFromEmail('rls180202@gmail.com')).toBe('Rls')
    expect(nameFromEmail('e2e@outreach-os.local')).toBe('there')
    expect(nameFromEmail('j.doe99@x.com')).toBe('Doe')
    expect(nameFromEmail('')).toBe('there')
  })
  it('builds initials', () => {
    expect(initials('Jane Doe')).toBe('JD')
    expect(initials('Jane')).toBe('J')
    expect(initials('')).toBe('?')
  })
  it('greets by time of day', () => {
    expect(greeting(new Date(2026, 0, 1, 9))).toBe('Good morning')
    expect(greeting(new Date(2026, 0, 1, 14))).toBe('Good afternoon')
    expect(greeting(new Date(2026, 0, 1, 20))).toBe('Good evening')
    expect(greeting(new Date(2026, 0, 1, 2))).toBe('Working late')
  })
})
