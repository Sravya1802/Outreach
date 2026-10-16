import { describe, expect, it } from 'vitest'
import { bundleFrom, isStale } from './version'

describe('version check', () => {
  it('reads the entry bundle from index.html', () => {
    expect(bundleFrom('<script type="module" crossorigin src="/assets/index-DwcjK3XM.js"></script>')).toBe('/assets/index-DwcjK3XM.js')
    expect(bundleFrom('<script type="module" src="/src/main.tsx"></script>')).toBeNull()
  })
  it('is stale only when both are known and differ', () => {
    expect(isStale('/assets/index-a.js', '/assets/index-b.js')).toBe(true)
    expect(isStale('/assets/index-a.js', '/assets/index-a.js')).toBe(false)
    expect(isStale(null, '/assets/index-b.js')).toBe(false)
    expect(isStale('/assets/index-a.js', null)).toBe(false)
  })
})
