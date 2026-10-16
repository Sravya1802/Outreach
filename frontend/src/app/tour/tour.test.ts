import { describe, expect, it } from 'vitest'
import { PRIMARY_SECTIONS } from '../nav'
import { place } from './placement'
import { tourSteps } from './steps'

describe('tourSteps', () => {
  it('stops at every tab along the top, in order, with text', () => {
    const steps = tourSteps()
    const navSteps = steps.filter(s => s.anchor?.startsWith('nav-'))
    expect(navSteps.map(s => s.anchor)).toEqual(PRIMARY_SECTIONS.map(s => `nav-${s.id}`))
    for (const s of steps) expect(s.body.length, s.id).toBeGreaterThan(20)
    for (const s of steps) for (const t of s.tabs ?? []) expect(t.does, `${s.id} ${t.label}`).toBeTruthy()
  })

  it('starts with a welcome and ends on Help', () => {
    const steps = tourSteps()
    expect(steps[0]?.anchor).toBeUndefined()
    expect(steps.at(-1)?.anchor).toBe('help')
  })
})

describe('place', () => {
  const card = { width: 380, height: 200 }
  it('centers when there is nothing to point at', () => {
    expect(place(null, card, 1400, 900)).toEqual({ width: 380, left: 510, top: 350, caret: null })
  })
  it('sits under the element with the caret on its center', () => {
    const p = place({ top: 10, left: 600, width: 100, height: 40 }, card, 1400, 900)
    expect(p).toEqual({ width: 380, left: 460, top: 62, caret: 190 })
  })
  it('stays inside the screen near the right edge and on phones', () => {
    const right = place({ top: 10, left: 1350, width: 32, height: 32 }, card, 1400, 900)
    expect(right.left + right.width).toBe(1384)
    expect(right.caret).toBe(362) // the avatar's center, 1366, minus the card's left, 1004
    const phone = place(null, card, 390, 800)
    expect(phone.width).toBe(358)
    expect(phone.left).toBe(16)
  })
})
