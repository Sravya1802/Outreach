import { describe, expect, it } from 'vitest'
import { globalOutOf10, looksLikeUrl, scoreOutOf10, scoreTone, stageFor } from './score'

describe('scores out of 10', () => {
  it('converts both scales', () => {
    expect(scoreOutOf10(92)).toBe('9.2')
    expect(scoreOutOf10(90)).toBe('9.0')
    expect(scoreOutOf10(null)).toBeNull()
    expect(scoreOutOf10(0)).toBeNull()
    expect(globalOutOf10(4.6)).toBe('9.2')
    expect(globalOutOf10(undefined)).toBeNull()
  })
  it('bands scores the way auto-apply does', () => {
    expect(scoreTone('9.0')).toBe('strong')
    expect(scoreTone('8.9')).toBe('ok')
    expect(scoreTone('6.9')).toBe('weak')
    expect(scoreTone(null)).toBe('none')
  })
})

describe('pipeline', () => {
  it('maps statuses to stages', () => {
    expect(stageFor('submitted')).toBe('applied')
    expect(stageFor('queued')).toBe('evaluated')
    expect(stageFor('needs_review')).toBe('evaluated')
    expect(stageFor(null)).toBe('evaluated')
    expect(stageFor('rejected')).toBe('rejected')
  })
  it('tells a link from a pasted description', () => {
    expect(looksLikeUrl(' https://job-boards.greenhouse.io/ramp/jobs/1 ')).toBe(true)
    expect(looksLikeUrl('Software Engineer Intern\nWe are looking for…')).toBe(false)
  })
})
