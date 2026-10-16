import { describe, expect, it } from 'vitest'
import { SECTIONS } from '@/app/nav'
import { GUIDE } from './walkthrough'

describe('walkthrough guide', () => {
  it('explains every section and every tab in the nav', () => {
    for (const s of SECTIONS) {
      const g = GUIDE[s.id]
      expect(g, s.id).toBeDefined()
      expect(g.what.length, s.id).toBeGreaterThan(0)
      for (const t of s.tabs) expect(g.tabs[t.to], `${s.id} ${t.to}`).toBeTruthy()
      expect(s.tabs.length + (g.extraTabs?.length ?? 0), `${s.id} has something to describe`).toBeGreaterThan(0)
    }
  })

  it('has no stale entries for tabs that no longer exist', () => {
    for (const s of SECTIONS) {
      const paths = new Set(s.tabs.map(t => t.to))
      for (const to of Object.keys(GUIDE[s.id].tabs)) expect(paths.has(to), `${s.id} ${to}`).toBe(true)
    }
  })
})
