import { describe, expect, it } from 'vitest'
import type { ResumeJob } from '@/lib/api'
import { latestListDate, matchesResumeFilter, resumeState } from './resumes'

const READY = { tailoring_id: 10, status: 'ready' as const, batch_phase: null, ats: 95, ats_before: 89, callback: 11, verdict: 'apply_with_referral' as const, file_id: 17, finished_at: null, project: null, project_status: null }
const job = (over: Partial<ResumeJob> = {}): ResumeJob => ({
  id: 1, company_name: 'IBM', job_title: 'Associate Data Engineer', job_url: null, eval_score: 9.8, list_date: '2026-10-19', decision: 'pending', stage: 'proposed', apply_status: 'not_started',
  resume: READY,
  sending: { kind: 'tailored', file_id: 17, filename: 'x.pdf' }, ...over,
})

describe('resumes by job', () => {
  it('names the state', () => {
    expect(resumeState(job()).label).toBe('Ready')
    expect(resumeState(job({ sending: { kind: 'yours', file_id: 3, filename: 'mine.pdf' } })).label).toBe('Your upload')
    expect(resumeState(job({ resume: { ...READY, status: 'running', batch_phase: 'revising' } })).label).toBe('Revising')
    expect(resumeState(job({ resume: { ...READY, status: 'needs_review' } })).label).toBe('Needs you')
  })
  it('filters by the latest list and state', () => {
    const jobs = [job(), job({ id: 2, list_date: '2026-10-20', resume: { ...READY, status: 'running', batch_phase: 'drafting' } })]
    const latest = latestListDate(jobs)
    expect(latest).toBe('2026-10-20')
    expect(jobs.filter(j => matchesResumeFilter(j, 'tonight', latest)).map(j => j.id)).toEqual([2])
    expect(jobs.filter(j => matchesResumeFilter(j, 'writing', latest)).map(j => j.id)).toEqual([2])
    expect(jobs.filter(j => matchesResumeFilter(j, 'ready', latest)).map(j => j.id)).toEqual([1])
  })
})
