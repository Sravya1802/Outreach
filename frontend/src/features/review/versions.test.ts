import { describe, expect, it } from 'vitest'
import { defaultPick, diffCounts, diffLines, reportTitle, scoreLine, versionStamp } from './versions'

describe('version history', () => {
  it('scores against the version before', () => {
    expect(scoreLine({ ats: { from: 92, to: 96 }, callback: { from: 11, to: 13 } })).toBe('ATS 92% → 96%, callback 11% → 13%')
    expect(scoreLine({ ats: { from: 100, to: 100 }, callback: { from: null, to: 25 } })).toBe('ATS 100%, callback 25%')
  })
  it('stamps and titles', () => {
    expect(versionStamp({ version: 3, created_at: '2026-11-19T19:36:00Z', reason: { kind: 'comment', label: 'Your comment' } })).toMatch(/^v3 · Nov 19, \d{1,2}:36 [AP]M · Your comment$/)
    expect(reportTitle(2, '2026-11-19T19:36:00Z')).toBe('Report for v2 (Nov 19)')
  })
})

describe('compare two versions', () => {
  it('marks added, removed and moved lines', () => {
    const v1 = ['## Experience', '• Built dashboards', '• Led migration', '## Projects', '• Order book']
    const v2 = ['## Experience', '• Led migration', '• Wrote C# services', '## Projects', '• Order book', '• Built dashboards']
    const d = diffLines(v1, v2)
    expect(d.left.map(l => l.kind)).toEqual(['same', 'moved', 'same', 'same', 'same'])
    expect(d.right.map(l => l.kind)).toEqual(['same', 'same', 'added', 'same', 'same', 'moved'])
    expect(diffCounts(d)).toEqual({ added: 1, removed: 0, moved: 1 })
  })
  it('a changed line is one removed and one added', () => {
    const d = diffLines(['• Built 20 dashboards'], ['• Built 20+ dashboards'])
    expect(diffCounts(d)).toEqual({ added: 1, removed: 1, moved: 0 })
  })
})

describe('pasting more people than a role takes', () => {
  it('picks the first ones up to the free places', () => {
    expect([...defaultPick(['a', 'b', 'c', 'd'], 2)]).toEqual([0, 1])
    expect([...defaultPick(['a'], 0)]).toEqual([])
  })
})
