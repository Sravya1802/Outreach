// Where the tour card sits relative to the spotlighted element.
export interface Rect { top: number; left: number; width: number; height: number }
export interface Placement {
  top: number
  left: number
  width: number
  /** caret x inside the card; null = no caret */
  caret: number | null
  /** Which edge of the card the caret sits on. */
  side: 'top' | 'bottom'
}

const GAP = 12
const EDGE = 16

export function place(anchor: Rect | null, card: { width: number; height: number }, vw: number, vh: number): Placement {
  const width = Math.min(card.width, vw - EDGE * 2)
  if (!anchor) return { width, left: (vw - width) / 2, top: Math.max(EDGE, (vh - card.height) / 2), caret: null, side: 'top' }
  const center = anchor.left + anchor.width / 2
  const left = Math.min(Math.max(center - width / 2, EDGE), vw - width - EDGE)
  const caret = Math.min(Math.max(center - left, 16), width - 16)
  // Elements in the lower half (the Help button) get the card above them.
  if (anchor.top + anchor.height / 2 > vh / 2) {
    return { width, left, top: Math.max(EDGE, anchor.top - GAP - card.height), caret, side: 'bottom' }
  }
  // Below the element; pulled up if it would run off the bottom.
  const top = Math.max(EDGE, Math.min(anchor.top + anchor.height + GAP, vh - card.height - EDGE))
  return { width, left, top, caret, side: 'top' }
}
