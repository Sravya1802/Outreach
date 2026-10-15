import { describe, expect, it } from 'vitest'
import type { OutboxItem } from '@/lib/api'
import { perWeek, scoreBands, sentTimes } from './metrics'

// Thursday Oct 15 2026, noon local
const NOW = new Date(2026, 9, 15, 12).getTime()

describe('perWeek', () => {
  it('buckets into Monday-start weeks, oldest first, ignoring old and future rows', () => {
    const b = perWeek([
      new Date(2026, 9, 12, 9).toISOString(),  // Mon this week
      new Date(2026, 9, 15, 8).toISOString(),  // today
      new Date(2026, 9, 11, 23).toISOString(), // Sun last week
      '2026-10-05 10:00:00+00',                // Postgres text, last week
      new Date(2026, 6, 1).toISOString(),      // too old
      new Date(2026, 9, 20).toISOString(),     // future
      null,
    ], NOW, 8)
    expect(b).toHaveLength(8)
    expect(b.at(-1)?.value).toBe(2)
    expect(b.at(-2)?.value).toBe(2)
    expect(b.reduce((n, x) => n + x.value, 0)).toBe(4)
    expect(b.at(-1)?.title).toMatch(/^2 applications the week of /)
  })
})

describe('scoreBands', () => {
  it('groups 0–100 scores into the rule bands', () => {
    const b = scoreBands([{ score: 92 }, { score: 90 }, { score: 85 }, { score: 71 }, { score: 40 }, { score: null }, { score: 0 }])
    expect(b.map(x => x.value)).toEqual([1, 0, 1, 1, 2])
    expect(b[4]?.title).toBe('2 roles scored 9+')
  })
})

describe('sentTimes', () => {
  it('keeps only sent emails', () => {
    expect(sentTimes([{ status: 'sent', sent_at: 'a' }, { status: 'scheduled', sent_at: null }] as OutboxItem[])).toEqual(['a'])
  })
})
