import { describe, expect, it } from 'vitest'
import { pageCanvasSize } from './pdfjs'

describe('pageCanvasSize', () => {
  it('fits the page to the box width, sharp on a 2x screen', () => {
    const s = pageCanvasSize(612, 792, 800, 1, 2)
    expect(s.cssWidth).toBe(800)
    expect(Math.round(s.cssHeight)).toBe(1035)
    expect(s.pixelWidth).toBe(1600)
  })
  it('stays under the iOS canvas limit when zoomed in', () => {
    const s = pageCanvasSize(612, 792, 1200, 2, 3)
    expect(s.pixelWidth * s.pixelHeight).toBeLessThanOrEqual(4096 * 4096)
    expect(s.cssWidth).toBe(2400)
  })
})
