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
