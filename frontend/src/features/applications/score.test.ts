import { describe, expect, it } from 'vitest'
import { globalOutOf10, looksLikeUrl, scoreOutOf10, scoreTone, stageFor } from './score'
import { atsTone, callbackTone, tailoringHeadline } from './tailoring'
import { STAGE_LABEL, hourLabel, num, tzLabel } from './plan'

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

describe('tailored resume', () => {
  const ats = (missing: { term: string; importance: 'required' | 'preferred' }[]) => ({ score: 70, target: 90, coverage: 70, keywords: [], matched: [], missingYouHave: [], missingYouDont: missing, checks: [], pages: 1 })
  it('tones the ATS score: above 90% passes, 90 itself does not', () => {
    expect(atsTone(91)).toBe('strong')
    expect(atsTone(90)).toBe('ok')
    expect(atsTone(41)).toBe('weak')
    expect(atsTone(null)).toBe('none')
  })
  it('tones the callback chance against 20%', () => {
    expect(callbackTone(22)).toBe('strong')
    expect(callbackTone(12)).toBe('ok')
    expect(callbackTone(5)).toBe('weak')
  })
  it('explains where the resume stands', () => {
    expect(tailoringHeadline({ status: 'ready', approved_at: null, ats_score: 96, ats: ats([]), report: null })).toMatch(/^Scores 96%.*goes out/)
    expect(tailoringHeadline({ status: 'needs_review', approved_at: '2026-10-14', ats_score: 80, ats: ats([]), report: null })).toMatch(/chose to send it anyway/)
    expect(tailoringHeadline({ status: 'needs_review', approved_at: null, ats_score: 70, ats: ats([{ term: 'Go', importance: 'required' }, { term: 'Git', importance: 'required' }, { term: 'GraphQL', importance: 'preferred' }]), report: null }))
      .toBe('Not above the 90% bar, so it won’t be sent without you. The posting requires Go and Git, which your resume doesn’t show.')
    expect(tailoringHeadline({ status: 'needs_review', approved_at: null, ats_score: 96, ats: ats([]), report: { verdict: 'skip', verdictWhy: 'Needs 5+ years.' } }))
      .toBe('The recruiter check says skip this one: Needs 5+ years. It won’t be sent without you.')
    const project = { id: 1, name: 'Feature Store | Feast', tech: [], bullets: [], covers: [], why: '', plan: [], status: 'suggested' as const, projectedAts: 93, onPage: true }
    expect(tailoringHeadline({ status: 'needs_review', approved_at: null, ats_score: 93, ats: ats([]), report: { proposedProject: project } }))
      .toMatch(/project to build, “Feature Store \| Feast”. It won’t be sent until/)
  })
})

describe('daily plan helpers', () => {
  it('labels hours and zones', () => {
    expect(hourLabel(22)).toBe('10 PM')
    expect(hourLabel(17)).toBe('5 PM')
    expect(hourLabel(9)).toBe('9 AM')
    expect(tzLabel('America/Chicago')).toBe('Central')
    expect(tzLabel('Asia/Tokyo')).toBe('Tokyo')
    expect(num('9.4')).toBe(9.4)
    expect(num(null)).toBeNull()
    expect(STAGE_LABEL.asking_referral).toBe('Asking for a referral')
  })
})
