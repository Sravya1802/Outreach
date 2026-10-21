import { describe, expect, it } from 'vitest'
import type { EvaluationFile } from '@/lib/api'
import { descriptionOf, firstFile, jobTab } from './job'

const f = (id: number, primary = false): EvaluationFile => ({ id, kind: 'tailored', filename: `${id}.pdf`, size_bytes: 1, created_at: '', sent: false, primary_file: primary })

describe('job page helpers', () => {
  it('falls back to Overview for unknown tabs', () => {
    expect(jobTab('resume')).toBe('resume')
    expect(jobTab('nope')).toBe('overview')
    expect(jobTab(null)).toBe('overview')
  })
  it('prefers the evaluated description, then the listing', () => {
    expect(descriptionOf({ job_description: ' JD ', role: { description: 'listing' } as never })).toBe('JD')
    expect(descriptionOf({ job_description: '', role: { description: 'listing' } as never })).toBe('listing')
    expect(descriptionOf({ job_description: null, role: null })).toBe('')
  })
  it('shows the resume the application uses first', () => {
    expect(firstFile([f(1), f(2, true)])?.id).toBe(2)
    expect(firstFile([f(1), f(2)])?.id).toBe(1)
    expect(firstFile([])).toBeNull()
  })
})

describe('readableDescription', () => {
  it('splits headings and sentences that were glued together', async () => {
    const { readableDescription } = await import('./job')
    expect(readableDescription('Fidelity will not sponsor this position.Job DescriptionNote: no sponsorship for this positionThese internships are in Boston'))
      .toBe('Fidelity will not sponsor this position.\n\nJob Description\n\nNote: no sponsorship for this position\n\nThese internships are in Boston')
  })
  it('leaves product names, abbreviations and normal text alone', async () => {
    const { readableDescription } = await import('./job')
    const s = 'Use JavaScript, TypeScript, PostgreSQL and MongoDB in the U.S. office. The team is great.'
    expect(readableDescription(s)).toBe(s)
  })
})
